"""向量存储：Chroma 持久化 + cosine 相似度空间（文章方案，轻量适合中小企业）。"""
import json
import time
import uuid
from typing import Any

from langchain_chroma import Chroma
from langchain_core.documents import Document

from .config import DATA_DIR, settings
from .llm import get_embeddings

COLLECTION = "knowledge_base"
REGISTRY_PATH = DATA_DIR / "registry.json"

# cosine 空间：distance = 1 - cos_sim，越小越相似
_COLLECTION_META = {"hnsw:space": "cosine"}


def _load_registry() -> dict[str, Any]:
    if REGISTRY_PATH.exists():
        return json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    return {}


def _save_registry(reg: dict[str, Any]) -> None:
    REGISTRY_PATH.write_text(json.dumps(reg, ensure_ascii=False, indent=2), encoding="utf-8")


def get_vectorstore() -> Chroma:
    return Chroma(
        collection_name=COLLECTION,
        embedding_function=get_embeddings(),
        persist_directory=settings.chroma_dir,
        collection_metadata=_COLLECTION_META,
    )


def add_documents(docs: list[Document]) -> int:
    for d in docs:
        d.metadata.setdefault("chunk_id", str(uuid.uuid4()))
    get_vectorstore().add_documents(docs)
    return len(docs)


def search(query: str, top_k: int | None = None) -> list[tuple[Document, float]]:
    """检索并换算为相似度分数（cos_sim = 1 - distance），降序返回。"""
    store = get_vectorstore()
    k = top_k or settings.top_k
    results = store.similarity_search_with_score(query, k=k)
    scored = [(doc, 1.0 - dist) for doc, dist in results]
    return sorted(scored, key=lambda x: x[1], reverse=True)


def register_document(name: str, chunks: int, size: int, doc_id: str | None = None) -> str:
    """登记文档。doc_id 必须与分片元数据中的 doc_id 一致，否则删除时会清不掉向量。"""
    reg = _load_registry()
    doc_id = doc_id or str(uuid.uuid4())[:8]
    reg[doc_id] = {
        "doc_id": doc_id,
        "name": name,
        "chunks": chunks,
        "size": size,
        "uploaded_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "status": "ready",
    }
    _save_registry(reg)
    return reg[doc_id]


def list_documents() -> list[dict]:
    reg = _load_registry()
    return sorted(reg.values(), key=lambda x: x["uploaded_at"], reverse=True)


def delete_document(doc_id: str) -> bool:
    reg = _load_registry()
    info = reg.pop(doc_id, None)
    if info is None:
        return False
    # Chroma 按元数据删除该文档全部分片（doc_id 与分片一致，删不干净会显式报错）
    raw = get_vectorstore()._collection.get(where={"doc_id": doc_id})
    if raw and raw["ids"]:
        get_vectorstore()._collection.delete(ids=raw["ids"])
    _save_registry(reg)
    return True


def stats() -> dict:
    reg = _load_registry()
    total_chunks = sum(d["chunks"] for d in reg.values())
    return {"documents": len(reg), "chunks": total_chunks}
