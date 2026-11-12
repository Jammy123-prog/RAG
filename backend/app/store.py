"""SQLite 存储层：用户 / 会话 / 消息（参照 Dify 的会话持久化模型）。

零第三方依赖（sqlite3 + hashlib + secrets 均为标准库）。
数据文件：data/app.db
"""
import hashlib
import secrets
import sqlite3
import time
import uuid

from .config import DATA_DIR

DB_PATH = DATA_DIR / "app.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT UNIQUE NOT NULL,
    pw_hash     TEXT NOT NULL,
    salt        TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'user',
    created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    title       TEXT NOT NULL DEFAULT '新对话',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    conv_id     TEXT NOT NULL,
    role        TEXT NOT NULL,
    content     TEXT NOT NULL,
    meta        TEXT,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conv_id, id);
-- 已吊销令牌（登出 / 改密后立即失效）
CREATE TABLE IF NOT EXISTS revoked_tokens (
    jti         TEXT PRIMARY KEY,
    exp         INTEGER NOT NULL
);
-- 资源成员权限：resource_type = folder | doc，role = viewer | editor
-- subject_type = user | team；用户主体时 subject 为 username，团队主体时为团队 id
CREATE TABLE IF NOT EXISTS acl (
    resource_type TEXT NOT NULL,
    resource_id   TEXT NOT NULL,
    username      TEXT NOT NULL,
    role          TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    subject_type  TEXT NOT NULL DEFAULT 'user',
    PRIMARY KEY (resource_type, resource_id, subject_type, username)
);
CREATE INDEX IF NOT EXISTS idx_acl_user ON acl(username);
-- 团队：管理员建组并加成员，权限可整体授予团队
CREATE TABLE IF NOT EXISTS teams (
    id         TEXT PRIMARY KEY,
    name       TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS team_members (
    team_id    TEXT NOT NULL,
    username   TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (team_id, username)
);
"""


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _conn() as c:
        c.executescript(_SCHEMA)
        # 迁移：老库的 acl 表没有 subject_type 列（团队权限），补齐后主体默认是用户
        cols = {r["name"] for r in c.execute("PRAGMA table_info(acl)").fetchall()}
        if "subject_type" not in cols:
            c.execute("ALTER TABLE acl ADD COLUMN subject_type TEXT NOT NULL DEFAULT 'user'")


def _now() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


# ---------------- 用户 ----------------

def _hash(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 120_000).hex()


def count_users() -> int:
    with _conn() as c:
        return c.execute("SELECT COUNT(*) FROM users").fetchone()[0]


def create_user(username: str, password: str) -> dict:
    role = "admin" if count_users() == 0 else "user"  # 首个注册用户即管理员
    salt = secrets.token_hex(16)
    with _conn() as c:
        c.execute(
            "INSERT INTO users (username, pw_hash, salt, role, created_at) VALUES (?,?,?,?,?)",
            (username, _hash(password, salt), salt, role, _now()),
        )
        uid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
    return get_user(uid)


def verify_login(username: str, password: str) -> dict | None:
    with _conn() as c:
        row = c.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    if not row or _hash(password, row["salt"]) != row["pw_hash"]:
        return None
    return dict(row)


def get_user(uid: int) -> dict | None:
    with _conn() as c:
        row = c.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    return dict(row) if row else None


def list_users() -> list[dict]:
    with _conn() as c:
        rows = c.execute("SELECT id, username, role, created_at FROM users ORDER BY id").fetchall()
    return [dict(r) for r in rows]


def delete_user(uid: int) -> bool:
    with _conn() as c:
        row = c.execute("SELECT username FROM users WHERE id=?", (uid,)).fetchone()
        name = row["username"] if row else ""
        cur = c.execute("DELETE FROM users WHERE id=?", (uid,))
    # 级联清理该用户的全部会话与消息
    with _conn() as c:
        convs = c.execute("SELECT id FROM conversations WHERE user_id=?", (uid,)).fetchall()
        for r in convs:
            c.execute("DELETE FROM messages WHERE conv_id=?", (r["id"],))
        c.execute("DELETE FROM conversations WHERE user_id=?", (uid,))
        # 同时移出团队、清理其个人授权，避免悬空成员
        if name:
            c.execute("DELETE FROM team_members WHERE username=?", (name,))
            c.execute("DELETE FROM acl WHERE subject_type='user' AND username=?", (name,))
    return cur.rowcount > 0


# ---------------- 会话 ----------------

def create_conversation(user_id: int, title: str = "新对话") -> dict:
    cid = uuid.uuid4().hex[:12]
    now = _now()
    with _conn() as c:
        c.execute(
            "INSERT INTO conversations (id, user_id, title, created_at, updated_at) VALUES (?,?,?,?,?)",
            (cid, user_id, title, now, now),
        )
    return {"id": cid, "title": title, "created_at": now, "updated_at": now}


def list_conversations(user_id: int) -> list[dict]:
    with _conn() as c:
        rows = c.execute(
            "SELECT id, title, created_at, updated_at FROM conversations WHERE user_id=? ORDER BY updated_at DESC",
            (user_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def get_conversation(cid: str, user_id: int) -> dict | None:
    """仅返回属于该用户的会话（数据隔离的关键）。"""
    with _conn() as c:
        row = c.execute("SELECT * FROM conversations WHERE id=? AND user_id=?", (cid, user_id)).fetchone()
    return dict(row) if row else None


def delete_conversation(cid: str, user_id: int) -> bool:
    if not get_conversation(cid, user_id):
        return False
    with _conn() as c:
        c.execute("DELETE FROM messages WHERE conv_id=?", (cid,))
        c.execute("DELETE FROM conversations WHERE id=?", (cid,))
    return True


def touch_conversation(cid: str, title: str | None = None) -> None:
    with _conn() as c:
        if title:
            c.execute("UPDATE conversations SET title=?, updated_at=? WHERE id=?", (title, _now(), cid))
        else:
            c.execute("UPDATE conversations SET updated_at=? WHERE id=?", (_now(), cid))


def conversation_message_count(cid: str) -> int:
    with _conn() as c:
        return c.execute("SELECT COUNT(*) FROM messages WHERE conv_id=?", (cid,)).fetchone()[0]


# ---------------- 消息 ----------------

def add_message(cid: str, role: str, content: str, meta: dict | None = None) -> None:
    import json

    with _conn() as c:
        c.execute(
            "INSERT INTO messages (conv_id, role, content, meta, created_at) VALUES (?,?,?,?,?)",
            (cid, role, content, json.dumps(meta, ensure_ascii=False) if meta else None, _now()),
        )


def get_messages(cid: str) -> list[dict]:
    import json

    with _conn() as c:
        rows = c.execute("SELECT role, content, meta FROM messages WHERE conv_id=? ORDER BY id", (cid,)).fetchall()
    out = []
    for r in rows:
        m = {"role": r["role"], "content": r["content"]}
        try:
            m["meta"] = json.loads(r["meta"]) if r["meta"] else None
        except Exception:
            m["meta"] = None
        out.append(m)
    return out


# ---------------- 令牌吊销 ----------------


def revoke_token(jti: str, exp: int) -> None:
    with _conn() as c:
        c.execute("INSERT OR REPLACE INTO revoked_tokens (jti, exp) VALUES (?,?)", (jti, int(exp)))
        c.execute("DELETE FROM revoked_tokens WHERE exp < ?", (int(time.time()),))


def is_token_revoked(jti: str) -> bool:
    with _conn() as c:
        row = c.execute("SELECT 1 FROM revoked_tokens WHERE jti=?", (jti,)).fetchone()
    return row is not None


# ---------------- 资源成员权限（ACL） ----------------


def list_acl(resource_type: str, resource_id: str) -> list[dict]:
    with _conn() as c:
        rows = c.execute(
            "SELECT subject_type, username AS subject, role, created_at FROM acl"
            " WHERE resource_type=? AND resource_id=? ORDER BY created_at",
            (resource_type, resource_id),
        ).fetchall()
    return [dict(r) for r in rows]


def all_acl() -> list[dict]:
    """一次性取全量，供权限判定在内存中做继承计算。"""
    with _conn() as c:
        rows = c.execute("SELECT resource_type, resource_id, subject_type, username, role FROM acl").fetchall()
    return [dict(r) for r in rows]


def set_acl(resource_type: str, resource_id: str, subject: str, role: str, subject_type: str = "user") -> None:
    with _conn() as c:
        c.execute(
            "INSERT OR REPLACE INTO acl (resource_type, resource_id, subject_type, username, role, created_at)"
            " VALUES (?,?,?,?,?,?)",
            (resource_type, resource_id, subject_type, subject, role, _now()),
        )


def remove_acl(resource_type: str, resource_id: str, subject: str, subject_type: str = "user") -> None:
    with _conn() as c:
        c.execute(
            "DELETE FROM acl WHERE resource_type=? AND resource_id=? AND subject_type=? AND username=?",
            (resource_type, resource_id, subject_type, subject),
        )


def replace_acl(resource_type: str, resource_id: str, members: list[dict]) -> None:
    """整体覆盖某资源的成员列表（先清空再写入）。members: [{subject, subject_type, role}]"""
    with _conn() as c:
        c.execute("DELETE FROM acl WHERE resource_type=? AND resource_id=?", (resource_type, resource_id))
        for m in members:
            c.execute(
                "INSERT OR REPLACE INTO acl (resource_type, resource_id, subject_type, username, role, created_at)"
                " VALUES (?,?,?,?,?,?)",
                (resource_type, resource_id, m.get("subject_type") or "user", m["subject"], m["role"], _now()),
            )


def delete_acl_for(resource_type: str, resource_id: str) -> None:
    with _conn() as c:
        c.execute("DELETE FROM acl WHERE resource_type=? AND resource_id=?", (resource_type, resource_id))


# ---------------- 团队 ----------------
# 团队只做「成员打包」，不直接持有资源；资源权限仍记录在 acl 表里（subject_type='team'）


def list_teams() -> list[dict]:
    with _conn() as c:
        rows = c.execute("SELECT id, name, created_at FROM teams ORDER BY created_at").fetchall()
        out = [dict(r) for r in rows]
        for t in out:
            t["members"] = [
                r["username"]
                for r in c.execute(
                    "SELECT username FROM team_members WHERE team_id=? ORDER BY created_at", (t["id"],)
                ).fetchall()
            ]
    return out


def get_team(team_id: str) -> dict | None:
    return next((t for t in list_teams() if t["id"] == team_id), None)


def get_team_by_name(name: str) -> dict | None:
    return next((t for t in list_teams() if t["name"] == name), None)


def team_ids_of(username: str) -> set[str]:
    """某用户所属的全部团队 id（权限判定用）。"""
    with _conn() as c:
        rows = c.execute("SELECT team_id FROM team_members WHERE username=?", (username,)).fetchall()
    return {r["team_id"] for r in rows}


def create_team(name: str, members: list[str]) -> dict:
    tid = uuid.uuid4().hex[:8]
    with _conn() as c:
        c.execute("INSERT INTO teams (id, name, created_at) VALUES (?,?,?)", (tid, name, _now()))
        for m in members:
            c.execute("INSERT OR IGNORE INTO team_members (team_id, username, created_at) VALUES (?,?,?)", (tid, m, _now()))
    return get_team(tid) or {}


def update_team(team_id: str, name: str, members: list[str]) -> dict | None:
    """改名 + 覆盖式更新成员。"""
    with _conn() as c:
        row = c.execute("SELECT 1 FROM teams WHERE id=?", (team_id,)).fetchone()
        if not row:
            return None
        c.execute("UPDATE teams SET name=? WHERE id=?", (name, team_id))
        c.execute("DELETE FROM team_members WHERE team_id=?", (team_id,))
        for m in members:
            c.execute("INSERT OR IGNORE INTO team_members (team_id, username, created_at) VALUES (?,?,?)", (team_id, m, _now()))
    return get_team(team_id)


def delete_team(team_id: str) -> bool:
    with _conn() as c:
        row = c.execute("SELECT 1 FROM teams WHERE id=?", (team_id,)).fetchone()
        if not row:
            return False
        c.execute("DELETE FROM team_members WHERE team_id=?", (team_id,))
        c.execute("DELETE FROM teams WHERE id=?", (team_id,))
        # 团队消失后，沿用该团队 id 的授权一并清理，避免悬空权限
        c.execute("DELETE FROM acl WHERE subject_type='team' AND username=?", (team_id,))
    return True
