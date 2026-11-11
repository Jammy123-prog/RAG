"""企业知识库 RAG 服务入口。

技术栈：LangChain + Qwen3-14B(vLLM) + bge-m3 + Chroma + FastAPI（参照 langchain-chatchat）。

模块（参照 Dify / FastGPT 的多租户与会话模型）：
- 认证：注册/登录/令牌校验，首个注册用户自动成为管理员
- 会话：每个用户的对话历史相互隔离，支持新建/切换/删除/续聊
- 问答：SSE 流式，问答与引用来源落库持久化
- 文档：公有知识库 + 个人知识库（上传时可选择归属），检索范围为二者并集
- 知识图谱：Neo4j 存储文档-实体-关联，/api/kg/* 提供可视化数据与重建入口
- 前端生产构建由本服务单端口托管（/），局域网直接访问 :8010
"""
import json
import shutil
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import ingestion, kg, preview as doc_preview, store, vectorstore
from .auth import get_user, make_token, require_admin
from .config import BASE_DIR, DATA_DIR, settings
from .rag import chat_stream

app = FastAPI(title="企业知识库 RAG 系统", version="1.1.0")

store.init_db()
vectorstore.backfill_paths()  # 历史文档补全原文件路径（支持页面级预览/下载）

# 文档内嵌图片：/api/images/{doc_id}/p{页}_{序号}.jpg
app.mount("/api/images", StaticFiles(directory=ingestion.IMAGES_DIR), name="images")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==================== 认证 ====================

class AuthForm(BaseModel):
    username: str
    password: str


@app.post("/api/auth/register")
async def register(form: AuthForm):
    username, password = form.username.strip(), form.password
    if not (2 <= len(username) <= 32) or not username.replace("_", "").replace("-", "").isalnum():
        raise HTTPException(400, "用户名需为 2-32 位字母/数字/下划线/短横线")
    if len(password) < 4:
        raise HTTPException(400, "密码至少 4 位")
    if store.verify_login(username, password) or store.list_users() and any(u["username"] == username for u in store.list_users()):
        raise HTTPException(400, "用户名已存在")
    user = store.create_user(username, password)
    return {"token": make_token(user["id"]), "user": _safe_user(user)}


@app.post("/api/auth/login")
async def login(form: AuthForm):
    user = store.verify_login(form.username.strip(), form.password)
    if not user:
        raise HTTPException(401, "用户名或密码错误")
    return {"token": make_token(user["id"]), "user": _safe_user(user)}


@app.get("/api/auth/me")
async def me(user: dict = Depends(get_user)):
    return _safe_user(user)


def _safe_user(u: dict) -> dict:
    return {"uid": u["id"], "username": u["username"], "role": u["role"], "created_at": u["created_at"]}


# ==================== 用户管理（管理员） ====================

@app.get("/api/admin/users")
async def admin_users(user: dict = Depends(get_user)):
    require_admin(user)
    return store.list_users()


@app.delete("/api/admin/users/{uid}")
async def admin_delete_user(uid: int, user: dict = Depends(get_user)):
    require_admin(user)
    if uid == user["id"]:
        raise HTTPException(400, "不能删除自己")
    if not store.delete_user(uid):
        raise HTTPException(404, "用户不存在")
    return {"ok": True}


# ==================== 会话 ====================

@app.get("/api/conversations")
async def conversations(user: dict = Depends(get_user)):
    return store.list_conversations(user["id"])


@app.post("/api/conversations")
async def create_conversation(user: dict = Depends(get_user)):
    return store.create_conversation(user["id"])


@app.delete("/api/conversations/{cid}")
async def delete_conversation(cid: str, user: dict = Depends(get_user)):
    if not store.delete_conversation(cid, user["id"]):
        raise HTTPException(404, "会话不存在")
    return {"ok": True}


@app.get("/api/conversations/{cid}/messages")
async def conversation_messages(cid: str, user: dict = Depends(get_user)):
    if not store.get_conversation(cid, user["id"]):
        raise HTTPException(404, "会话不存在")
    return store.get_messages(cid)


# ==================== 问答（SSE 流式 + 落库持久化） ====================

class ChatRequest(BaseModel):
    message: str
    conversation_id: str | None = None  # 为空则自动新建会话


@app.post("/api/chat/stream")
async def chat_stream_endpoint(req: ChatRequest, user: dict = Depends(get_user)):
    """SSE 流式问答；历史从数据库加载（用户隔离），问答与引用来源持久化。"""
    uid = user["id"]

    # 会话归属校验：不存在或不属于该用户 → 新建
    conv = store.get_conversation(req.conversation_id, uid) if req.conversation_id else None
    if not conv:
        conv = store.create_conversation(uid)
    cid = conv["id"]

    # 历史取最近 3 轮（6 条）用于查询改写
    history = [{"role": m["role"], "content": m["content"]} for m in store.get_messages(cid)][-6:]

    # 首条消息用其前 20 字符作为会话标题
    if store.conversation_message_count(cid) == 0:
        store.touch_conversation(cid, req.message.strip()[:20] or "新对话")

    store.add_message(cid, "user", req.message)

    async def gen():
        meta_info = {"conversation_id": cid, "mode": "fallback", "sources": []}
        answer = ""
        try:
            async for event in chat_stream(req.message, history, viewer={"username": user["username"], "role": user["role"]}):
                if event["type"] == "meta":
                    meta_info.update({"mode": event["mode"], "sources": event["sources"], "graph_docs": event.get("graph_docs", [])})
                elif event["type"] == "delta":
                    answer += event.get("text", "")
                yield f"event: {event['type']}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as e:  # 流式出错也给出明确信号
            if answer:
                answer += "\n\n（生成中断）"
            yield f"event: error\ndata: {json.dumps({'message': str(e)}, ensure_ascii=False)}\n\n"
        finally:
            meta_info.pop("conversation_id", None)
            store.add_message(cid, "assistant", answer or "（无内容）", {"mode": meta_info["mode"], "sources": meta_info["sources"]})
            store.touch_conversation(cid)
            # 首个事件前注入会话 id（前端据此刷新会话列表）
            yield f"event: done\ndata: {json.dumps({'type': 'done', 'conversation_id': cid}, ensure_ascii=False)}\n\n"

    # 把 conversation_id 作为首个事件发出
    async def with_conv_id():
        yield f"event: meta\ndata: {json.dumps({'type': 'conv', 'conversation_id': cid}, ensure_ascii=False)}\n\n"
        async for chunk in gen():
            yield chunk

    return StreamingResponse(with_conv_id(), media_type="text/event-stream")


# ==================== 知识库统计 ====================

@app.get("/api/health")
async def health():
    return {"status": "ok", "llm": settings.llm_model, "embed": settings.embed_model}


@app.get("/api/stats")
async def get_stats(user: dict = Depends(get_user)):
    return vectorstore.stats()


# ==================== 文档管理 ====================

# ---------------- 知识库文件夹 ----------------

class FolderForm(BaseModel):
    name: str
    scope: str = "public"
    parent_id: str | None = None


def _visible_doc(d: dict, user: dict) -> bool:
    return (
        user["role"] == "admin"
        or d.get("scope", "public") == "public"
        or d.get("owner") in (None, user["username"])
    )


@app.get("/api/folders")
async def list_folders(user: dict = Depends(get_user)):
    """文件夹列表（附文档数）：公有文件夹 + 本人私有文件夹，管理员可见全部。"""
    folders = vectorstore.list_folders()
    out = []
    for f in folders:
        if user["role"] == "admin" or f.get("scope", "public") == "public" or f.get("owner") in (None, user["username"]):
            out.append(f)
    return out


@app.post("/api/folders")
async def create_folder(form: FolderForm, user: dict = Depends(get_user)):
    name = form.name.strip()
    if not (1 <= len(name) <= 32):
        raise HTTPException(400, "文件夹名称需为 1-32 个字符")
    if form.scope not in ("public", "private"):
        raise HTTPException(400, "scope 仅支持 public / private")
    parent_id = (form.parent_id or "").strip() or None
    if parent_id:
        parent = next((f for f in vectorstore.list_folders() if f["id"] == parent_id), None)
        if not parent:
            raise HTTPException(404, "父文件夹不存在")
        if parent.get("scope", "public") != form.scope:
            raise HTTPException(400, "父文件夹归属与当前知识库不一致")
    try:
        return vectorstore.create_folder(name, scope=form.scope, owner=user["username"], parent_id=parent_id)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.delete("/api/folders/{folder_id}")
async def delete_folder(folder_id: str, user: dict = Depends(get_user)):
    folders = {f["id"]: f for f in vectorstore.list_folders()}
    info = folders.get(folder_id)
    if not info:
        raise HTTPException(404, "文件夹不存在")
    if user["role"] != "admin" and info.get("owner") not in (None, user["username"]):
        raise HTTPException(403, "仅文件夹创建者或管理员可删除")
    vectorstore.delete_folder(folder_id)
    return {"ok": True, "message": "文件夹及其子文件夹已删除，其中文档已移到上一级"}


# ---------------- 文档上传 / 列表 / 预览 ----------------

@app.post("/api/documents/upload")
async def upload_documents(
    files: list[UploadFile] = File(...),
    scope: str = Form("public"),
    folder_id: str = Form(""),
    user: dict = Depends(get_user),
):
    """多文件并行入库；支持指定知识库归属（public/private）与目标文件夹。"""
    if scope not in ("public", "private"):
        raise HTTPException(400, "scope 仅支持 public / private")
    folder_id = folder_id.strip() or None
    if folder_id:
        folder = next((f for f in vectorstore.list_folders() if f["id"] == folder_id), None)
        if not folder:
            raise HTTPException(404, "目标文件夹不存在")
        if folder.get("scope", "public") != scope:
            raise HTTPException(400, "文件夹归属与上传知识库不一致")
    payloads = [(await f.read(), f.filename or "untitled") for f in files]

    def process(item: tuple[bytes, str]) -> dict:
        data, filename = item
        suffix = Path(filename).suffix.lower()
        if suffix not in ingestion.SUPPORTED:
            return {"errors": [{"name": filename, "error": f"不支持的格式 {suffix}（支持：pdf/docx/md/txt/csv/xlsx）"}]}
        try:
            path = ingestion.save_upload(data, filename)
            return {"success": [ingestion.ingest_file(path, display_name=filename, owner=user["username"], scope=scope, folder_id=folder_id)]}
        except Exception as e:
            return {"errors": [{"name": filename, "error": str(e)}]}

    with ThreadPoolExecutor(max_workers=min(4, max(1, len(payloads)))) as ex:
        outs = list(ex.map(process, payloads))

    return {
        "success": [r for o in outs for r in o.get("success", [])],
        "errors": [e for o in outs for e in o.get("errors", [])],
    }


@app.get("/api/documents")
async def list_documents(q: str = "", folder_id: str = "", user: dict = Depends(get_user)):
    """文档列表：公有 + 本人私有（管理员全部）；支持按文件夹过滤与关键词/语义搜索。

    q 的匹配策略：文件名包含关键词（直接命中）+ 向量检索命中的分片所属文档（语义命中），
    结果标注 match 字段，前端用不同徽标区分。
    """
    docs = [d for d in vectorstore.list_documents() if _visible_doc(d, user)]
    if folder_id:
        docs = [d for d in docs if (d.get("folder_id") or "") == folder_id]

    keyword = q.strip()
    if not keyword:
        return docs

    low = keyword.lower()
    name_hits = {d["doc_id"] for d in docs if low in (d.get("name") or "").lower()}
    semantic: dict[str, float] = {}

    def allowed(meta: dict) -> bool:
        return (
            user["role"] == "admin"
            or meta.get("scope", "public") == "public"
            or meta.get("owner") in (None, user["username"])
        )

    try:
        for doc, score in vectorstore.search(keyword, top_k=12, allowed=allowed):
            did = doc.metadata.get("doc_id")
            if did and (did not in semantic or score > semantic[did]):
                semantic[did] = score
    except Exception:
        pass

    hit_ids = name_hits | set(semantic)
    out = []
    for d in docs:
        if d["doc_id"] not in hit_ids:
            continue
        item = dict(d)
        if d["doc_id"] in name_hits and d["doc_id"] in semantic:
            item["match"] = "both"
        elif d["doc_id"] in name_hits:
            item["match"] = "name"
        else:
            item["match"] = "semantic"
        if d["doc_id"] in semantic:
            item["match_score"] = round(semantic[d["doc_id"]], 3)
        out.append(item)
    # 名称命中优先，其次语义分
    out.sort(key=lambda x: (x["match"] == "semantic", -x.get("match_score", 0)))
    return out


@app.get("/api/documents/{doc_id}/preview")
async def document_preview(doc_id: str, user: dict = Depends(get_user)):
    """文档在线预览数据：pdf/image 前端取原文件渲染，html/text 直接返回内容。"""
    info = vectorstore.get_document(doc_id)
    if not info or not _visible_doc(info, user):
        raise HTTPException(404, "文档不存在")
    return doc_preview.build_preview(info)


@app.get("/api/documents/{doc_id}/file")
async def document_file(doc_id: str, user: dict = Depends(get_user)):
    """原文件下载（前端以带令牌的 fetch 取 blob 后内嵌预览或下载）。"""
    info = vectorstore.get_document(doc_id)
    if not info or not _visible_doc(info, user):
        raise HTTPException(404, "文档不存在")
    path = Path(info.get("path") or "")
    if not info.get("path") or not path.exists():
        raise HTTPException(404, "原文件未保留（历史文档），请使用文本预览")
    return FileResponse(path, filename=info.get("name") or path.name)


@app.get("/api/documents/{doc_id}/pages")
async def document_pages(doc_id: str, user: dict = Depends(get_user)):
    """页面级预览元信息：mode=pages（PDF/Office/MD 已排版）| image | none。"""
    info = vectorstore.get_document(doc_id)
    if not info or not _visible_doc(info, user):
        raise HTTPException(404, "文档不存在")
    return doc_preview.pages_meta(info)


@app.get("/api/documents/{doc_id}/page/{page_no}")
async def document_page(doc_id: str, page_no: int, scale: float = 2.0, user: dict = Depends(get_user)):
    """渲染指定页为 PNG（类 WPS 阅读器逐页加载）。

    TOKEN 校验依赖请求头——前端用带 Authorization 的 fetch 取 blob，避免把令牌放进 URL。
    """
    info = vectorstore.get_document(doc_id)
    if not info or not _visible_doc(info, user):
        raise HTTPException(404, "文档不存在")
    data = doc_preview.render_page_bytes(info, page_no, scale)
    if not data:
        raise HTTPException(404, "该页无法渲染")
    suffix = Path(info.get("name") or "").suffix.lower()
    media = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp"}.get(suffix, "image/png")
    return Response(content=data, media_type=media, headers={"Cache-Control": "private, max-age=3600"})


@app.delete("/api/documents/{doc_id}")
async def delete_document(doc_id: str, user: dict = Depends(get_user)):
    docs = {d["doc_id"]: d for d in vectorstore.list_documents()}
    info = docs.get(doc_id)
    if not info:
        raise HTTPException(404, "文档不存在")
    # 权限：管理员或上传者本人可删除
    if user["role"] != "admin" and info.get("owner") not in (None, user["username"]):
        raise HTTPException(403, f"仅管理员或上传者（{info.get('owner')}）可删除该文档")
    if not vectorstore.delete_document(doc_id):
        raise HTTPException(404, "文档不存在")
    # 知识图谱联动清理（Neo4j 未连接时静默跳过，不影响向量库删除）
    kg.remove_document(doc_id)
    shutil.rmtree(ingestion.IMAGES_DIR / doc_id, ignore_errors=True)
    shutil.rmtree(doc_preview.PREVIEW_DIR / doc_id, ignore_errors=True)  # 渲染缓存
    if info.get("path"):
        Path(info["path"]).unlink(missing_ok=True)
    return {"ok": True}


# ==================== 知识图谱（Neo4j，新增模块） ====================

@app.get("/api/kg/graph")
async def kg_graph(include_entities: bool = True, user: dict = Depends(get_user)):
    """知识图谱可视化数据（ECharts graph：nodes/links），含构建状态与 Neo4j 可用性。"""
    return kg.get_graph(include_entities=include_entities)


@app.post("/api/kg/build")
async def kg_build(user: dict = Depends(get_user)):
    """后台重建知识图谱：逐文档 LLM 抽取实体 + 生成文档关联。"""
    if not kg.available():
        raise HTTPException(503, "Neo4j 未连接，请先启动：docker compose up -d neo4j")
    if not kg.start_build_async():
        raise HTTPException(409, "图谱构建进行中，请稍候")
    return {"ok": True, "message": "已开始构建知识图谱"}


@app.get("/api/kg/entities")
async def kg_entities(q: str = "", user: dict = Depends(get_user)):
    """实体搜索（图谱页搜索框）：按关键词模糊匹配，返回 [{name, deg}]。"""
    return kg.search_entities(q.strip(), limit=10)


@app.get("/api/kg/entity/{name}")
async def kg_entity_detail(name: str, user: dict = Depends(get_user)):
    """实体节点详情：关联文档 + 每份文档命中的原文片段（页码溯源）。"""
    if not kg.available():
        raise HTTPException(503, "Neo4j 未连接")
    detail = kg.entity_detail(name)
    if not detail or not detail["docs"]:
        raise HTTPException(404, "实体不存在")
    return detail


# ---- 前端生产构建托管（置于路由注册之后，避免遮蔽 /api/*）----
_DIST = BASE_DIR / "frontend" / "dist"
if _DIST.exists():
    app.mount("/", StaticFiles(directory=_DIST, html=True), name="spa")
