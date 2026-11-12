"""资源成员权限（参照 WPS 团队文档的共享模型）。

角色：
- viewer 可查看
- editor 可查看 + 可编辑（上传 / 新建子文件夹 / 删除文档）
- 管理员天然拥有全部权限；资源创建者（owner）对自己创建的文件夹 / 文档默认为 editor

授权主体：
- 用户（subject_type=user）
- 团队（subject_type=team）：团队成员天然继承团队在资源上的角色

可见性：
- 个人库（scope=private）：仅 owner 与管理员
- 公有库：默认全员可查看；资源被设为 restricted 后，仅显式授权成员可见
- 文件夹权限向子文件夹与文档继承，越靠近资源自身的授权越优先
"""
from . import store, vectorstore

VIEWER = "viewer"
EDITOR = "editor"
ROLES = (VIEWER, EDITOR)


class Ctx:
    """一次请求内的权限判定上下文（文件夹树 + 文档表 + 全量 ACL + 团队）。"""

    def __init__(self) -> None:
        self.folders = {f["id"]: f for f in vectorstore.list_folders()}
        self.docs = {d["doc_id"]: d for d in vectorstore.list_documents()}
        self.teams = {t["id"]: t for t in store.list_teams()}
        # (resource_type, resource_id) -> {(subject_type, subject): role}
        self.acl: dict[tuple[str, str], dict[tuple[str, str], str]] = {}
        for row in store.all_acl():
            st = row.get("subject_type") or "user"
            self.acl.setdefault((row["resource_type"], row["resource_id"]), {})[(st, row["username"])] = row["role"]
        self._user_teams: dict[str, set[str]] = {}

    # ---- 内部 ----

    def _chain(self, folder_id: str | None) -> list[str]:
        """自身及全部祖先文件夹 id（近 → 远）。"""
        chain: list[str] = []
        cur, guard = folder_id, 0
        while cur and guard < 32:
            chain.append(cur)
            cur = (self.folders.get(cur) or {}).get("parent_id")
            guard += 1
        return chain

    def teams_of(self, username: str | None) -> set[str]:
        if not username:
            return set()
        if username not in self._user_teams:
            self._user_teams[username] = {t["id"] for t in self.teams.values() if username in (t.get("members") or [])}
        return self._user_teams[username]

    def _acl_role(self, rtype: str, rid: str | None, username: str | None) -> str | None:
        """用户自身或其所属团队在该资源上的角色，取最高（editor > viewer）。"""
        if not rid or not username:
            return None
        entries = self.acl.get((rtype, rid)) or {}
        best = entries.get(("user", username))
        if best == EDITOR:
            return best
        for tid in self.teams_of(username):
            role = entries.get(("team", tid))
            if role == EDITOR:
                return EDITOR
            if role and not best:
                best = role
        return best

    def _inherited_access(self, folder_id: str | None) -> str:
        for fid in self._chain(folder_id):
            if (self.folders.get(fid) or {}).get("access") == "restricted":
                return "restricted"
        return "open"

    # ---- 对外 ----

    def doc_role(self, doc: dict | None, user: dict) -> str | None:
        if not doc:
            return None
        if user.get("role") == "admin":
            return EDITOR
        name = user.get("username")
        if doc.get("owner") == name:
            return EDITOR
        if (doc.get("scope") or "public") == "private":
            # 个人库文档只对 owner 开放（owner 已在上面放行）；无 owner 的历史数据不再默认放开
            return None
        role = self._acl_role("doc", doc.get("doc_id"), name)
        if role:
            return role
        for fid in self._chain(doc.get("folder_id")):
            role = self._acl_role("folder", fid, name)
            if role:
                return role
        if doc.get("access") == "restricted" or self._inherited_access(doc.get("folder_id")) == "restricted":
            return None
        return VIEWER

    def folder_role(self, folder: dict | None, user: dict) -> str | None:
        if not folder:
            return None
        if user.get("role") == "admin":
            return EDITOR
        name = user.get("username")
        if folder.get("owner") == name:
            return EDITOR
        if (folder.get("scope") or "public") == "private":
            return None
        role = self._acl_role("folder", folder.get("id"), name)
        if role:
            return role
        for fid in self._chain(folder.get("parent_id")):
            role = self._acl_role("folder", fid, name)
            if role:
                return role
        if folder.get("access") == "restricted" or self._inherited_access(folder.get("parent_id")) == "restricted":
            return None
        return VIEWER

    def doc_role_by_id(self, doc_id: str | None, user: dict) -> str | None:
        return self.doc_role(self.docs.get(doc_id or ""), user)

    def folder_role_by_id(self, folder_id: str | None, user: dict) -> str | None:
        return self.folder_role(self.folders.get(folder_id or ""), user)

    def can_view_doc(self, doc_id: str | None, user: dict) -> bool:
        return self.doc_role_by_id(doc_id, user) in ROLES

    def can_edit_doc(self, doc_id: str | None, user: dict) -> bool:
        return self.doc_role_by_id(doc_id, user) == EDITOR


def annotate_docs(docs: list[dict], user: dict, ctx: Ctx | None = None) -> list[dict]:
    """过滤不可见文档，并补上当前用户的角色标记。"""
    ctx = ctx or Ctx()
    out = []
    for d in docs:
        role = ctx.doc_role(d, user)
        if role:
            out.append({**d, "role": role, "can_edit": role == EDITOR})
    return out


def annotate_folders(folders: list[dict], user: dict, ctx: Ctx | None = None) -> list[dict]:
    ctx = ctx or Ctx()
    out = []
    for f in folders:
        role = ctx.folder_role(f, user)
        if role:
            out.append({**f, "role": role, "can_edit": role == EDITOR})
    return out
