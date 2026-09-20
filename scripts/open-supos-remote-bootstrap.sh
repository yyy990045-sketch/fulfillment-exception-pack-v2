#!/usr/bin/env bash
# open supOS 官方运行时远程 bootstrap（获取官方部署仓库并记录 provenance）。
#
# 纪律：
#   - 先跑 preflight，不通过就直接 BLOCKED_BY_HOST，不安装
#   - 只从官方仓库获取，不使用第三方镜像，不修改官方镜像/源码
#   - 不使用 curl | bash 之类的不透明执行
#   - 只记录 repo URL / commit SHA / OS_VERSION，不修改源码
#
# 用法：
#   scripts/open-supos-remote-bootstrap.sh [目标目录]      # 默认 $OPEN_SUPOS_DEPLOY_DIR 或 ~/supos-ce-deploy
set -euo pipefail

REPO_URL="${OPEN_SUPOS_REPO_URL:-https://gitee.com/supos-community-edition/supos-ce-deploy.git}"
REF="${OPEN_SUPOS_REPO_REF:-master}"
TARGET="${1:-${OPEN_SUPOS_DEPLOY_DIR:-$HOME/supos-ce-deploy}}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "== 1/5 preflight =="
if ! "${SCRIPT_DIR}/open-supos-remote-preflight.sh" --quiet; then
  echo
  echo "BOOTSTRAP: BLOCKED_BY_HOST（preflight 未通过，未做任何修改）"
  exit 2
fi

echo "== 2/5 fetch 官方部署仓库 =="
if [ -d "${TARGET}/.git" ]; then
  echo "已存在仓库：${TARGET}（只做 fetch，不修改工作区）"
  git -C "$TARGET" fetch --depth 1 origin "$REF"
  git -C "$TARGET" rev-parse --verify "origin/${REF}" >/dev/null
else
  git clone --depth 1 --branch "$REF" "$REPO_URL" "$TARGET"
fi
COMMIT="$(git -C "$TARGET" rev-parse HEAD)"
echo "repo   = $REPO_URL"
echo "ref    = $REF"
echo "commit = $COMMIT"

echo "== 3/5 记录 OS_VERSION =="
if [ ! -r "${TARGET}/.env" ]; then
  echo "BOOTSTRAP: FAIL 官方仓库缺少 .env（${TARGET}/.env）"
  exit 3
fi
OS_VERSION="$(grep -E '^OS_VERSION=' "${TARGET}/.env" | head -1 | cut -d= -f2- || true)"
echo "OS_VERSION = ${OS_VERSION:-unknown}"

echo "== 4/5 校验必需文件 =="
required=(
  "bin/install.sh"
  "docker-compose-4c8g.yml"
  "docker-compose-8c16g.yml"
  "mount"
  ".env"
)
missing=0
for item in "${required[@]}"; do
  if [ -e "${TARGET}/${item}" ]; then
    echo "  ok      ${item}"
  else
    echo "  MISSING ${item}"
    missing=$((missing + 1))
  fi
done
if [ "$missing" -ne 0 ]; then
  echo "BOOTSTRAP: FAIL 官方部署产物不完整（缺 ${missing} 项），不要继续安装"
  exit 4
fi

echo "== 5/5 写入 provenance 记录（写在 FEP 侧 .preview，不碰官方工作区） =="
PROVENANCE="${FEP_PROVENANCE_PATH:-${SCRIPT_DIR}/../.preview/open-supos-live/bootstrap-provenance.json}"
mkdir -p "$(dirname "$PROVENANCE")"
cat > "$PROVENANCE" <<JSON
{
  "repoUrl": "${REPO_URL}",
  "ref": "${REF}",
  "commit": "${COMMIT}",
  "osVersion": "${OS_VERSION:-unknown}",
  "deployDir": "${TARGET}",
  "fetchedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "fetchedBy": "fulfillment-exception-pack/scripts/open-supos-remote-bootstrap.sh",
  "officialArtifactsOnly": true,
  "patched": false
}
JSON
echo "provenance = ${PROVENANCE}"

echo
echo "BOOTSTRAP: PASS"
echo "NEXT: 按 docs/open-supos-remote-runtime-runbook.md 配置 .env（ENTRANCE_DOMAIN 不能用 127.0.0.1）后执行："
echo "      (cd ${TARGET} && bash bin/install.sh)"
