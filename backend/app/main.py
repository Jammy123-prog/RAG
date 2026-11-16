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
import logging
import shutil
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import auth, ingestion, kg, perms, preview as doc_preview, store, vectorstore
from .auth import get_user, make_token, require_admin
from .config import BASE_DIR, DATA_DIR, settings
from .rag import chat_stream

app = FastAPI(title="企业知识库 RAG 系统", version="1.1.0")
logger = logging.getLogger("nexus.kb")


def _safe_error(exc: Exception, fallback: str = "服务内部错误，请稍后重试") -> str:
    """只回传业务侧主动抛出的可读错误，其余统一兜底，避免泄露路径 / 堆栈。"""
    text = str(exc).strip()
    if isinstance(exc, ValueError) and text and len(text) <= 200 and "\n" not in text:
        return text
    logger.exception("内部错误: %s", exc)
    return fallback

store.init_db()
vectorstore.backfill_paths()  # 历史文档补全原文件路径（支持页面级预览/下载）

# 文档内嵌图片：/api/images/{doc_id}/p{页}_{序号}.jpg
# 不再用 StaticFiles 裸挂载（那样任何人拿到 URL 就能读私有文档插图），
# 改为带短时签名校验的受控路由，见下方 document_image。
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
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


@app.post("/api/auth/logout")
async def logout(request: Request):
    """登出：当前令牌 jti 写入吊销表，立即失效，不必等 7 天自然过期。"""
    claims = auth.parse_token(auth.token_from_request(request))
    if claims and claims["jti"]:
        store.revoke_token(claims["jti"], claims["exp"])
    return {"ok": True}


@app.exception_handler(Exception)
async def _unhandled_exception(request: Request, exc: Exception):
    """兜底异常：不把堆栈、路径等内部信息透给前端。"""
    return JSONResponse(status_code=500, content={"detail": "服务内部错误，请稍后重试或联系管理员"})


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
    msgs = store.get_messages(cid)
    # 历史消息里的引用：图片链接是短时签名的，落库后必然过期 → 重新签发；
    # 同时按当前权限过滤掉已无权查看的来源。
    ctx = perms.Ctx()
    for m in msgs:
        meta = m.get("meta") or {}
        sources = meta.get("sources") or []
        if not sources:
            continue
        kept = []
        for s in sources:
            if ctx.doc_role_by_id(s.get("doc_id"), user) is None:
                continue
            if s.get("pages"):
                s["images"] = ingestion.page_image_urls(s.get("doc_id"), s["pages"])
            kept.append(s)
        meta["sources"] = kept
        m["meta"] = meta
    return msgs


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
            async for event in chat_stream(
                req.message,
                history,
                viewer={"username": user["username"], "role": user["role"]},
                ctx=perms.Ctx(),
            ):
                if event["type"] == "meta":
                    meta_info.update({"mode": event["mode"], "sources": event["sources"], "graph_docs": event.get("graph_docs", [])})
                elif event["type"] == "delta":
                    answer += event.get("text", "")
                yield f"event: {event['type']}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as e:  # 流式出错也给出明确信号
            if answer:
                answer += "\n\n（生成中断）"
            yield f"event: error\ndata: {json.dumps({'message': _safe_error(e, '生成中断，请稍后重试')}, ensure_ascii=False)}\n\n"
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
    return perms.Ctx().doc_role(d, user) is not None


def _visible_doc_ids(user: dict) -> set[str] | None:
    """当前用户可见的文档 id 集合；管理员返回 None 表示不做过滤。"""
    if user.get("role") == "admin":
        return None
    ctx = perms.Ctx()
    return {d["doc_id"] for d in vectorstore.list_documents() if ctx.doc_role(d, user) is not None}


@app.get("/api/folders")
async def list_folders(user: dict = Depends(get_user)):
    """文件夹列表（附文档数与当前用户的角色）：可见性走成员权限规则。"""
    return perms.annotate_folders(vectorstore.list_folders(), user)


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
        if perms.Ctx().folder_role(parent, user) != perms.EDITOR:
            raise HTTPException(403, "没有在该文件夹下新建子文件夹的权限")
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
    if perms.Ctx().folder_role(info, user) != perms.EDITOR:
        raise HTTPException(403, "仅文件夹创建者、管理员或被授予编辑权的人可删除")
    # 先算出将被删除的后代，便于一并清理其成员权限
    doomed, changed = {folder_id}, True
    while changed:
        changed = False
        for fid, f in folders.items():
            if fid not in doomed and f.get("parent_id") in doomed:
                doomed.add(fid)
                changed = True
    vectorstore.delete_folder(folder_id)
    for fid in doomed:
        store.delete_acl_for("folder", fid)
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
        if perms.Ctx().folder_role(folder, user) != perms.EDITOR:
            raise HTTPException(403, "没有向该文件夹上传文档的权限")
    limit = max(1, settings.max_upload_mb) * 1024 * 1024
    payloads: list[tuple[bytes, str]] = []
    oversize: list[dict] = []
    for f in files:
        data = await f.read()
        name = f.filename or "untitled"
        if len(data) > limit:
            oversize.append({
                "name": name,
                "error": f"文件 {len(data) / 1048576:.0f} MB，超过单文件上限 {settings.max_upload_mb} MB"
                         "（超大 PPT/PDF 转换会超时），请拆分或先转成 PDF 再上传",
            })
            continue
        payloads.append((data, name))

    def process(item: tuple[bytes, str]) -> dict:
        data, filename = item
        suffix = Path(filename).suffix.lower()
        if suffix not in ingestion.ALLOWED_UPLOAD:
            return {"errors": [{"name": filename, "error": f"不支持的格式 {suffix}（支持：{ingestion.FORMAT_HINT}）"}]}
        try:
            path = ingestion.save_upload(data, filename)
            return {"success": [ingestion.ingest_file(path, display_name=filename, owner=user["username"], scope=scope, folder_id=folder_id)]}
        except Exception as e:
            return {"errors": [{"name": filename, "error": _safe_error(e, "文档处理失败，请检查文件格式或联系管理员")}]}

    with ThreadPoolExecutor(max_workers=min(4, max(1, len(payloads)))) as ex:
        outs = list(ex.map(process, payloads))

    return {
        "success": [r for o in outs for r in o.get("success", [])],
        "errors": oversize + [e for o in outs for e in o.get("errors", [])],
    }


@app.get("/api/documents")
async def list_documents(q: str = "", folder_id: str = "", user: dict = Depends(get_user)):
    """文档列表：公有 + 本人私有（管理员全部）；支持按文件夹过滤与关键词/语义搜索。

    q 的匹配策略：文件名包含关键词（直接命中）+ 向量检索命中的分片所属文档（语义命中），
    结果标注 match 字段，前端用不同徽标区分。
    """
    ctx = perms.Ctx()
    docs = perms.annotate_docs(vectorstore.list_documents(), user, ctx)
    if folder_id:
        docs = [d for d in docs if (d.get("folder_id") or "") == folder_id]

    keyword = q.strip()
    if not keyword:
        return docs

    low = keyword.lower()
    name_hits = {d["doc_id"] for d in docs if low in (d.get("name") or "").lower()}
    semantic: dict[str, float] = {}

    def allowed(meta: dict) -> bool:
        return ctx.doc_role_by_id(meta.get("doc_id"), user) in perms.ROLES

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


@app.get("/api/images/{doc_id}/{filename}")
def document_image(doc_id: str, filename: str, e: str = "", s: str = ""):
    """文档插图/页面快照。

    前端 <img src> 无法携带 Authorization，因此改用短时签名链接（生成 sources 时签发）。
    路径做 resolve 后前缀校验，杜绝 ../ 穿越。
    """
    if not auth.verify_signed(f"/api/images/{doc_id}/{filename}", e, s):
        raise HTTPException(401, "图片链接无效或已过期")
    base = (ingestion.IMAGES_DIR / doc_id).resolve()
    target = (base / filename).resolve()
    if base not in target.parents or not target.is_file():
        raise HTTPException(404, "图片不存在")
    return FileResponse(target, headers={"Cache-Control": "private, max-age=600"})


@app.delete("/api/documents/{doc_id}")
async def delete_document(doc_id: str, user: dict = Depends(get_user)):
    docs = {d["doc_id"]: d for d in vectorstore.list_documents()}
    info = docs.get(doc_id)
    if not info:
        raise HTTPException(404, "文档不存在")
    # 权限：管理员 / 上传者 / 被授予编辑权的人可删除
    if not perms.Ctx().can_edit_doc(doc_id, user):
        raise HTTPException(403, f"仅管理员、上传者（{info.get('owner')}）或被授予编辑权的人可删除该文档")
    if not vectorstore.delete_document(doc_id):
        raise HTTPException(404, "文档不存在")
    store.delete_acl_for("doc", doc_id)
    # 知识图谱联动清理（Neo4j 未连接时静默跳过，不影响向量库删除）
    kg.remove_document(doc_id)
    shutil.rmtree(ingestion.IMAGES_DIR / doc_id, ignore_errors=True)
    shutil.rmtree(doc_preview.PREVIEW_DIR / doc_id, ignore_errors=True)  # 渲染缓存
    if info.get("path"):
        Path(info["path"]).unlink(missing_ok=True)
    return {"ok": True}


# ==================== 成员权限（管理员配置，参照 WPS 团队文档） ====================


class AclMember(BaseModel):
    """授权对象：用户（subject_type=user，subject=用户名）或团队（team，subject=团队 id）。"""

    subject_type: str = "user"  # user | team
    subject: str = ""  # 用户名 / 团队 id
    role: str = "viewer"
    username: str = ""  # 兼容旧客户端（等同 subject）


class TeamForm(BaseModel):
    name: str
    members: list[str] = []


class AclForm(BaseModel):
    resource_type: str  # folder | doc
    resource_id: str
    access: str = "open"  # open=全员可见 / restricted=仅指定成员
    members: list[AclMember] = []


def _acl_target(resource_type: str, resource_id: str) -> dict | None:
    if resource_type == "folder":
        return next((f for f in vectorstore.list_folders() if f["id"] == resource_id), None)
    if resource_type == "doc":
        return vectorstore.get_document(resource_id)
    return None


@app.get("/api/users/directory")
async def users_directory(user: dict = Depends(get_user)):
    """成员选择用的用户目录：只返回用户名，不含角色与创建时间。"""
    return [{"username": u["username"]} for u in store.list_users()]


# ==================== 团队（管理员建组，权限可整体授予团队） ====================


def _clean_team_members(members: list[str], valid: set[str]) -> list[str]:
    out: list[str] = []
    for m in members:
        name = (m or "").strip()
        if not name:
            continue
        if name not in valid:
            raise HTTPException(400, f"用户「{name}」不存在")
        if name not in out:
            out.append(name)
    return out


@app.get("/api/teams")
async def list_teams(user: dict = Depends(get_user)):
    """团队列表（登录即可见，便于权限弹窗按团队授权）。"""
    return store.list_teams()


@app.post("/api/teams")
async def create_team(form: TeamForm, user: dict = Depends(get_user)):
    """新建团队并指定成员（仅管理员）。"""
    require_admin(user)
    name = form.name.strip()
    if not name:
        raise HTTPException(400, "团队名称不能为空")
    if store.get_team_by_name(name):
        raise HTTPException(400, f"团队「{name}」已存在")
    valid = {u["username"] for u in store.list_users()}
    return store.create_team(name, _clean_team_members(form.members, valid))


@app.put("/api/teams/{team_id}")
async def update_team(team_id: str, form: TeamForm, user: dict = Depends(get_user)):
    """改名 + 覆盖式更新成员（仅管理员）。"""
    require_admin(user)
    name = form.name.strip()
    if not name:
        raise HTTPException(400, "团队名称不能为空")
    other = store.get_team_by_name(name)
    if other and other["id"] != team_id:
        raise HTTPException(400, f"团队「{name}」已存在")
    valid = {u["username"] for u in store.list_users()}
    team = store.update_team(team_id, name, _clean_team_members(form.members, valid))
    if not team:
        raise HTTPException(404, "团队不存在")
    return team


@app.delete("/api/teams/{team_id}")
async def delete_team(team_id: str, user: dict = Depends(get_user)):
    """删除团队，同时清理该团队的全部授权（仅管理员）。"""
    require_admin(user)
    if not store.delete_team(team_id):
        raise HTTPException(404, "团队不存在")
    return {"ok": True}


def _require_acl_manager(user: dict, info: dict, resource_type: str = "folder") -> None:
    """成员权限的配置人：管理员、资源创建者，或文档所在文件夹的创建者。"""
    if user.get("role") == "admin" or info.get("owner") == user.get("username"):
        return
    if resource_type == "doc":
        ctx = perms.Ctx()
        if ctx.is_folder_owner_of_doc(ctx.docs.get(info.get("doc_id") or ""), user):
            return
    raise HTTPException(403, "仅管理员、资源创建者或所在文件夹创建者可设置成员权限")


@app.get("/api/acl")
async def get_acl(resource_type: str, resource_id: str, user: dict = Depends(get_user)):
    """查看文件夹 / 文档的可见范围与成员（管理员、资源创建者或所在文件夹创建者）。"""
    info = _acl_target(resource_type, resource_id)
    if not info:
        raise HTTPException(404, "资源不存在")
    _require_acl_manager(user, info, resource_type)
    teams = {t["id"]: t for t in store.list_teams()}
    members = []
    for m in store.list_acl(resource_type, resource_id):
        st = m.get("subject_type") or "user"
        row = {"subject_type": st, "subject": m["subject"], "role": m["role"]}
        if st == "team":
            team = teams.get(m["subject"])
            row["team_name"] = team["name"] if team else "（已删除团队）"
            row["team_size"] = len(team["members"]) if team else 0
        members.append(row)
    return {
        "resource_type": resource_type,
        "resource_id": resource_id,
        "name": info.get("name"),
        "owner": info.get("owner"),
        "access": info.get("access") or "open",
        "members": members,
    }


@app.put("/api/acl")
async def put_acl(form: AclForm, user: dict = Depends(get_user)):
    """覆盖式保存成员权限（管理员、资源创建者或所在文件夹创建者）：可见范围 + 成员/团队角色。"""
    if form.resource_type not in ("folder", "doc"):
        raise HTTPException(400, "resource_type 仅支持 folder / doc")
    if form.access not in ("open", "restricted"):
        raise HTTPException(400, "access 仅支持 open / restricted")
    info = _acl_target(form.resource_type, form.resource_id)
    if not info:
        raise HTTPException(404, "资源不存在")
    _require_acl_manager(user, info, form.resource_type)

    valid_users = {u["username"] for u in store.list_users()}
    valid_teams = {t["id"] for t in store.list_teams()}
    seen: set[tuple[str, str]] = set()
    members = []
    for m in form.members:
        st = (m.subject_type or "user").strip()
        if st not in ("user", "team"):
            raise HTTPException(400, "subject_type 仅支持 user / team")
        subject = (m.subject or m.username or "").strip()
        if not subject:
            continue
        if m.role not in perms.ROLES:
            raise HTTPException(400, "角色仅支持 viewer / editor")
        if st == "user" and subject not in valid_users:
            raise HTTPException(400, f"用户「{subject}」不存在")
        if st == "team" and subject not in valid_teams:
            raise HTTPException(400, "团队不存在")
        if (st, subject) in seen:
            continue
        seen.add((st, subject))
        members.append({"subject_type": st, "subject": subject, "role": m.role})

    if form.resource_type == "folder":
        vectorstore.set_folder_access(form.resource_id, form.access)
    else:
        vectorstore.set_document_access(form.resource_id, form.access)
    store.replace_acl(form.resource_type, form.resource_id, members)
    return {"ok": True, "access": form.access, "members": members}


# ==================== 知识图谱（Neo4j，新增模块） ====================

@app.get("/api/kg/graph")
async def kg_graph(
    include_entities: bool = True,
    folder_id: str = "",
    include_external: bool = True,
    user: dict = Depends(get_user),
):
    """知识图谱可视化数据（ECharts graph：nodes/links），按成员可见范围过滤。

    folder_id 为空=全库；`__unfiled__`=未分组；其他=该文件夹及其子文件夹（同目录关联更密）。
    """
    return kg.get_graph(
        include_entities=include_entities,
        visible=_visible_doc_ids(user),
        folder_id=(folder_id.strip() or None),
        include_external=include_external,
    )


@app.post("/api/kg/build")
async def kg_build(folder_id: str = "", user: dict = Depends(get_user)):
    """后台构建知识图谱（仅管理员）：逐文档 LLM 抽取实体 + 生成文档关联。

    folder_id 为空=全量重建；指定文件夹=只重建该文件夹子树，其他文件夹的图谱保持不动。
    """
    require_admin(user)
    if not kg.available():
        raise HTTPException(503, "Neo4j 未连接，请先启动：docker compose up -d neo4j")
    fid = folder_id.strip() or None
    if fid and fid != kg.UNFILED:
        folders = {f["id"]: f for f in vectorstore.list_folders()}
        if fid not in folders:
            raise HTTPException(404, "目标文件夹不存在")
        scope = kg.scope_label(fid, folders)
    else:
        scope = kg.scope_label(fid)
    if not kg.start_build_async(fid):
        raise HTTPException(409, "图谱构建进行中，请稍候")
    return {"ok": True, "scope": scope, "message": f"已开始构建「{scope}」的知识图谱"}


@app.get("/api/kg/entities")
async def kg_entities(q: str = "", user: dict = Depends(get_user)):
    """实体搜索（图谱页搜索框）：按关键词模糊匹配，deg 只统计当前用户可见的文档。"""
    return kg.search_entities(q.strip(), limit=10, visible=_visible_doc_ids(user))


@app.get("/api/kg/entity/{name}")
async def kg_entity_detail(name: str, user: dict = Depends(get_user)):
    """实体节点详情：关联文档 + 每份文档命中的原文片段（页码溯源）。"""
    if not kg.available():
        raise HTTPException(503, "Neo4j 未连接")
    detail = kg.entity_detail(name, visible=_visible_doc_ids(user))
    if not detail or not detail["docs"]:
        raise HTTPException(404, "实体不存在")
    return detail


# ---- 前端生产构建托管（置于路由注册之后，避免遮蔽 /api/*）----
_DIST = BASE_DIR / "frontend" / "dist"
if _DIST.exists():
    app.mount("/", StaticFiles(directory=_DIST, html=True), name="spa")
