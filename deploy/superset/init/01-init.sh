#!/usr/bin/env bash
# 幂等初始化：升级 metadata schema、创建管理员、初始化角色与权限。
set -euo pipefail

: "${SUPERSET_ADMIN_USERNAME:?SUPERSET_ADMIN_USERNAME is required}"
: "${SUPERSET_ADMIN_PASSWORD:?SUPERSET_ADMIN_PASSWORD is required}"
: "${SUPERSET_ADMIN_EMAIL:?SUPERSET_ADMIN_EMAIL is required}"

echo "[fep-superset] upgrading metadata database"
superset db upgrade

echo "[fep-superset] ensuring admin user ${SUPERSET_ADMIN_USERNAME}"
if superset fab list-users 2>/dev/null | grep -q "\"username\": \"${SUPERSET_ADMIN_USERNAME}\""; then
  echo "[fep-superset] admin already exists"
else
  superset fab create-admin \
    --username "${SUPERSET_ADMIN_USERNAME}" \
    --firstname Superset \
    --lastname Admin \
    --email "${SUPERSET_ADMIN_EMAIL}" \
    --password "${SUPERSET_ADMIN_PASSWORD}" || true
fi

echo "[fep-superset] init roles and permissions"
superset init
echo "[fep-superset] done"
