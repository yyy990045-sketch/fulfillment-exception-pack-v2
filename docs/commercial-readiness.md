# Commercial Readiness

本文件描述当前仓库、当前运行环境能够支持的真实商业边界。状态词只使用以下集合：

`IMPLEMENTED` / `LOCALLY_VERIFIED` / `DEMO_VERIFIED` / `LIVE_VERIFIED` / `NOT_VERIFIED` / `NOT_IMPLEMENTED`

## Capability Matrix

| Capability | Implementation | Local Runtime | Demo Verified | Real External Runtime | Commercial Claim | Evidence / Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Business Digital Thread | IMPLEMENTED | LOCALLY_VERIFIED | DEMO_VERIFIED | NOT_VERIFIED | DEMO_VERIFIED | 基于 Context、实体、事件、Evidence 的只读业务线程；展示顺序不代表因果关系。 |
| Rule Engine | IMPLEMENTED | LOCALLY_VERIFIED | DEMO_VERIFIED | NOT_VERIFIED | DEMO_VERIFIED | 确定性规则引擎；输入为 Domain facts，输出 RuleEvaluation 与 Exception candidate。 |
| Exception Detection | IMPLEMENTED | LOCALLY_VERIFIED | DEMO_VERIFIED | NOT_VERIFIED | DEMO_VERIFIED | 由规则评估产生 Exception；异常不自动等于治理或业务结果。 |
| Evidence Layer | IMPLEMENTED | LOCALLY_VERIFIED | DEMO_VERIFIED | NOT_VERIFIED | DEMO_VERIFIED | 支持来源系统、文档、locator、quote、observedAt、support 和 evidence ID。 |
| Grounded AI Explanation | IMPLEMENTED | LOCALLY_VERIFIED | DEMO_VERIFIED | NOT_VERIFIED | DEMO_VERIFIED | deterministic provider 与 OpenAI-shaped contract 已实现；OpenAI live call 未验证。AI 解释不等于人工事实确认。 |
| Root Cause Hypothesis | IMPLEMENTED | LOCALLY_VERIFIED | DEMO_VERIFIED | NOT_VERIFIED | DEMO_VERIFIED | 输出明确标记为 hypothesis；不是已确认事实，也不是责任归属。 |
| Decision Recommendation | IMPLEMENTED | LOCALLY_VERIFIED | DEMO_VERIFIED | NOT_VERIFIED | DEMO_VERIFIED | 提供候选动作与理由；必须经过人工治理，不自动执行。 |
| Policy Engine | IMPLEMENTED | LOCALLY_VERIFIED | DEMO_VERIFIED | NOT_VERIFIED | DEMO_VERIFIED | 输出 human_only / approval_required / auto_eligible 等资格判断；不替代审批。 |
| Approval / SoD | IMPLEMENTED | LOCALLY_VERIFIED | DEMO_VERIFIED | NOT_VERIFIED | DEMO_VERIFIED | 支持审批、角色边界、subjectId 分离和职责分离校验。 |
| Resolution Workflow | IMPLEMENTED | LOCALLY_VERIFIED | DEMO_VERIFIED | NOT_VERIFIED | DEMO_VERIFIED | 支持受理、复核、方案、提交审批、批准、执行、回执、结案。 |
| Internal Automation | IMPLEMENTED | LOCALLY_VERIFIED | DEMO_VERIFIED | NOT_VERIFIED | DEMO_VERIFIED | 当前只形成真实内部 Work Item / 内部动作闭环；不执行外部 ERP/WMS 动作。 |
| Execution Receipt | IMPLEMENTED | LOCALLY_VERIFIED | DEMO_VERIFIED | NOT_VERIFIED | DEMO_VERIFIED | 记录内部执行回执和 hash；receipt 不等于业务结果达成。 |
| Outcome Measurement | IMPLEMENTED | LOCALLY_VERIFIED | DEMO_VERIFIED | NOT_VERIFIED | DEMO_VERIFIED | 是后续 Evidence-backed observation，不证明处置导致业务结果变化。 |
| Operational Analytics | IMPLEMENTED | LOCALLY_VERIFIED | DEMO_VERIFIED | NOT_VERIFIED | DEMO_VERIFIED | 只读运营投影，支持 Context 与异常 occurrence 时间口径。 |
| Solution Pack Platform | IMPLEMENTED | LOCALLY_VERIFIED | DEMO_VERIFIED | NOT_VERIFIED | DEMO_VERIFIED | 支持 Pack 安装、显式 Context binding、Workbench projection 和跨领域复用。 |
| Manufacturing Pack | IMPLEMENTED | LOCALLY_VERIFIED | DEMO_VERIFIED | NOT_VERIFIED | DEMO_VERIFIED | Manufacturing Fulfillment 示例 Pack，含规则、Evidence、治理与 Outcome projection。 |
| Finance Reconciliation Pack | IMPLEMENTED | LOCALLY_VERIFIED | DEMO_VERIFIED | NOT_VERIFIED | DEMO_VERIFIED | 财务对账示例 Pack，通过 Generic Workspace 展示同一底座复用。 |
| OpenAI Provider | IMPLEMENTED | LOCALLY_VERIFIED | NOT_VERIFIED | NOT_VERIFIED | NOT_VERIFIED | Provider、strict schema、citation/numeric validation 已实现并本地验证；没有真实 API key 时明确返回 not_configured。 |
| Jev | IMPLEMENTED | LOCALLY_VERIFIED | NOT_VERIFIED | NOT_VERIFIED | NOT_VERIFIED | 官方 object-map contract、Choice/Score/Noul normalization 已实现并 fixture 验证；live Jev 未验证。 |
| Open supOS Adapter | IMPLEMENTED | LOCALLY_VERIFIED | NOT_VERIFIED | NOT_VERIFIED | NOT_VERIFIED | Adapter、UNS mapping、inbound contract 已实现；真实 Open supOS runtime 未启动、未验证。 |
| Connector SDK | IMPLEMENTED | LOCALLY_VERIFIED | DEMO_VERIFIED | NOT_VERIFIED | DEMO_VERIFIED | 包含安装、secretRef、transactional outbox、lease、attempt、receipt；reference HTTP connector 只连接本地测试服务器。 |
| ERP integration | NOT_IMPLEMENTED | NOT_VERIFIED | NOT_VERIFIED | NOT_VERIFIED | NOT_VERIFIED | 没有客户 ERP 环境的真实连接、认证、字段映射或端到端验证。 |
| MES integration | NOT_IMPLEMENTED | NOT_VERIFIED | NOT_VERIFIED | NOT_VERIFIED | NOT_VERIFIED | 没有客户 MES 环境的真实连接、认证、字段映射或端到端验证。 |
| QMS integration | NOT_IMPLEMENTED | NOT_VERIFIED | NOT_VERIFIED | NOT_VERIFIED | NOT_VERIFIED | 没有客户 QMS 环境的真实连接、认证、字段映射或端到端验证。 |
| WMS integration | NOT_IMPLEMENTED | NOT_VERIFIED | NOT_VERIFIED | NOT_VERIFIED | NOT_VERIFIED | 没有客户 WMS 环境的真实连接、认证、字段映射或端到端验证。 |

## Truth Boundaries

### Root Cause

Root Cause 输出是 `hypothesis`，不是真实根因事实。系统可以展示支持证据、反驳证据、缺失证据和人工验证步骤，但不能把模型输出升级为已确认根因或责任归属。

### Outcome

Outcome 是后续业务状态 observation，不是因果效果。即使目标指标改善，也不能说前序治理动作导致了改善。

### Grounded AI

Grounded AI Explanation 必须基于已有 Evidence，并通过 citation 和 numeric validation。它不等于人工事实确认，也不会修改 Exception、Resolution、Policy 或 Execution 状态。

### Internal Automation

Internal Automation 当前只证明内部动作闭环，例如创建内部任务或补证请求。它不证明外部 ERP、MES、QMS、WMS 或银行动作已经执行。

### Connector

Connector SDK 和 reference/local connector 能力已经实现。它们不能被表述为已经接入真实 ERP、WMS 或客户生产系统。

### Open supOS

Adapter 已实现。真实 Open supOS runtime 当前是 `NOT_VERIFIED`。

### Jev

Jev contract 已实现并本地验证。Live Jev 当前是 `NOT_VERIFIED`。

### OpenAI

OpenAI provider 已实现并通过本地 contract / mock / validation 测试。当前没有真实 API key 的 live verification 结果，因此生产环境验证仍是 `NOT_VERIFIED`。

### ERP / MES / QMS / WMS

当前没有真实客户系统验证。四类系统均为 `NOT_IMPLEMENTED` 与 `NOT_VERIFIED`，不得包装成已接入。

## Pilot Scope

### Can Commit

以下能力可以用于受控私有部署、本地试点和方案验证，但都受对应限制约束：

| Pilot Capability | Limit |
| --- | --- |
| 私有部署 / 本地试点 | 当前以单环境、受控租户和本地数据为主；SLA、HA、生产运维未验证。 |
| 业务上下文与履约数字线程 | 用于展示业务顺序和事实关系，不代表因果关系。 |
| 确定性规则异常识别 | 依赖已配置规则和输入字段；规则质量需要客户业务确认。 |
| 多来源证据核验 | 需要来源文档、映射和 Evidence 质量满足规则要求。 |
| AI 辅助解释 | 输出是基于 Evidence 的辅助分析，不是人工事实确认。 |
| 根因假设 | 是待验证 hypothesis，不是真实根因结论。 |
| 决策建议 | 是候选建议，必须人工决策，不是自动执行指令。 |
| 人工审批与职责分离 | 依赖配置的角色、subjectId 和审批边界；正式 RBAC 管理后台未实现。 |
| 处置治理流程 | 支持受控人工治理闭环；外部系统影响仍需 Connector 验证。 |
| 内部执行动作 | 当前只验证内部 work item / reference/local delivery。 |
| 回执留痕 | 回执表示内部或 reference delivery 已登记，不等于业务结果达成。 |
| 后续结果观察 | 用于观察 Evidence-backed 业务状态，不做因果归因。 |
| 运营视图 | 当前支持单环境、单租户范围的运营查看和 drill-down。 |
| Solution Pack 扩展机制 | 当前是代码包能力和显式 Context binding，不含远程插件市场。 |
| Manufacturing / Finance 两种业务示例 | 是 synthetic demo 与本地验证，不是真实客户生产数据。 |

### Cannot Claim Yet

- 已真实接入客户 ERP
- 已真实接入 MES
- 已真实接入 WMS
- 已真实接入 QMS
- Open supOS 已生产验证
- Jev 已 live 验证
- AI 判断等于真实根因
- Outcome 等于因果效果
- 所有外部动作可自动执行
- 已具备完整生产级多租户运维能力
- 已具备正式 RBAC 管理后台
- 已完成所有性能优化

## Production Gaps

### P0 — Pilot Blocker

0

### P1 — Production Blocker

1. Page query fragmentation：页面仍存在多个独立 query state，增加慢网络下的闪烁和局部状态不一致风险。
2. Multi-tenant bootstrap isolation：`bootstrapPackContextBindings` 遇到某 tenant 的 ambiguous binding 会让 server startup fail closed。受控单租户 Pilot 可接受；正式多租户生产需要 tenant-level isolation 和 migration diagnostics。
3. Real external connector validation：尚无真实 ERP / MES / QMS / WMS / bank / external task 系统的认证、字段映射、重试和回执验证。
4. Formal identity / RBAC administration：有认证、角色和能力投影，但没有完整的组织、用户、角色、权限管理后台。
5. Backup / restore / migration operations：有 SQLite migration 和测试，但没有生产级备份、恢复演练、跨版本升级回滚自动化。
6. Production observability：缺少完整指标、告警、trace、审计日志保留策略和多租户运营监控。

### P2 — Scale / Polish

1. Frontend bundle chunk warning。
2. Legacy static surface cleanup。
3. Advanced queue filters、saved views 和复杂多选筛选。
4. Section container / presentation helper 继续收敛。
5. Browser cache and deployment cache-busting playbook。

## Recommended Wording

可以说：

- “系统已实现业务线程、规则异常、证据核验和人工治理闭环。”
- “当前试点环境已验证 Manufacturing 与 Finance 示例 Pack。”
- “支持通过 Connector 扩展外部系统交互，但真实系统接入需要单独实施和验证。”
- “AI 输出为基于证据的辅助判断，不是人工事实确认。”
- “后续测量用于观察业务状态，不证明前序动作导致结果变化。”
- “Open supOS adapter 已实现，真实 runtime 尚未验证。”
- “Jev contract 已实现，live provider 尚未验证。”

不能说：

- “已经全面接入 ERP”
- “AI 自动找到真实根因”
- “AI 自动解决所有异常”
- “处置后一定提高经营指标”
- “已完成 Open supOS 生产落地”
- “Jev 已在生产环境验证”
- “所有外部系统动作已经自动执行”
