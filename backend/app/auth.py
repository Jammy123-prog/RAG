"""认证模块：HMAC-SHA256 签名令牌（JWT 风格，零第三方依赖）+ FastAPI 依赖注入。

- 密钥首启自动生成并持久化于 data/secret.key
- 令牌默认 7 天有效，格式：base64url(payload).hex(hmac)
- get_user 作为路由依赖使用，未携带/无效令牌返回 401
"""
import base64
import hashlib
import hmac
import json
import time

from fastapi import HTTPException, Request

from . import store
from .config import DATA_DIR

_TOKEN_TTL = 7 * 24 * 3600
_SECRET_FILE = DATA_DIR / "secret.key"


def _secret() -> bytes:
    if _SECRET_FILE.exists():
        return _SECRET_FILE.read_bytes()
    import secrets

    s = secrets.token_bytes(32)
    _SECRET_FILE.write_bytes(s)
    return s


def make_token(uid: int) -> str:
    payload = base64.urlsafe_b64encode(
        json.dumps({"uid": uid, "exp": time.time() + _TOKEN_TTL}).encode()
    ).decode().rstrip("=")
    sig = hmac.new(_secret(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def parse_token(token: str) -> int | None:
    try:
        payload, sig = token.split(".", 1)
        if not hmac.compare_digest(hmac.new(_secret(), payload.encode(), hashlib.sha256).hexdigest(), sig):
            return None
        pad = "=" * (-len(payload) % 4)
        data = json.loads(base64.urlsafe_b64decode(payload + pad))
        if data.get("exp", 0) < time.time():
            return None
        return int(data["uid"])
    except Exception:
        return None


def get_user(request: Request) -> dict:
    """FastAPI 依赖：解析 Authorization: Bearer <token> → 用户记录。"""
    auth = request.headers.get("Authorization", "")
    token = auth[7:].strip() if auth.startswith("Bearer ") else ""
    uid = parse_token(token) if token else None
    user = store.get_user(uid) if uid else None
    if not user:
        raise HTTPException(status_code=401, detail="未登录或登录已过期")
    return user


def require_admin(user: dict) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return user
