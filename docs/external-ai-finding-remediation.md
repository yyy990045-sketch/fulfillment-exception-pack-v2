# 外部 AI 审查建议处理结果

来源：`deep-research-report (4).md`。该文件作为外部审查意见使用；本记录只说明当前仓库实际落地的修改，不把报告中的建议当作代码指令直接执行。

## 本轮已处理

1. **租户边界**：新建案件时统一使用请求租户生成 runtime、evidence pack 和 evidence；详情接口隐藏原始材料及 `expected*` 评估字段。
2. **操作者与状态机**：所有业务写操作要求 actor；限制 actor alias；禁止已批准/已执行/已结案案件重新 propose；审批、执行、结案分别校验动作状态与回执。
3. **并发写入**：review、adjudication、propose、approve、execute、close 统一使用同进程案件串行队列，并在队列内重新读取最新状态；存储层增加跨进程租户锁、临时文件原子替换和陈旧锁恢复。
4. **运行时与评估解耦**：`propose` 只根据 evidence pack 的冲突、缺口和内容规则生成动作；`expectedActionTypes` 仅留在 eval fixture 中用于独立比较。
5. **运行时缺口门禁**：`propose` 在所有业务问题完成 review 后仍会拒绝带材料缺口的案件；Agent graph 和 `runHappyPath` 会停在 Review，不会生成行动草案或伪造回执。
6. **证据链**：Evidence ID 和结构化字段键包含 `sourceVersion`；保留 `orderId` 字段；缺口检测只从 complaint 材料判断。
7. **业务问题和裁决**：冲突 pair 增加 `conflictIssues` 聚合，同一事实差异只计一个业务问题；review 保存 issue、决策、选中证据、理由、操作者和时间；report decision 单独记录。
8. **前端竞态**：render 增加请求代次和案件/模块快照；旧响应不能覆盖当前页面；动作请求捕获目标案件。
9. **前端状态语义**：队列将 `confirmed` 显示为“已确认”；`rejected` 不再开放处理层，概览会明确显示驳回状态。
10. **报告可追溯**：执行阶段通过 `local-ledger` 能力台账写入持久化回执，报告和 UI 展示 external request id 与精确 locator；重复 review/execute 均保持幂等；GET 初始化不写入存储；未知 capability 返回 404。
11. **存储兼容**：租户文件名改用 SHA-256 派生键，同时兼容读取旧版文件名。

## 当前验证证据

- `npm test`：28/28 通过。
- `npm run typecheck`：通过。
- `npx tsx src/eval/cli.ts`：30 个案例，`actions=23/23`（带材料缺口的案例按 gate pass 计入负向检查，不计入可提案动作分母），`failures=0`、`negativeFailures=0`。
- 本地 `127.0.0.1` API smoke：跨租户详情只返回请求租户数据且不返回 materials/expected*；缺 actor 返回 401；未知 capability 返回 404；re-propose 返回 409；无回执 close 返回 409；GET detail/report 不新增租户文件。

## 尚未宣称完成的事项

- `x-actor` 仍保留为非生产演示兼容头；生产路径要求 HS256 bearer JWT（`sub`、`tenant_id`、`roles`、`scopes`、`exp`），并在服务启动时校验 `AUTH_SECRET`。
- 增加了 SQLite WAL + `BEGIN IMMEDIATE` 原子 upsert 存储后端（`PACK_STORE_BACKEND=sqlite`），JSON 文件后端仍只用于本地演示；生产还需在目标环境验证备份、迁移、连接池和多实例部署策略。
- 当前 eval 仍使用合成金标准，不能当作真实业务准确率。
- 冲突明细仍保留 pair 供回溯，UI 尚未把同一 issue 的多个 pair 合并成单张卡片。
- CSV 已支持 BOM、引号逗号、引号换行、转义引号、CRLF 和严格列数/数值校验；证据刷新支持按顺序的多端点降级并记录尝试；OpenAPI 已覆盖当前路由、错误状态和请求 schema；`more/outcome` 已把结果、说明、actor、时间写入案件审计链；执行动作现在会落入 SQLite/JSON `local-ledger` 台账并可通过 `/receipts` 回读，重启后仍可核验。真实 IdP/OIDC、CRM/ERP 目标系统接入和生产数据库运维仍需目标环境契约与验收。
