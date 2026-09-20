#!/usr/bin/env bash
# open supOS 远程主机只读预检。
#
# 只做检查，不做任何安装 / 修改 / 拉取。任一硬条件不满足即输出 BLOCKED_BY_HOST 并以非 0 退出，
# 调用方（bootstrap / verify）必须停止，不允许继续安装或声称验证通过。
#
# 用法：scripts/open-supos-remote-preflight.sh [--quiet]
set -euo pipefail

MIN_CPU="${OPEN_SUPOS_MIN_CPU:-4}"
MIN_RAM_GB="${OPEN_SUPOS_MIN_RAM_GB:-8}"
MIN_DISK_GB="${OPEN_SUPOS_MIN_DISK_GB:-60}"
PROBE_TIMEOUT="${OPEN_SUPOS_PREFLIGHT_TIMEOUT_S:-10}"
QUIET="false"
[ "${1:-}" = "--quiet" ] && QUIET="true"

failures=0
report() {
  local status="$1" name="$2" detail="$3"
  if [ "$QUIET" != "true" ] || [ "$status" != "PASS" ]; then
    printf '%-7s %-22s %s\n' "$status" "$name" "$detail"
  fi
  [ "$status" = "FAIL" ] && failures=$((failures + 1))
  return 0
}

# --- 1. 架构（必须 x86_64 / amd64：官方镜像全部 amd64-only） ---
arch="$(uname -m)"
case "$arch" in
  x86_64|amd64) report PASS "arch" "$arch" ;;
  *) report FAIL "arch" "$arch (需要 x86_64/amd64；官方无 arm64 镜像)" ;;
esac

# --- 2. 操作系统 ---
os_id="unknown"; os_version="unknown"
if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  os_id="$(. /etc/os-release && printf '%s' "${ID:-unknown}")"
  os_version="$(. /etc/os-release && printf '%s' "${VERSION_ID:-unknown}")"
fi
if [ "$os_id" = "ubuntu" ] && [ "$os_version" = "24.04" ]; then
  report PASS "os" "ubuntu $os_version"
else
  report FAIL "os" "$(uname -s) ${os_id} ${os_version} (官方 tested 目标是 Ubuntu 24.04)"
fi

# --- 3. CPU ---
if command -v nproc >/dev/null 2>&1; then
  cpu="$(nproc)"
else
  cpu="$(sysctl -n hw.ncpu 2>/dev/null || echo 0)"
fi
if [ "${cpu:-0}" -ge "$MIN_CPU" ]; then
  report PASS "cpu" "${cpu} (>= ${MIN_CPU})"
else
  report FAIL "cpu" "${cpu} (< ${MIN_CPU})"
fi

# --- 4. 内存（GiB） ---
ram_bytes=0
if [ -r /proc/meminfo ]; then
  ram_bytes=$(( $(awk '/MemTotal/ {print $2}' /proc/meminfo) * 1024 ))
elif command -v sysctl >/dev/null 2>&1; then
  ram_bytes="$(sysctl -n hw.memsize 2>/dev/null || echo 0)"
fi
ram_gb=$(( ram_bytes / 1073741824 ))
if [ "$ram_gb" -ge "$MIN_RAM_GB" ]; then
  report PASS "ram" "${ram_gb} GiB (>= ${MIN_RAM_GB})"
else
  report FAIL "ram" "${ram_gb} GiB (< ${MIN_RAM_GB})"
fi

# --- 5. 磁盘（项目所在目录可用空间，GiB） ---
disk_kb="$(df -Pk . 2>/dev/null | awk 'NR==2 {print $4}')"
disk_gb=$(( ${disk_kb:-0} / 1048576 ))
if [ "$disk_gb" -ge "$MIN_DISK_GB" ]; then
  report PASS "disk" "${disk_gb} GiB free (>= ${MIN_DISK_GB})"
else
  report FAIL "disk" "${disk_gb} GiB free (< ${MIN_DISK_GB})"
fi

# --- 6. Docker 工具链（只读取版本，不安装） ---
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  report PASS "docker" "$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo unknown)"
else
  report FAIL "docker" "docker 不可用或 daemon 未运行"
fi
if docker compose version >/dev/null 2>&1; then
  report PASS "docker-compose" "$(docker compose version --short 2>/dev/null || echo unknown)"
else
  report FAIL "docker-compose" "docker compose 不可用"
fi
if docker buildx version >/dev/null 2>&1; then
  report PASS "docker-buildx" "$(docker buildx version 2>/dev/null | awk '{print $2}' || echo unknown)"
else
  report FAIL "docker-buildx" "buildx 不可用"
fi
if command -v containerd >/dev/null 2>&1; then
  report PASS "containerd" "$(containerd --version 2>/dev/null | awk '{print $3}' || echo unknown)"
else
  report PASS "containerd" "containerd CLI 不可见（Docker 自带 containerd，非硬条件）"
fi

# --- 7. 网络可达性 ---
probe() {
  local host="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS -o /dev/null --max-time "$PROBE_TIMEOUT" "https://${host}" 2>/dev/null && return 0
    return 1
  fi
  return 2
}
for host in gitee.com eco-registry.supos.com; do
  if probe "$host"; then
    report PASS "network:${host}" "reachable"
  else
    report FAIL "network:${host}" "unreachable (需要能拉官方仓库与官方镜像)"
  fi
done

echo
if [ "$failures" -eq 0 ]; then
  echo "PREFLIGHT: PASS"
  echo "NEXT: scripts/open-supos-remote-bootstrap.sh"
  exit 0
fi
echo "PREFLIGHT: BLOCKED_BY_HOST"
echo "BLOCKED_BY_HOST: ${failures} 项硬条件未满足；不要继续安装，也不要声称验证通过。"
exit 2
