# 验证记录

本轮目标：open supOS 真实运行时链路验证。结论：BLOCKED_BY_HOST（四条独立阻塞）。

证据：
- 官方仓库 master HEAD = 9272ef5f124f317f902a7a6d2302a22a8c2467e3（未变）
- 官方 10 个镜像经 docker manifest inspect --verbose 全部为单架构 linux/amd64
- 官方 README 支持矩阵 = Ubuntu Server 24.04 / Windows；macOS 不在其中
- 官方 bin/install.sh 的 GNU `sed -i` 在本机实测 exit 1（BSD sed）
- 官方 deploy 产物获取失败：git clone（完整/partial）、archive tar.gz、单文件 8.45MB 三次尝试
- 本机 Docker 29.6.1 / linux-aarch64 / 10C / 8.31 GiB，amd64 模拟可用
- `.preview/open-supos/runtime-status.txt` 记录全部只读探测结果

新增（不走捷径、不回退）：
- `src/integrations/open-supos/verify-cli.ts`：12 项 fail-closed 验收闸门，
  复用既有 runtime-verify harness；注入式 transport 直接 FAIL；缺证据不会 PASS
- `tests/open-supos-verify-gate.test.ts`：6 条（含「无运行时不得 PASS」「simulated 不算真实」「组件/UNS 不健康即 FAIL」）
- `docs/open-supos-integration.md`：审计分类、官方事实、UNS/topic/映射契约、
  验证流程、失败场景、安全边界、最小可行 x86_64 运行环境
- `.env.open-supos.example`：补齐运行时证据变量名（不含任何真实值）

验证：
- npm test 390/390、frontend:test 64/64、frontend:e2e 6/6、typecheck、eval 全通过
- superset:verify-embed 22/22（本轮未回归 Superset 链路）
- npm run open-supos:verify -> status=blocked, exit 1（fail-closed，符合预期）

未声明：任何 OPEN_SUPOS_* 运行时真值；未启动 open supOS；未修改/重打包官方镜像。
