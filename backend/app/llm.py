"""LLM 与 Embedding 封装：统一走 OpenAI 兼容接口，无缝切换 Ollama / vLLM。

模型：Qwen3-14B（生成）+ bge-m3（向量化，1024 维），参照 RAGFlow / QAnything 选型。
"""
from functools import lru_cache

from langchain_openai import ChatOpenAI, OpenAIEmbeddings

from .config import settings


@lru_cache
def get_llm(streaming: bool = True) -> ChatOpenAI:
    """Qwen3-14B 聊天模型。Qwen3 支持混合思考，RAG 场景关闭 thinking 提速。"""
    extra_body = {}
    if settings.disable_thinking:
        # vLLM: chat_template_kwargs；Ollama 会忽略未知参数
        extra_body["chat_template_kwargs"] = {"enable_thinking": False}
    return ChatOpenAI(
        base_url=settings.llm_base_url,
        api_key=settings.llm_api_key,
        model=settings.llm_model,
        temperature=settings.temperature,
        streaming=streaming,
        extra_body=extra_body or None,
        max_retries=2,
        timeout=300,
    )


@lru_cache
def get_embeddings() -> OpenAIEmbeddings:
    """bge-m3 嵌入模型（1024 维，中英混合语料最强开源 Embedding 之一）。"""
    return OpenAIEmbeddings(
        base_url=settings.embed_base_url,
        api_key=settings.embed_api_key,
        model=settings.embed_model,
        check_embedding_ctx_length=False,
    )
