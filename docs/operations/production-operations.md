# 生产运维手册（runtime operations）

本轮完成：startup fail-closed、health/readiness 分离、结构化日志、request id、graceful shutdown、
ops status、Docker healthcheck、migration 状态与安全门。备份/恢复见
`backup-restore.md`，演练见 `disaster-recovery.md`。

## Truth flags

```text
OPS_HEALTH_IMPLEMENTED=true
OPS_READINESS_IMPLEMENTED=true
SQLITE_BACKUP_IMPLEMENTED=true              SQLITE_BACKUP_LOCALLY_VERIFIED=true
SQLITE_RESTORE_IMPLEMENTED=true             SQLITE_RESTORE_LOCALLY_VERIFIED=true
MIGRATION_SAFETY_LOCALLY_VERIFIED=true
RECOVERY_DRILL_LOCALLY_VERIFIED=true
STRUCTURED_LOGGING_IMPLEMENTED=true
GRACEFUL_SHUTDOWN_LOCALLY_VERIFIED=true

PRODUCTION_BACKUP_VERIFIED=false
PRODUCTION_DISASTER_RECOVERY_VERIFIED=false
PRODUCTION_OBSERVABILITY_VERIFIED=false
```

后三项保持 false：全部证据来自本机临时目录与单机 SQLite，没有真实生产环境演练、
没有外部监控后端、没有跨机备份存储。

## Startup（fail-closed）

启动前依次检查，任一核心条件不满足 → 打印 `STARTUP_CHECKS_FAILED` 并以非 0 退出：

```text
startup.auth                 生产模式必须有 >=32 字符的 AUTH_SECRET（demo 不要求）
startup.db_dir / db_writable 业务库目录存在（可自动创建）且可写
startup.migrations           只允许在已知版本上 forward migrate；不认识更高版本 → 拒绝启动
startup.db_size              已存在的 DB 文件为 0 字节 → 拒绝启动（上一次异常中断）
startup.integration.*_partial 集成了半套配置（例如只配了 SUPERSET_DOMAIN）→ 拒绝启动
```

明确不做：启动后随机报错、静默 fallback 到 demo 用户、自动清空/重建数据库。

`SUPERSET_REQUIRED` / `POWERBI_REQUIRED` / `OPEN_SUPOS_REQUIRED` / `JEV_REQUIRED`
默认**不阻塞启动**，而是在 `/api/ready` 里报告；只有
`OPS_FAIL_FAST_INTEGRATIONS=true` 时才在启动阶段直接失败。

## Health 与 Readiness

```text
GET /api/health   进程存活（liveness）。永远只回答“进程还在”，不检查任何依赖
GET /api/ready    就绪（readiness），全部通过才 200；否则 503 + checks[]
```

`/api/ready` 检查项：

```text
database.reachable       SQLite 句柄可用
migrations.consistent    current/pending 可读，无 unknown / duplicate 版本
store.writable           取得写锁再回滚（证明可写且不留数据）
auth.config              production 必须有有效 AUTH_SECRET
integration.<name>       仅当该集成显式 REQUIRED=true 时才参与判定
disk.capacity            低磁盘只产生 warn/fail 提示，不做破坏性动作
```

未配置的外部集成（Superset / Power BI / open supOS / Jev）**不影响**核心 readiness。

## Graceful shutdown

```text
SIGTERM / SIGINT → 停止接收新请求（新请求得 503 shutting_down）
                → 等待在途请求（默认超时 SHUTDOWN_TIMEOUT_MS=10000）
                → 关闭 HTTP server
                → 关闭 SQLite 句柄
                → 输出 ops.shutdown.complete 并退出（超时退出码 124）
```

Docker 侧配合 `stop_grace_period: 15s`，避免 `docker stop` 直接硬杀。

## 结构化日志

每条一行 JSON（stdout）：

```json
{"timestamp":"...","level":"info","event":"http.request","requestId":"...","tenantId":"...","subjectId":"...","method":"GET","path":"/api/v2/...","status":200,"durationMs":4.2}
```

- 事件：`http.request`、`ops.startup_check`、`ops.started`、`ops.shutdown.*`、`http.unhandled`、`ops.error`
- 敏感字段（authorization / cookie / jwt / password / secret / token / embedToken / guestToken）
  在写出前递归脱敏为 `[redacted]`；字符串里的 `Bearer xxx` 与 JWT 也会被替换
- 错误只记录稳定 error code，不打印上游原始 body
- `LOG_LEVEL=debug|info|warn|error`（默认 info）

## Request ID

```text
接受客户端 X-Request-ID（仅当匹配 ^[A-Za-z0-9._:-]{1,128}$）
否则后端生成 UUID；响应头总是返回 X-Request-ID
同一 requestId 会同时出现在访问日志与安全审计 metadata.requestId
```

requestId 只用于关联排查，**不是**安全 token（不参与鉴权、不携带权限）。

## 运维状态 / 指标

```text
GET /api/v2/ops/status     需要 admin:tenant scope
```

返回：`appVersion / uptimeSeconds / startedAt / schemaVersion / supportedSchemaVersion /
migrationStatus{current,pending,unknown,duplicates} / databaseReachable / databaseSizeBytes /
databaseWritable / integrationsConfigured{superset,powerbi,openSupos,jev} /
requiredIntegrations / disk{usedPercent,freeBytes,thresholds} / runtimeMode`。

只返回配置**状态**（configured / unconfigured），绝不返回 host、secret、password、token 或连接串。

## 磁盘阈值

```text
OPS_DISK_WARN_PERCENT=90        # 默认，超过只 warn
OPS_DISK_CRITICAL_PERCENT=97    # 默认，超过 readiness 失败
```

低磁盘不会触发自动删除历史数据；清理必须由运维显式执行备份保留策略（见 backup-restore.md）。

## Docker

```text
Dockerfile : HEALTHCHECK 调 /api/health（liveness），不依赖任何外部集成
compose    : healthcheck + stop_grace_period=15s
```

readiness（含 required 集成）**不**用于容器 liveness，避免外部依赖抖动导致反复重启。

## 已知限制

- 单机 SQLite，没有主从复制、没有 PITR，RPO 等于「最近一次成功备份」
- 没有 Prometheus/Grafana/外部日志后端；/api/v2/ops/status 是最小 metrics
- 日志与审计都在本机；容器日志轮转交由运行环境
- 本手册的所有验证都是本机/临时目录级别，不代表真实生产演练

## 复现

```bash
npm run db:migrate:status
npm test -- tests/ops-runtime.test.ts tests/ops-http.test.ts
```

### 关于测试套件在高并发下的稳定性

`7f84edc` 的提交信息写了「npm test 446/446」，这个数字在复核时**无法稳定复现**，因此在此
据实记录（不改写已推送的提交）。历史上全量并行跑曾出现 1~3 个 HTTP 类用例超时：

```text
tests/grounded-ai-http.test.ts        每轮超时的具体用例会变（非确定性）  ← 已定位并修复
tests/ops-http.test.ts                偶发 SIGTERM 用例超时              ← 已定位并修复
tests/powerbi-embedded-http.test.ts   偶发 beforeAll hook 超时           ← 已定位并修复
frontend: "搜索异常" 防抖用例偶尔失败  ← 已定位并修复
```

这不是某个功能引入的：在基线 `eff0bce` 上用同一个 worktree 跑全量，同样是 2 failed / 69 passed，
且失败的具体用例与 `7f84edc` 上不同。结论是**既有**的资源竞争型 flaky。

#### 根因审计与修复

四处 flaky 全部做了根因定位。它们都属于**测试侧的等待语义/预算错误**，不是产品缺陷 ——
每一条的症状都是「真正的诊断信息被外层通用 timeout 抢先掩盖」。

1. **`powerbi-embedded-http` 的 beforeAll hook 超时**

   根因：该 hook **串行**启动 4 台服务器并逐个等待健康检查，串行累加超过 vitest 默认
   `hookTimeout`(10s)；同时 hook 自身的轮询预算（15s）**比 hook 预算更长** ——
   "服务器确实没起来"这条真正的失败信息永远没机会打印。

   修复（不是放大超时糊过去）：4 台服务器改为**并发**启动 + `Promise.all`；
   轮询间隔 50ms、预算写成显式常量 20s，并让 `hookTimeout` 不小于该预算，
   失败语义保留在 `waitUntilHealthy()` 的具名错误里。

2. **frontend「搜索异常 / 浏览器 Back」用例偶发失败**

   根因：该用例在 `window.history.back()` 之后只 `waitFor` 了 **`window.location.pathname`**。
   `location` 在 `popstate` 时是同步更新的，而 React 的重渲染是异步的；
   紧接着的同步 `expect(screen.getByLabelText("搜索异常"))` 会在负载高时抢在重渲染之前执行。

   修复：改为等待**真正的 UI 条件**（队列搜索框已带着过滤词渲染出来），再断言 location 与列表。

3. **`grounded-ai-http` 的用例级超时**

   根因：5 个 gate server 都在**测试体内**冷启动（`tsx` 解释启动 + 模块加载 + SQLite 初始化），
   其内部健康等待预算 15s，而 vitest 默认 per-test 预算是 5s —— 同样是不一致的预算，
   满负载时冷启动超过 5s 就被外层掐断。

   修复：6 台服务器全部在 `beforeAll` **并发预启动**（端口表写成具名常量），
   测试体只做请求断言，不承担冷启动成本；`hookTimeout` 显式设为 30s ≥ 内部预算。

4. **`ops-http` 的 graceful shutdown（SIGTERM）用例超时**

   根因：该用例等的是**进程退出**，内部等待上限 12s（超时后 `resolve(null)` 并断言失败，
   不会挂死），但外层 per-test 预算只有默认 5s —— 12s 的内部上限**永远无法生效**。

   修复：把该用例的服务器移到 `beforeAll` 预启动，测试体只做「健康检查 → SIGTERM → 等退出」，
   并给它显式的 20s 预算（≥ 内部 12s 上限），让"退出太慢"这条真实信号能被正确报告。

#### 放大器：被中断的测试运行会留下孤儿进程

排查过程中发现一个**独立的运维隐患**，它会把上面的偶发超时放大成灾难性结果：

```text
一次被 kill / 超时中断的 vitest 运行，不会回收它 spawn 出来的 src/server.ts 子进程。
这些孤儿进程继续占用端口与 CPU；下一次运行既可能与它们抢端口，也可能
"健康检查通过"其实答的是旧进程（端口被占的新进程已退出）。
实测：两个并发/残留的运行叠加时，vitest worker 的 RPC 会超时，
表现为 11 个测试文件失败、单次运行耗时 90 分钟。
```

处置约定：

- 跑全量测试前先确认没有残留：`ps -eo pid,etime,command | grep -E "src/server.ts|vitest" | grep -v grep`
  有输出就先 `pkill -f "src/server.ts"`；
- 不要在同一个工作区**并发**跑两次 `npm test`；
- 一次干净运行的正确基线是：**86 个测试文件、620 个用例全部通过，约 65 秒**。

判定改动是否真的通过，请以「单文件/单用例隔离运行」与下列命令为准：
`db:verify-backup`（10/10）、`ops:recovery-drill`（12/12）、`typecheck`、`eval`、
`superset:verify-embed`（需本机 Superset）、`open-supos:verify --mode contract`（6 项，LOCAL_CONTRACT_VERIFIED）。
