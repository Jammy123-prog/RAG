"""认证模块：HMAC-SHA256 签名令牌（JWT 风格，零第三方依赖）+ FastAPI 依赖注入。

- 密钥首启自动生成并持久化于 data/secret.key
- 令牌默认 7 天有效，格式：base64url(payload).hex(hmac)，payload 内含 jti 用于吊销
- get_user 作为路由依赖使用，未携带/无效/已吊销令牌返回 401
- sign_url / verify_signed：给图片等无法携带 header 的资源签发短时链接
"""
import base64
import hashlib
import hmac
import json
import time
import uuid

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
        json.dumps(
            {
                "uid": uid,
                "exp": time.time() + _TOKEN_TTL,
                "jti": uuid.uuid4().hex[:16],  # 令牌唯一标识，登出时写入吊销表
            }
        ).encode()
    ).decode().rstrip("=")
    sig = hmac.new(_secret(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def parse_token(token: str) -> dict | None:
    """校验签名与有效期，返回 {uid, jti, exp}；失败返回 None。"""
    try:
        payload, sig = token.split(".", 1)
        if not hmac.compare_digest(hmac.new(_secret(), payload.encode(), hashlib.sha256).hexdigest(), sig):
            return None
        pad = "=" * (-len(payload) % 4)
        data = json.loads(base64.urlsafe_b64decode(payload + pad))
        exp = int(data.get("exp", 0))
        if exp < time.time():
            return None
        return {"uid": int(data["uid"]), "jti": data.get("jti") or "", "exp": exp}
    except Exception:
        return None


def token_from_request(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    return auth[7:].strip() if auth.startswith("Bearer ") else ""


def get_user(request: Request) -> dict:
    """FastAPI 依赖：解析 Authorization: Bearer <token> → 用户记录。"""
    token = token_from_request(request)
    claims = parse_token(token) if token else None
    if not claims:
        raise HTTPException(status_code=401, detail="未登录或登录已过期")
    if claims["jti"] and store.is_token_revoked(claims["jti"]):
        raise HTTPException(status_code=401, detail="登录状态已失效，请重新登录")
    user = store.get_user(claims["uid"])
    if not user:
        raise HTTPException(status_code=401, detail="未登录或登录已过期")
    return user


def require_admin(user: dict) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return user


# ---------------- 短时签名链接（图片等 <img src> 资源） ----------------


def sign_url(path: str, ttl: int = 1800) -> str:
    """给资源路径签发带 exp + HMAC 的查询串，默认 30 分钟有效。"""
    exp = int(time.time()) + ttl
    sig = hmac.new(_secret(), f"{path}|{exp}".encode(), hashlib.sha256).hexdigest()[:32]
    return f"{path}?e={exp}&s={sig}"


def verify_signed(path: str, exp: str, sig: str) -> bool:
    try:
        exp_i = int(exp or 0)
    except (TypeError, ValueError):
        return False
    if exp_i < time.time():
        return False
    want = hmac.new(_secret(), f"{path}|{exp_i}".encode(), hashlib.sha256).hexdigest()[:32]
    return hmac.compare_digest(want, sig or "")
