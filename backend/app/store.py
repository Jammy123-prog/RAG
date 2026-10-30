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
"""


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _conn() as c:
        c.executescript(_SCHEMA)


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
        cur = c.execute("DELETE FROM users WHERE id=?", (uid,))
    # 级联清理该用户的全部会话与消息
    with _conn() as c:
        convs = c.execute("SELECT id FROM conversations WHERE user_id=?", (uid,)).fetchall()
        for r in convs:
            c.execute("DELETE FROM messages WHERE conv_id=?", (r["id"],))
        c.execute("DELETE FROM conversations WHERE user_id=?", (uid,))
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
