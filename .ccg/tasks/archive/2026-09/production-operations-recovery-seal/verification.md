# 验证记录

审计结论（改动前）：/api/health 只有进程存活；无 /api/ready；无 ops status；无结构化日志与
requestId；无 graceful shutdown（无 SIGTERM/SIGINT 处理）；无备份/恢复/演练脚本；
Dockerfile 与 compose 均无 healthcheck；migration 无 CLI（仅在 store 构造时 forward migrate）。

本轮实现：
- /api/health（liveness）与 /api/ready（readiness：DB/migrations/可写/auth/required 集成/磁盘告警）
- startup fail-closed：AUTH_SECRET、DB 目录与写权限、schema 未知版本、0 字节 DB、集成半配置；
  REQUIRED 集成默认由 readiness 报告，OPS_FAIL_FAST_INTEGRATIONS=true 时才启动即失败
- 结构化 JSON 日志 + requestId（X-Request-ID 校验/生成/回显，审计 metadata.requestId 关联）
- graceful shutdown（SIGTERM/SIGINT → 停止接收 → 等在途 → 关 server → 关 SQLite → 退出；超时 124）
- /api/v2/ops/status（admin:tenant）：版本/uptime/schema/DB 大小与可写/集成 configured 状态/磁盘阈值
- 备份：VACUUM INTO 一致性快照 + manifest(sha256/size/schema/version) + 保留策略（realpath 校验，symlink 拒绝）
- 恢复：--from/--to/--force、sha256、integrity_check、schema 不高于当前应用
- db:migrate / db:migrate:status（forward-only；有 pending 时先自动备份）
- db:verify-backup（seed→backup→restore→比对数量与 ID→integrity→migration status）= BACKUP_RESTORE_VERIFIED
- ops:recovery-drill（12 步，强制临时目录）= RECOVERY_DRILL_VERIFIED
- Dockerfile HEALTHCHECK + compose healthcheck/stop_grace_period

验证：
- npm test 446/446（73 文件，新增 tests/ops-runtime.test.ts 16 + tests/ops-http.test.ts 9）
- frontend:test 64/64、frontend:e2e 6/6、typecheck、eval
- superset:verify-embed 22/22、open-supos:verify --mode contract PASS
- db:migrate:status exit 0、db:verify-backup BACKUP_RESTORE_VERIFIED、ops:recovery-drill RECOVERY_DRILL_VERIFIED
- git diff --check clean

敏感信息扫描：未发现真实密码/token/private key/Authorization；
docs/交接给外部AI-代码与部署说明.md 含历史公网 IP 与 SSH 目标（非 credential），
已按要求只记入 docs/operations/security-cleanup-notes.md，不改 Git 历史。
