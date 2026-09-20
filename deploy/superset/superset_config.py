"""Superset 本地 pilot 配置。

只从环境变量读取密钥，不写入任何真实密码。生产前必须按官方 Securing Superset
文档加固：HTTPS/反向代理、独立 metadata 数据库、服务端 session、IdP 集成等。
"""

import os

SECRET_KEY = os.environ["SUPERSET_SECRET_KEY"]

# 官方 guest token 默认 5 分钟过期；前端在过期前重新向后端换取新 token。
GUEST_TOKEN_JWT_SECRET = os.environ["GUEST_TOKEN_JWT_SECRET"]
GUEST_TOKEN_JWT_ALGO = "HS256"
GUEST_TOKEN_HEADER_NAME = "X-GuestToken"
GUEST_TOKEN_JWT_EXP_SECONDS = int(os.environ.get("SUPERSET_GUEST_TOKEN_TTL", "300"))
# guest token 在 Superset 里只用 GUEST_ROLE_NAME 这一个 role 授权
# （superset/security/manager.py get_guest_user_from_token）。Superset 官方默认值是
# "Public"，而 "Public" 在 `superset init` 之后没有任何权限，嵌入应用对 /api/v1/*
# 的调用会全部 403。因此默认值改成部署时由 init/02-embedded-role.py 幂等创建的
# 专用最小权限 role，绝不静默退回 "Public"（也不允许 Gamma / Admin）。
GUEST_ROLE_NAME = os.environ.get("SUPERSET_GUEST_ROLE_NAME", "EmbeddedGuest")
# 官方默认把 aud 取成 WEBDRIVER_BASEURL（容器内网地址），而嵌入校验按浏览器实际访问地址，
# 会导致 guest token 被拒（403）。这里显式绑定对外地址，签发与校验保持一致。
SUPERSET_PUBLIC_URL = os.environ.get("SUPERSET_PUBLIC_URL", "http://127.0.0.1:8088/").rstrip("/") + "/"
GUEST_TOKEN_JWT_AUDIENCE = SUPERSET_PUBLIC_URL

POSTGRES_USER = os.environ.get("POSTGRES_USER", "superset")
POSTGRES_PASSWORD = os.environ["POSTGRES_PASSWORD"]
POSTGRES_HOST = os.environ.get("POSTGRES_HOST", "db")
POSTGRES_PORT = os.environ.get("POSTGRES_PORT", "5432")
POSTGRES_DB = os.environ.get("POSTGRES_DB", "superset")

SQLALCHEMY_DATABASE_URI = (
    f"postgresql+psycopg2://{POSTGRES_USER}:{POSTGRES_PASSWORD}"
    f"@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"
)

REDIS_HOST = os.environ.get("REDIS_HOST", "redis")
REDIS_PORT = int(os.environ.get("REDIS_PORT", "6379"))

CACHE_CONFIG = {
    "CACHE_TYPE": "RedisCache",
    "CACHE_DEFAULT_TIMEOUT": 300,
    "CACHE_KEY_PREFIX": "superset_",
    "CACHE_REDIS_HOST": REDIS_HOST,
    "CACHE_REDIS_PORT": REDIS_PORT,
    "CACHE_REDIS_DB": 1,
}
DATA_CACHE_CONFIG = {**CACHE_CONFIG, "CACHE_DEFAULT_TIMEOUT": 300, "CACHE_REDIS_DB": 2}

FEATURE_FLAGS = {
    # 官方要求：开启后嵌入 SDK 与 guest token 端点才可用
    "EMBEDDED_SUPERSET": True,
    # 会话由宿主应用管理，隐藏嵌入视图里的登出入口
    "DISABLE_EMBEDDED_SUPERSET_LOGOUT": True,
}

# 本地 pilot 走 http，不强制 TLS；生产必须在反向代理上终止 TLS。
TALISMAN_ENABLED = os.environ.get("SUPERSET_TALISMAN_ENABLED", "false").lower() == "true"
