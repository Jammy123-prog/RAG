"""企业知识库 RAG 服务入口。

技术栈：LangChain + Qwen3-14B(vLLM) + bge-m3 + Chroma + FastAPI（参照 langchain-chatchat）。

模块（参照 Dify / FastGPT 的多租户与会话模型）：
- 认证：注册/登录/令牌校验，首个注册用户自动成为管理员
- 会话：每个用户的对话历史相互隔离，支持新建/切换/删除/续聊
- 问答：SSE 流式，问答与引用来源落库持久化
- 文档：全局共享知识库，按上传者/管理员控制删除
- 前端生产构建由本服务单端口托管（/），局域网直接访问 :8010
"""
import json
import shutil
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import ingestion, store, vectorstore
from .auth import get_user, make_token, require_admin
from .config import BASE_DIR, DATA_DIR, settings
from .rag import chat_stream

app = FastAPI(title="企业知识库 RAG 系统", version="1.1.0")

store.init_db()

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
            async for event in chat_stream(req.message, history):
                if event["type"] == "meta":
                    meta_info.update({"mode": event["mode"], "sources": event["sources"]})
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

@app.post("/api/documents/upload")
async def upload_documents(files: list[UploadFile] = File(...), user: dict = Depends(get_user)):
    """多文件并行入库；文档登记上传者。"""
    payloads = [(await f.read(), f.filename or "untitled") for f in files]

    def process(item: tuple[bytes, str]) -> dict:
        data, filename = item
        suffix = Path(filename).suffix.lower()
        if suffix not in ingestion.SUPPORTED:
            return {"errors": [{"name": filename, "error": f"不支持的格式 {suffix}（支持：pdf/docx/md/txt/csv/xlsx）"}]}
        try:
            path = ingestion.save_upload(data, filename)
            return {"success": [ingestion.ingest_file(path, owner=user["username"])]}
        except Exception as e:
            return {"errors": [{"name": filename, "error": str(e)}]}

    with ThreadPoolExecutor(max_workers=min(4, max(1, len(payloads)))) as ex:
        outs = list(ex.map(process, payloads))

    return {
        "success": [r for o in outs for r in o.get("success", [])],
        "errors": [e for o in outs for e in o.get("errors", [])],
    }


@app.get("/api/documents")
async def list_documents(user: dict = Depends(get_user)):
    return vectorstore.list_documents()


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
    shutil.rmtree(ingestion.IMAGES_DIR / doc_id, ignore_errors=True)
    return {"ok": True}


# ---- 前端生产构建托管（置于路由注册之后，避免遮蔽 /api/*）----
_DIST = BASE_DIR / "frontend" / "dist"
if _DIST.exists():
    app.mount("/", StaticFiles(directory=_DIST, html=True), name="spa")
