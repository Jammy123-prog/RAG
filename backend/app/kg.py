"""知识图谱模块（新增）：Neo4j 存储 + LLM 实体抽取 + 文档关联可视化数据服务。

参照 GraphRAG / RAGFlow Knowledge Graph 的轻量落地：
- 抽取：每份文档采样若干分片，一次 LLM 调用抽取核心实体/概念（严格 JSON 数组输出）
- 建图：(:Document {doc_id})-[:MENTIONS {weight}]->(:Entity {name})
        共享实体的文档对之间生成 (:Document)-[:RELATED {shared}]->(:Document)
- 服务：/api/kg/graph 返回 ECharts graph 所需的 nodes/links 数据
- 容错：Neo4j 未启动时 available=false，前端给出部署提示，不影响其他功能
"""
import asyncio
import json
import re
import threading

from . import vectorstore
from .config import DATA_DIR, settings

_driver = None  # neo4j.Driver，惰性创建
_status = {"state": "idle", "done": 0, "total": 0, "message": ""}  # idle/running/done/error

# 分片中的页码标记（ingestion 切分时写入），详情片段展示前剔除
_PAGE_RE = re.compile(r"@@PAGE_\d+@@")

ENTITY_PROMPT = (
    "你是知识图谱构建助手。请从以下文档片段中提取 {n} 个左右的核心实体或概念"
    "（如：系统名称、技术/协议、组件、业务流程、指标、制度、组织、项目等）。\n"
    "要求：实体名使用简短、规范、跨文档通用的名词（一般不超过 12 个字），"
    "如「MQTT」「PPA」「岸桥远控」「知识库」，避免过长的描述性短语；合并同义与别称。\n"
    "只输出 JSON 字符串数组，例如：[\"MQTT\", \"PPA\", \"岸桥远控\"]，不要输出任何其他内容。\n\n"
    "文档片段：\n{text}"
)


# ---------------- Neo4j 连接 ----------------

def _get_driver():
    global _driver
    if _driver is None:
        from neo4j import GraphDatabase

        _driver = GraphDatabase.driver(
            settings.neo4j_uri, auth=(settings.neo4j_user, settings.neo4j_password)
        )
    return _driver


def available() -> bool:
    """Neo4j 是否可连接。"""
    try:
        _get_driver().verify_connectivity()
        return True
    except Exception:
        return False


def _close():
    global _driver
    if _driver is not None:
        _driver.close()
        _driver = None


# ---------------- 实体抽取 ----------------

def _kg_llm():
    """构建期专用 LLM（不与主链路共享缓存实例，避免跨事件循环冲突）。"""
    from langchain_openai import ChatOpenAI

    extra_body = {}
    if settings.disable_thinking:
        extra_body["chat_template_kwargs"] = {"enable_thinking": False}
    return ChatOpenAI(
        base_url=settings.llm_base_url,
        api_key=settings.llm_api_key,
        model=settings.llm_model,
        temperature=0.2,
        max_retries=1,
        timeout=180,
        extra_body=extra_body or None,
    )


def _parse_entities(content: str) -> list[str]:
    # 剥离 Qwen3 等模型的思考块，再取最后一个 JSON 数组
    content = re.sub(r"<think>.*?</think>", "", content, flags=re.S).strip()
    items = None
    for m in reversed(re.findall(r"\[.*?\]", content, re.S)):
        try:
            items = json.loads(m)
            if isinstance(items, list):
                break
        except Exception:
            continue
    if not isinstance(items, list):
        return []
    out = []
    for it in items:
        if isinstance(it, str) and (e := it.strip()) and 1 < len(e) <= 30:
            out.append(e)
    return list(dict.fromkeys(out))[: settings.kg_entities_per_doc]


def _fallback_keywords(text: str) -> list[str]:
    """LLM 抽取失败时的兜底：无依赖的词频关键词（中英混合）。"""
    from collections import Counter

    text = text[:8000]
    cn = re.findall(r"[\u4e00-\u9fa5]{2,4}(?=[\u4e00-\u9fa5])", text)
    en = re.findall(r"[A-Za-z][A-Za-z0-9-]{2,15}", text)
    stop = {"我们", "他们", "这个", "那个", "以及", "可以", "需要", "进行", "已经",
            "the", "and", "for", "with", "this", "that", "from", "are", "was"}
    cnt = Counter(w for w in cn + en if w.lower() not in stop and not w.isdigit())
    return [w for w, _ in cnt.most_common(settings.kg_entities_per_doc)]


def _extract_all(docs: list[dict]) -> dict[str, list[str]]:
    """单事件循环内顺序抽取每份文档的实体（LLM 调用失败/解析失败返回空列表）。"""

    async def _one(llm, text: str) -> list[str]:
        prompt = ENTITY_PROMPT.format(n=settings.kg_entities_per_doc, text=text[:4000])
        for _ in range(2):  # 失败重试一次
            try:
                resp = await llm.ainvoke(prompt)
                ents = _parse_entities(resp.content)
                if ents:
                    return ents
            except Exception:
                continue
        return _fallback_keywords(text)  # LLM 不可用时的词频兜底

    async def run() -> dict[str, list[str]]:
        llm = _kg_llm()
        out = {}
        for d in docs:
            text = _doc_chunks_text(d["doc_id"])
            out[d["doc_id"]] = await _one(llm, text) if text else []
        return out

    return asyncio.run(run())


def _doc_chunks_text(doc_id: str) -> str:
    """采样该文档的前若干分片文本，作为实体抽取语料。"""
    try:
        raw = vectorstore.get_vectorstore()._collection.get(
            where={"doc_id": doc_id}, include=["documents"], limit=settings.kg_sample_chunks
        )
        return "\n".join(t for t in (raw.get("documents") or []) if t)
    except Exception:
        return ""


# ---------------- 建图 ----------------

def build_graph() -> None:
    """全量重建：清空后逐文档抽取实体写入 Neo4j，再生成文档间 RELATED 关联。"""
    global _status
    _status = {"state": "running", "done": 0, "total": 0, "message": ""}
    try:
        docs = vectorstore.list_documents()
        _status["total"] = len(docs)
        entities_map = _extract_all(docs)  # LLM 抽取阶段（单事件循环）
        with _get_driver().session() as session:
            session.run("MATCH (n) DETACH DELETE n")  # 全量重建
            for d in docs:
                entities = entities_map.get(d["doc_id"], [])
                session.run(
                    """
                    MERGE (doc:Document {doc_id: $doc_id})
                    SET doc.name = $name, doc.owner = $owner, doc.scope = $scope, doc.chunks = $chunks
                    """,
                    doc_id=d["doc_id"], name=d["name"], owner=d.get("owner"),
                    scope=d.get("scope", "public"), chunks=d.get("chunks", 0),
                )
                for e in entities:
                    # 实体归一化：与已有实体做大小写无关/包含匹配，复用规范名
                    canonical = session.run(
                        """
                        MATCH (ent:Entity)
                        WHERE toLower(ent.name) = toLower($n)
                           OR (ent.name CONTAINS $n AND size($n) >= 2)
                           OR ($n CONTAINS ent.name AND size(ent.name) >= 2)
                        RETURN ent.name AS name ORDER BY size(ent.name) ASC LIMIT 1
                        """,
                        n=e,
                    ).single()
                    name = canonical["name"] if canonical else e
                    session.run(
                        """
                        MATCH (doc:Document {doc_id: $doc_id})
                        MERGE (ent:Entity {name: $name})
                        MERGE (doc)-[r:MENTIONS]->(ent)
                        SET r.weight = coalesce(r.weight, 0) + 1
                        """,
                        doc_id=d["doc_id"], name=name,
                    )
                _status["done"] += 1
            # 文档关联：共享 >=1 个实体即 RELATED，shared 为共享实体数
            session.run(
                """
                MATCH (a:Document)-[:MENTIONS]->(e:Entity)<-[:MENTIONS]-(b:Document)
                WHERE a.doc_id < b.doc_id
                WITH a, b, count(e) AS shared
                MERGE (a)-[r:RELATED]->(b)
                SET r.shared = shared
                """
            )
        _status = {"state": "done", "done": _status["done"], "total": _status["total"],
                   "message": f"已为 {_status['done']} 份文档构建图谱"}
    except Exception as e:
        _status = {"state": "error", "done": 0, "total": 0, "message": str(e)[:300]}


def start_build_async() -> bool:
    """后台线程触发构建；已有构建进行中则忽略，返回是否成功启动。"""
    if _status["state"] == "running":
        return False
    if not available():
        return False
    threading.Thread(target=build_graph, daemon=True).start()
    return True


def build_status() -> dict:
    return dict(_status)


# ---------------- 图数据服务 ----------------

def _rebuild_related(session) -> None:
    """按现存 Document-Entity 关系重算文档间 RELATED 边（shared = 共享实体数）。"""
    session.run("MATCH ()-[r:RELATED]->() DELETE r")
    session.run(
        """
        MATCH (a:Document)-[:MENTIONS]->(e:Entity)<-[:MENTIONS]-(b:Document)
        WHERE a.doc_id < b.doc_id
        WITH a, b, count(e) AS shared
        MERGE (a)-[r:RELATED]->(b)
        SET r.shared = shared
        """
    )


def _purge_stale(session, keep_ids: list[str]) -> None:
    """清理知识库中已不存在的文档节点与孤立实体（删除联动兜底）。"""
    session.run(
        "MATCH (d:Document) WHERE NOT d.doc_id IN $ids DETACH DELETE d",
        ids=keep_ids,
    )
    session.run("MATCH (e:Entity) WHERE NOT (()-[:MENTIONS]->(e)) DELETE e")
    _rebuild_related(session)


def remove_document(doc_id: str) -> bool:
    """删除文档时联动清理 Neo4j：删文档节点 → 清孤立实体 → 重算 RELATED。

    Neo4j 未连接时返回 False（调用方静默跳过，不影响 Chroma 删除）。
    """
    if not available():
        return False
    try:
        with _get_driver().session() as session:
            session.run("MATCH (d:Document {doc_id: $doc_id}) DETACH DELETE d", doc_id=doc_id)
            session.run("MATCH (e:Entity) WHERE NOT (()-[:MENTIONS]->(e)) DELETE e")
            _rebuild_related(session)
        return True
    except Exception:
        return False


def _doc_ids(visible: set[str] | None) -> list[str]:
    """可见文档 id 列表：None 表示全部可见。"""
    if visible is not None:
        return list(visible)
    return [d["doc_id"] for d in vectorstore.list_documents()]


def get_graph(include_entities: bool = True, visible: set[str] | None = None) -> dict:
    """返回 ECharts graph 数据：nodes/links + 构建状态 + Neo4j 可用性。

    visible: 当前用户可见的 doc_id 集合（None = 全部）；不可见文档及其实体边不返回。
    """
    result = {"available": available(), "status": build_status(), "nodes": [], "links": []}
    if not result["available"] or _status["state"] == "running":
        return result
    try:
        with _get_driver().session() as session:
            # 与知识库 registry 对账：清理已删除文档的残留节点（保证两套库数量一致）
            _purge_stale(session, [d["doc_id"] for d in vectorstore.list_documents()])
            docs = session.run(
                "MATCH (d:Document) RETURN d.doc_id AS id, d.name AS name, d.owner AS owner, "
                "d.scope AS scope, d.chunks AS chunks, "
                "[(d)-[:MENTIONS]->(e) | e.name] AS entities"
            ).data()
            if visible is not None:
                docs = [d for d in docs if d["id"] in visible]
            doc_ids = {d["id"] for d in docs}
            nodes = [
                {
                    "id": d["id"],
                    "name": d["name"],
                    "category": 0,
                    "owner": d.get("owner"),
                    "scope": d.get("scope", "public"),
                    "chunks": d.get("chunks", 0),
                    "symbolSize": min(26 + len(d.get("entities") or []) * 4, 52),
                }
                for d in docs
            ]
            links = []
            if include_entities and doc_ids:
                ents = session.run(
                    """
                    MATCH (e:Entity)<-[:MENTIONS]-(d:Document)
                    WHERE d.doc_id IN $ids
                    WITH e, count(d) AS deg
                    ORDER BY deg DESC, e.name LIMIT $limit
                    RETURN e.name AS name, deg
                    """,
                    ids=list(doc_ids), limit=settings.kg_max_entity_nodes,
                ).data()
                ent_ids = {e["name"] for e in ents}
                nodes += [
                    {"id": f"e:{e['name']}", "name": e["name"], "category": 1,
                     "symbolSize": min(10 + e["deg"] * 3, 30)}
                    for e in ents
                ]
                for rel in session.run(
                    "MATCH (d:Document)-[r:MENTIONS]->(e:Entity) "
                    "WHERE d.doc_id IN $ids "
                    "RETURN d.doc_id AS s, e.name AS t, r.weight AS w",
                    ids=list(doc_ids),
                ).data():
                    if rel["t"] in ent_ids:
                        links.append({"source": rel["s"], "target": f"e:{rel['t']}",
                                      "kind": "mentions", "value": rel.get("w", 1)})
            for rel in session.run(
                "MATCH (a:Document)-[r:RELATED]->(b:Document) "
                "RETURN a.doc_id AS s, b.doc_id AS t, r.shared AS shared"
            ).data():
                if rel["s"] in doc_ids and rel["t"] in doc_ids:
                    links.append({"source": rel["s"], "target": rel["t"],
                                  "kind": "related", "value": rel.get("shared", 1)})
        result["nodes"], result["links"] = nodes, links
        return result
    except Exception as e:
        result["available"] = False
        result["status"] = {"state": "error", "message": str(e)[:300]}
        return result


# ---------------- 实体搜索与节点详情 ----------------

def search_entities(q: str, limit: int = 10, visible: set[str] | None = None) -> list[dict]:
    """按关键词搜索实体（图谱页搜索框），返回 [{name, deg}]，deg 为当前用户可见的关联文档数。"""
    if not available() or not q:
        return []
    ids = _doc_ids(visible)
    if not ids:
        return []
    try:
        with _get_driver().session() as session:
            rows = session.run(
                """
                MATCH (d:Document)-[:MENTIONS]->(e:Entity)
                WHERE e.name CONTAINS $q AND d.doc_id IN $ids
                RETURN e.name AS name, count(d) AS deg
                ORDER BY deg DESC, size(e.name) ASC, name LIMIT $limit
                """,
                q=q, ids=ids, limit=limit,
            ).data()
        return [{"name": r["name"], "deg": r["deg"]} for r in rows]
    except Exception:
        return []


def _match_chunks(doc_id: str, name: str, limit: int = 3) -> list[dict]:
    """在指定文档的分片中查找包含实体名的原文片段（含页码），供节点详情展示。"""
    lname = name.lower()
    hits: list[dict] = []
    try:
        raw = vectorstore.get_vectorstore()._collection.get(
            where={"doc_id": doc_id}, include=["documents", "metadatas"]
        )
        for text, meta in zip(raw.get("documents") or [], raw.get("metadatas") or []):
            if not text or lname not in text.lower():
                continue
            pos = text.lower().find(lname)
            snippet = text[max(0, pos - 60): pos + len(name) + 140]
            snippet = _PAGE_RE.sub(" ", snippet)
            snippet = re.sub(r"\s+", " ", snippet).strip()
            pages = [int(x) for x in str(meta.get("pages", "") or "").split(",") if x.strip().isdigit()]
            hits.append({"snippet": snippet, "pages": pages})
            if len(hits) >= limit:
                break
    except Exception:
        pass
    return hits


def entity_detail(name: str, visible: set[str] | None = None) -> dict | None:
    """实体节点详情：关联文档列表 + 每份文档中命中该实体的原文片段（页码溯源）。

    visible: 仅返回当前用户可见的文档；全部不可见时返回 None。
    """
    if not available():
        return None
    try:
        with _get_driver().session() as session:
            docs = session.run(
                """
                MATCH (d:Document)-[r:MENTIONS]->(e:Entity {name: $name})
                RETURN d.doc_id AS doc_id, d.name AS name, d.scope AS scope,
                       d.owner AS owner, r.weight AS weight
                ORDER BY r.weight DESC
                """,
                name=name,
            ).data()
        if visible is not None:
            docs = [d for d in docs if d["doc_id"] in visible]
        if not docs:
            return None
        for d in docs:
            d["matches"] = _match_chunks(d["doc_id"], name)
        return {"name": name, "doc_count": len(docs), "docs": docs}
    except Exception:
        return None


# ---------------- 图增强召回（RRF 融合的图一路候选） ----------------

# 领域术语词典（可选，data/terms.json）：
# {"规范实体名": ["别名1", "别名2"]}，用于把口语/缩写链接到图谱中的规范实体
TERMS_PATH = DATA_DIR / "terms.json"


def _term_hits(query: str) -> list[str]:
    """术语词典实体链接：查询中出现规范名或任一同义词 → 返回规范实体名。"""
    try:
        terms = json.loads(TERMS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []
    low = query.lower()
    hits = []
    for canonical, aliases in terms.items():
        words = [canonical] + [a for a in (aliases or []) if a]
        if any(w.lower() in low for w in words):
            hits.append(canonical)
    return hits


def match_entities(query: str, limit: int = 8) -> list[str]:
    """实体链接：图谱中名字出现在查询里的实体 + 术语词典别名映射到的规范实体。"""
    if not available() or not query:
        return []
    names: list[str] = []
    try:
        with _get_driver().session() as session:
            rows = session.run(
                "MATCH (e:Entity) WHERE $q CONTAINS e.name "
                "RETURN e.name AS name ORDER BY size(e.name) DESC LIMIT $limit",
                q=query, limit=limit,
            ).data()
            names += [r["name"] for r in rows]
            # 词典命中：把规范名（或其别名）模糊对齐到图谱里已抽取的实体
            for canon in _term_hits(query):
                row = session.run(
                    """
                    MATCH (e:Entity)
                    WHERE toLower(e.name) = toLower($n)
                       OR e.name CONTAINS $n OR $n CONTAINS e.name
                    RETURN e.name AS name ORDER BY size(e.name) DESC LIMIT 1
                    """,
                    n=canon,
                ).single()
                if row:
                    names.append(row["name"])
    except Exception:
        return []
    return list(dict.fromkeys(names))[:limit]


def neighbor_chunks(query: str, allowed=None, max_docs: int = 3, per_doc: int = 2,
                    hops: int = 2) -> list[tuple]:
    """图增强召回：实体链接 → 1~2 跳邻居文档 → 各文档内向量检索最相关分片。

    hop1：直接提及命中实体的文档；hop2：与 hop1 文档存在共享实体关联（RELATED）的文档。
    返回 [(Document, 相似度)]，作为与向量召回并列的一路候选，由调用方做 RRF 融合。
    """
    if not available() or _status["state"] == "running":
        return []
    try:
        ents = match_entities(query)
        if not ents:
            return []
        with _get_driver().session() as session:
            hop1 = [
                r["doc_id"]
                for r in session.run(
                    """
                    MATCH (d:Document)-[:MENTIONS]->(e:Entity)
                    WHERE e.name IN $ents
                    RETURN d.doc_id AS doc_id, count(e) AS n
                    ORDER BY n DESC LIMIT $m
                    """,
                    ents=ents, m=max_docs,
                ).data()
            ]
            doc_ids = list(hop1)
            if hops >= 2 and hop1:
                hop2 = [
                    r["doc_id"]
                    for r in session.run(
                        """
                        MATCH (d:Document)-[r:RELATED]-(d2:Document)
                        WHERE d.doc_id IN $ids AND NOT d2.doc_id IN $ids
                        RETURN DISTINCT d2.doc_id AS doc_id, r.shared AS shared
                        ORDER BY shared DESC LIMIT $m
                        """,
                        ids=hop1, m=max(0, max_docs - len(hop1)),
                    ).data()
                ]
                doc_ids += [x for x in hop2 if x not in doc_ids]
        vs = vectorstore.get_vectorstore()
        out: list[tuple] = []
        for did in doc_ids[:max_docs + 2]:
            for d, dist in vs.similarity_search_with_score(query, k=per_doc, filter={"doc_id": did}):
                if allowed and not allowed(d.metadata):
                    continue
                out.append((d, 1.0 - dist))
        return out
    except Exception:
        return []
