#!/usr/bin/env bash
# open supOS 远程真实运行时验收编排（固定 20 步顺序）。
#
# 本脚本**不重新实现业务逻辑**：
#   - 运行时 / MQTT / UNS / A-B / replay / ledger / cursor / 投影导出 全部由
#     `npm run open-supos:verify -- --mode live` 产出证据
#   - 本脚本只补 Superset 侧两步（真实重载投影 + 真实嵌入验证）并写出 receipt
#   - 最后按固定 20 步汇总；任何一步没有证据就是 FAIL，绝不 SKIP 后仍输出 VERIFIED
#
# 用法：scripts/open-supos-remote-verify.sh [配置文件]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG="${1:-${OPEN_SUPOS_REMOTE_ENV:-${PROJECT_ROOT}/deploy/open-supos/.env.remote}}"
LIVE_DIR="${PROJECT_ROOT}/.preview/open-supos-live"
RECEIPT="${LIVE_DIR}/superset-receipt.json"
PROJECTION="${LIVE_DIR}/projection.sql"
LOG1="${LIVE_DIR}/live-gate-1.log"
LOG2="${LIVE_DIR}/live-gate-2.log"
EMBED_LOG="${LIVE_DIR}/superset-verify-embed.log"

if [ ! -r "$CONFIG" ]; then
  echo "REMOTE_VERIFY: BLOCKED_BY_HOST 配置文件不存在或不可读：$CONFIG" >&2
  echo "参考 deploy/open-supos/.env.remote.example（真实值只放到 gitignored 的 .env.remote）" >&2
  exit 2
fi
mkdir -p "$LIVE_DIR"
# shellcheck disable=SC1090
set -a; . "$CONFIG"; set +a

: "${OPEN_SUPOS_BASE_URL:?OPEN_SUPOS_BASE_URL 必填}"
: "${OPEN_SUPOS_MQTT_HOST:?OPEN_SUPOS_MQTT_HOST 必填}"
: "${OPEN_SUPOS_MQTT_PORT:?OPEN_SUPOS_MQTT_PORT 必填}"
: "${OPEN_SUPOS_UPSTREAM_COMMIT:?OPEN_SUPOS_UPSTREAM_COMMIT 必填（必须是审计过的官方 commit）}"
: "${OPEN_SUPOS_RUNTIME_CONFIRMED:?OPEN_SUPOS_RUNTIME_CONFIRMED 必填}"

# 从这里起不再回显任何配置值，避免泄露 credential
export OPEN_SUPOS_MQTT_URL="${OPEN_SUPOS_MQTT_URL:-mqtt://${OPEN_SUPOS_MQTT_HOST}:${OPEN_SUPOS_MQTT_PORT}}"
export OPEN_SUPOS_RUNTIME_HEALTH_URL="${OPEN_SUPOS_RUNTIME_HEALTH_URL:-${OPEN_SUPOS_BASE_URL%/}/health}"
export OPEN_SUPOS_PROJECTION_VERIFY="${OPEN_SUPOS_PROJECTION_VERIFY:-true}"
export OPEN_SUPOS_SUPERSET_RECEIPT="$RECEIPT"
export OPEN_SUPOS_HOST_ARCH="${OPEN_SUPOS_HOST_ARCH:-$(uname -m)}"
export OPEN_SUPOS_HOST_OS="${OPEN_SUPOS_HOST_OS:-$(uname -s)}"
[ -n "${FEP_BASE_URL:-}" ] && export APP_BASE="$FEP_BASE_URL"

STEPS=(runtime.health mqtt.connection mqtt.publish mqtt.subscribe uns.object_exists
  case_a.publish case_a.ingest case_a.rule_evaluation case_a.exception_count_zero
  case_b.publish case_b.ingest case_b.rule_matched case_b.expected_exception case_b.replay
  replay.idempotent source_ledger.consistent cursor.checkpoint_safe analytics.projection_export
  superset.projection_reloaded superset.dashboard_reflects_data)
LABELS=("01 runtime health" "02 MQTT connection" "03 MQTT publish" "04 MQTT subscribe" "05 UNS object exists"
  "06 Case A publish" "07 Case A connector ingest" "08 Case A rule evaluation" "09 Case A exception count = 0"
  "10 Case B publish" "11 Case B connector ingest" "12 Case B rule matched" "13 Case B expected exception" "14 Case B replay"
  "15 replay idempotent" "16 source ledger consistent" "17 cursor / checkpoint safe" "18 analytics projection export"
  "19 Superset projection reloaded" "20 Superset dashboard reflects data")

run_live_gate() {
  local log="$1"
  set +e
  ( cd "$PROJECT_ROOT" && npm run open-supos:verify --silent -- --mode live ) > "$log" 2>&1
  local exit_code=$?
  set -e
  return "$exit_code"
}

echo "=== open supOS remote verify（固定 20 步） ==="

# 第一轮：产出运行时/A-B/投影证据（第 01-18 步）
RUNTIME_READY=true
if ! run_live_gate "$LOG1"; then RUNTIME_READY=false; fi

SUPERSET_READY=false
if [ "$RUNTIME_READY" = "true" ]; then
  # 第 19 步：把投影真正重载进分析库
  reload_ok=false
  projection_rows="{}"
  if command -v docker >/dev/null 2>&1 && [ -r "${PROJECT_ROOT}/deploy/superset/docker-compose.yml" ] && [ -r "$PROJECTION" ]; then
    pg_user="${POSTGRES_USER:-superset}"
    if docker compose -f "${PROJECT_ROOT}/deploy/superset/docker-compose.yml" exec -T db \
      psql -v ON_ERROR_STOP=1 -U "$pg_user" -d analytics < "$PROJECTION" >/dev/null 2>&1; then
      rows="$(docker compose -f "${PROJECT_ROOT}/deploy/superset/docker-compose.yml" exec -T db \
        psql -t -A -U "$pg_user" -d analytics \
        -c 'select coalesce(sum(exception_count),0) from analytics.fact_exception_type;' 2>/dev/null | tr -d '[:space:]')"
      projection_rows="{\"fact_exception_type\":${rows:-0}}"
      reload_ok=true
    fi
  fi

  # 第 20 步：真实嵌入验证（真实浏览器链路 + 仪表盘数据）
  embed_ok=false
  if [ "$reload_ok" = "true" ]; then
    set +e
    ( cd "$PROJECT_ROOT" && npm run superset:verify-embed ) > "$EMBED_LOG" 2>&1
    embed_exit=$?
    set -e
    [ "$embed_exit" -eq 0 ] && embed_ok=true
  fi

  cat > "$RECEIPT" <<JSON
{
  "projectionReloaded": ${reload_ok},
  "supersetVerifyEmbedPass": ${embed_ok},
  "dashboardObserved": ${embed_ok},
  "factRows": ${projection_rows},
  "observedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
  [ "$reload_ok" = "true" ] && [ "$embed_ok" = "true" ] && SUPERSET_READY=true
fi

# 第二轮：带上 receipt 重跑一次，得到完整 20 步证据并刷新 evidence manifest
# （幂等：Source Ledger 保证不会重复产生 event/exception）
FINAL_LOG="$LOG1"
if [ "$SUPERSET_READY" = "true" ]; then
  if run_live_gate "$LOG2"; then FINAL_LOG="$LOG2"; else FINAL_LOG="$LOG2"; fi
fi

fail_count=0
index=0
for id in "${STEPS[@]}"; do
  label="${LABELS[$index]}"
  line="$(grep -F "$id " "$FINAL_LOG" 2>/dev/null | head -1 || true)"
  if [ -z "$line" ]; then
    printf '%-6s %-34s %s\n' "FAIL" "$label" "gate 未输出该检查项（不允许跳过）"
    fail_count=$((fail_count + 1))
  else
    state="$(printf '%s' "$line" | awk '{print $1}')"
    detail="$(printf '%s' "$line" | cut -c1-140)"
    if [ "$state" = "PASS" ]; then
      printf '%-6s %-34s %s\n' "PASS" "$label" "$detail"
    else
      printf '%-6s %-34s %s\n' "FAIL" "$label" "gate=${state}"
      fail_count=$((fail_count + 1))
    fi
  fi
  index=$((index + 1))
done

echo
if [ "$fail_count" -eq 0 ]; then
  echo "REMOTE_VERIFY: REMOTE_RUNTIME_VERIFIED（20/20）"
  echo "可升级：OPEN_SUPOS_RUNTIME_VERIFIED / OPEN_SUPOS_MQTT_VERIFIED / OPEN_SUPOS_UNS_VERIFIED /"
  echo "        OPEN_SUPOS_CONNECTOR_VERIFIED / OPEN_SUPOS_EXCEPTION_FLOW_VERIFIED / OPEN_SUPOS_SUPERSET_FLOW_VERIFIED"
  echo "仍保持 false：OPEN_SUPOS_REAL_FACTORY_VERIFIED / OPEN_SUPOS_REAL_CUSTOMER_VERIFIED / OPEN_SUPOS_PRODUCTION_VERIFIED"
  exit 0
fi
echo "REMOTE_VERIFY: FAIL（${fail_count}/20 步未通过）——不得升级任何 live truth flag"
echo "证据日志：${FINAL_LOG}"
exit 1
