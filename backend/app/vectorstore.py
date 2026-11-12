"""向量存储：Chroma 持久化 + cosine 相似度空间（文章方案，轻量适合中小企业）。"""
import json
import time
import uuid
from typing import Any

from langchain_chroma import Chroma
from langchain_core.documents import Document

from .config import DATA_DIR, UPLOAD_DIR, settings
from .llm import get_embeddings

COLLECTION = "knowledge_base"
REGISTRY_PATH = DATA_DIR / "registry.json"
FOLDERS_PATH = DATA_DIR / "folders.json"

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


def search(
    query: str,
    top_k: int | None = None,
    allowed: Any = None,
) -> list[tuple[Document, float]]:
    """检索并换算为相似度分数（cos_sim = 1 - distance），降序返回。

    allowed: 可选回调 (metadata) -> bool，用于个人/公有知识库的可见范围过滤。
    为兼容历史分片（无 scope 元数据），采用超采样后客户端过滤，而非 Chroma where 条件。
    """
    store = get_vectorstore()
    k = top_k or settings.top_k
    if allowed:
        results = store.similarity_search_with_score(query, k=min(k * 6, 48))
        scored = [(doc, 1.0 - dist) for doc, dist in results if allowed(doc.metadata)]
        return sorted(scored, key=lambda x: x[1], reverse=True)[:k]
    results = store.similarity_search_with_score(query, k=k)
    scored = [(doc, 1.0 - dist) for doc, dist in results]
    return sorted(scored, key=lambda x: x[1], reverse=True)


def register_document(
    name: str,
    chunks: int,
    size: int,
    doc_id: str | None = None,
    owner: str | None = None,
    scope: str = "public",
    folder_id: str | None = None,
    path: str | None = None,
) -> str:
    """登记文档。doc_id 必须与分片元数据中的 doc_id 一致，否则删除时会清不掉向量。"""
    reg = _load_registry()
    doc_id = doc_id or str(uuid.uuid4())[:8]
    reg[doc_id] = {
        "doc_id": doc_id,
        "name": name,
        "chunks": chunks,
        "size": size,
        "owner": owner,
        "scope": scope,  # public=公有知识库 / private=个人知识库
        "folder_id": folder_id,  # 知识库内的文件夹归属（None=未分组）
        "access": "open",  # open=全员可见 / restricted=仅指定成员
        "path": path,  # 原文件路径（用于在线预览/下载）
        "uploaded_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "status": "ready",
    }
    _save_registry(reg)
    return reg[doc_id]


def get_document(doc_id: str) -> dict | None:
    return _load_registry().get(doc_id)


def backfill_paths() -> int:
    """历史文档补全原文件路径（早期版本未记录 path，文件仍在上传目录同名保存）。

    启动时执行一次，幂等；补全后这些文档也能按真实版式逐页渲染/下载。
    """
    reg = _load_registry()
    changed = 0
    for d in reg.values():
        if d.get("path"):
            continue
        name = d.get("name") or ""
        candidate = UPLOAD_DIR / name
        if name and candidate.exists():
            d["path"] = str(candidate)
            changed += 1
    if changed:
        _save_registry(reg)
    return changed


def list_documents() -> list[dict]:
    reg = _load_registry()
    return sorted(reg.values(), key=lambda x: x["uploaded_at"], reverse=True)


# ---------------- 知识库文件夹 ----------------

def _load_folders() -> dict[str, Any]:
    if FOLDERS_PATH.exists():
        return json.loads(FOLDERS_PATH.read_text(encoding="utf-8"))
    return {}


def _save_folders(folders: dict[str, Any]) -> None:
    FOLDERS_PATH.write_text(json.dumps(folders, ensure_ascii=False, indent=2), encoding="utf-8")


def list_folders() -> list[dict]:
    """文件夹列表（扁平，含 parent_id 与直接文档数），前端据此组装树。"""
    counts: dict[str, int] = {}
    for d in _load_registry().values():
        fid = d.get("folder_id")
        if fid:
            counts[fid] = counts.get(fid, 0) + 1
    out = []
    for f in _load_folders().values():
        item = dict(f)
        item["count"] = counts.get(f["id"], 0)
        out.append(item)
    return sorted(out, key=lambda x: x.get("created_at", ""))


def folder_depth(folder_id: str | None, folders: dict[str, Any] | None = None) -> int:
    """文件夹层级深度（根为 0），用于限制创建深度与防环。"""
    folders = folders if folders is not None else _load_folders()
    depth, cur, guard = 0, folder_id, 0
    while cur and cur in folders and guard < 32:
        depth += 1
        cur = folders[cur].get("parent_id")
        guard += 1
    return depth


def create_folder(
    name: str,
    scope: str = "public",
    owner: str | None = None,
    parent_id: str | None = None,
) -> dict:
    """新建文件夹（可指定父文件夹，支持多级）；同级同名直接复用（幂等）。"""
    folders = _load_folders()
    parent_id = parent_id or None
    if parent_id and parent_id not in folders:
        raise ValueError("父文件夹不存在")
    if parent_id and folder_depth(parent_id, folders) >= 5:
        raise ValueError("文件夹层级过深（最多 5 级）")
    for f in folders.values():
        if f["name"] == name and f.get("scope") == scope and f.get("owner") == owner and f.get("parent_id") == parent_id:
            return f
    fid = str(uuid.uuid4())[:8]
    folders[fid] = {
        "id": fid,
        "name": name,
        "scope": scope,
        "owner": owner,
        "parent_id": parent_id,
        "access": "open",  # open=全员可见 / restricted=仅指定成员
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    _save_folders(folders)
    return folders[fid]


def set_folder_access(folder_id: str, access: str) -> dict | None:
    """设置文件夹可见范围（open / restricted）。"""
    folders = _load_folders()
    if folder_id not in folders:
        return None
    folders[folder_id]["access"] = access
    _save_folders(folders)
    return folders[folder_id]


def set_document_access(doc_id: str, access: str) -> dict | None:
    """设置单份文档的可见范围（open / restricted），优先级高于文件夹继承。"""
    reg = _load_registry()
    if doc_id not in reg:
        return None
    reg[doc_id]["access"] = access
    _save_registry(reg)
    return reg[doc_id]


def delete_folder(folder_id: str) -> bool:
    """递归删除文件夹及其子文件夹；其中文档移到被删文件夹的父级（不删文档、不删向量）。"""
    folders = _load_folders()
    if folder_id not in folders:
        return False
    target_parent = folders[folder_id].get("parent_id")

    # 收集自身 + 全部后代
    doomed = {folder_id}
    changed = True
    while changed:
        changed = False
        for fid, f in folders.items():
            if fid not in doomed and f.get("parent_id") in doomed:
                doomed.add(fid)
                changed = True

    for fid in doomed:
        folders.pop(fid, None)
    _save_folders(folders)

    reg = _load_registry()
    touched = False
    for d in reg.values():
        if d.get("folder_id") in doomed:
            d["folder_id"] = target_parent
            touched = True
    if touched:
        _save_registry(reg)
    return True


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
