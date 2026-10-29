"""RAG 核心链路：查询预处理（改写+双语）→ 多路检索 → 阈值过滤 → LLM 兜底 → 引用溯源+图片 → 流式生成。

对应文章的五大生产级特性，并扩展：
- 跨语言召回（参照 Dify 多路召回）：中文问题同时用中文+英文双查询检索英文资料，反之亦然
- 图片溯源（参照 RAGFlow）：命中分片所属页的内嵌图片（架构图等）随来源返回前端呈现
"""
import re
from typing import AsyncIterator

from . import vectorstore
from .config import settings
from .ingestion import page_image_urls
from .llm import get_llm

# 单一语言模式（CROSS_LINGUAL=false 时使用，对应文章特性 1）
REWRITE_PROMPT = (
    "你是一个查询改写器。请根据对话历史，把用户的最新问题改写为独立、完整的检索查询，"
    "补全代词指向，保留原意，不添加额外信息。只输出改写后的查询本身。\n\n"
    "对话历史：\n{history}\n\n最新问题：{question}\n\n改写后的查询："
)

# 双语模式（CROSS_LINGUAL=true，默认）：改写 + 互译，用于跨语言知识库检索
BILINGUAL_PROMPT = (
    "你是检索查询预处理器。请根据对话历史完成两件事：\n"
    "1) 把用户的最新问题改写为独立、完整的检索查询（补全代词指代，保留原意，不添加信息）\n"
    "2) 给出该查询的另一语言版本：中文查询译成英文，英文查询译成中文\n"
    "只输出两行，格式严格如下（不要输出其他内容）：\n"
    "ZH: <中文查询>\n"
    "EN: <English query>\n\n"
    "对话历史：\n{history}\n\n最新问题：{question}"
)

RAG_PROMPT = (
    "你是企业知识库助手。资料可能与问题使用不同语言（如英文资料对应中文提问），"
    "请综合理解后用「用户提问的语言」回答，并仅依据下方【检索到的参考资料】，"
    "在使用某条资料的句子末尾用 [1]、[2] 这样的编号标注来源。"
    "如果资料不足以回答，请如实说明。条理清晰。\n"
    "{image_note}\n\n"
    "【检索到的参考资料】\n{context}\n\n【问题】{question}\n\n【回答】"
)

FALLBACK_PROMPT = (
    "你是企业知识库助手。当前知识库中没有检索到与问题相关的资料，"
    "请基于你自己的通用知识回答，并在回答开头注明「（以下回答基于模型通用知识，知识库未命中相关资料）」。"
    "使用与提问相同的语言。\n\n【问题】{question}\n\n【回答】"
)


def build_context(docs: list) -> str:
    return "\n\n".join(
        f"[{i + 1}] 来源：{d.metadata.get('source', '未知')}\n内容：{d.page_content}"
        for i, (d, _score) in enumerate(docs)
    )


def format_history(history: list[dict]) -> str:
    lines = []
    for m in history[-6:]:  # 最近 3 轮足够改写
        role = "用户" if m.get("role") == "user" else "助手"
        lines.append(f"{role}：{m.get('content', '')}")
    return "\n".join(lines)


async def prepare_queries(question: str, history: list[dict]) -> tuple[str, list[str]]:
    """查询预处理：返回 (主查询, 检索变体列表)。

    双语模式一次 LLM 调用同时完成改写与互译；解析失败或关闭时退化为单查询。
    """
    if not history and not settings.cross_lingual:
        return question, [question]
    prompt = (
        BILINGUAL_PROMPT if settings.cross_lingual else REWRITE_PROMPT
    ).format(history=format_history(history), question=question)
    try:
        llm = get_llm(streaming=False)
        resp = await llm.ainvoke(prompt)
        content = resp.content.strip()
        if settings.cross_lingual:
            zh = en = None
            for line in content.splitlines():
                s = line.strip()
                if s.upper().startswith("ZH:"):
                    zh = s[3:].strip().strip('"“”')
                elif s.upper().startswith("EN:"):
                    en = s[3:].strip().strip('"“”')
            variants = [v for v in dict.fromkeys(v for v in (zh, en) if v)]
            if variants:
                return variants[0], variants
            return question, [question]
        rewritten = content.splitlines()[0].strip().strip('"“”') if content else question
        return (rewritten or question), [rewritten or question]
    except Exception:
        return question, [question]  # 预处理失败不阻塞主流程


def _multi_query_retrieve(variants: list[str]) -> list[tuple]:
    """多路召回 + 按 chunk 去重（保留每片的最高分），再截取 Top-K。"""
    merged: dict[str, tuple] = {}
    for q in dict.fromkeys(variants):
        for d, s in vectorstore.search(q):
            cid = d.metadata.get("chunk_id", d.page_content[:32])
            if cid not in merged or s > merged[cid][1]:
                merged[cid] = (d, s)
    return sorted(merged.values(), key=lambda x: x[1], reverse=True)


def _chunk_pages(d) -> list[int]:
    raw = str(d.metadata.get("pages", "") or "")
    return [int(x) for x in raw.split(",") if x.strip().isdigit()]


async def chat_stream(question: str, history: list[dict]) -> AsyncIterator[dict]:
    """主流程，按事件流产出 dict：
    {type: "meta", mode, rewritten_query, sources}
    {type: "delta", text}
    {type: "done"}
    """
    rewritten, variants = await prepare_queries(question, history)

    # 多语言多路召回 + 阈值过滤（文章特性 2：检索失败时回退到大模型直接回答）
    results = _multi_query_retrieve(variants)
    hits = [(d, s) for d, s in results if s >= settings.sim_threshold]

    sources = [
        {
            "index": i + 1,
            "source": d.metadata.get("source", "未知"),
            "snippet": d.page_content[:200],
            "score": round(s, 3),
            "pages": _chunk_pages(d),
            "images": page_image_urls(d.metadata.get("doc_id"), _chunk_pages(d)),
        }
        for i, (d, s) in enumerate(hits)
    ]
    mode = "rag" if hits else "fallback"

    if hits:
        # 有插图时告诉模型图片已随来源展示，引导用户查看而不是说"无法提供图片"
        image_note = (
            "注意：被引用资料对应页面的插图/图纸截图已在回答下方自动展示，"
            "如用户询问图片，请提示其查看下方来源卡片中的图片，不要说无法提供。"
            if any(s["images"] for s in sources)
            else ""
        )
        prompt = RAG_PROMPT.format(context=build_context(hits), question=rewritten, image_note=image_note)
    else:
        prompt = FALLBACK_PROMPT.format(question=question)

    yield {"type": "meta", "mode": mode, "rewritten_query": rewritten, "sources": sources}

    llm = get_llm(streaming=True)
    async for chunk in llm.astream(prompt):
        if chunk.content:
            yield {"type": "delta", "text": chunk.content}
    yield {"type": "done"}


def extract_citations(answer: str) -> list[int]:
    """从答案中提取 [n] 引用标注（文章特性 3：文件溯源）。"""
    return sorted({int(m) for m in re.findall(r"\[(\d{1,2})\]", answer)})
