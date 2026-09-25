# Judge Acceptance Matrix

每一项都可以现场核对：**CLAIM → PROOF → COMMAND → ARTIFACT → TRUTH_STATUS**。
不允许夸大；做不到的写明 `NOT_VERIFIED` / `BLOCKED_BY_ENVIRONMENT`。

状态词只有：`LOCALLY_VERIFIED` / `DEMO_VERIFIED` / `LIVE_VERIFIED` / `NOT_VERIFIED` / `NOT_IMPLEMENTED` / `BLOCKED_BY_ENVIRONMENT`。

下面这张表是唯一事实索引。后面的 A–G 是同一批主张的展开，不另起一套结论。`LOCALLY_VERIFIED` 就是本地验证，不是真实工厂或生产环境。

| CLAIM | STATUS | COMMAND | TEST | ARTIFACT | LIMITATION |
| --- | --- | --- | --- | --- | --- |
| 工业多系统高仿真 | LOCALLY_VERIFIED | `npm run simulator:verify` | `tests/industrial-scenarios-ab.test.ts` | `INDUSTRIAL_SIMULATOR_LOCALLY_VERIFIED` | 仿真环境，不是真实工厂 |
| Evidence trace | LOCALLY_VERIFIED | `npm run evidence:verify -- --context <id>` | `tests/traceability-gate.test.ts` | `EVIDENCE_TRACE_VERIFIED` | 验证的是本地留存证据，不是客户现场 |
| 评委主场景 production-shortfall | LOCALLY_VERIFIED | `npm run demo:judge` | `tests/judge-demo.test.ts` | `JUDGE_DEMO_VERIFIED` | 不依赖外部运行时 |
| 证据不可回源时阻止审批和执行 | LOCALLY_VERIFIED | `npm run demo:judge -- --scenario evidence-broken` | `tests/judge-http.test.ts` | `EVIDENCE_NOT_VERIFIABLE` | 闸门在本地演示和 HTTP 测试中生效 |
| 重放幂等 | LOCALLY_VERIFIED | `npm run simulator:verify` | `tests/industrial-scenarios-ab.test.ts` | `replay.idempotent_all` | 只覆盖仿真场景 |
| 备份和恢复 | LOCALLY_VERIFIED | `npm run db:verify-backup` | `npm run ops:recovery-drill` | `BACKUP_RESTORE_VERIFIED` | 本地数据库演练，不是生产灾备 |
| open supOS 连接器与 UNS/MQTT 契约 | LOCALLY_VERIFIED | `npm run open-supos:verify -- --mode contract` | `tests/open-supos-adapter.test.ts` | `LOCAL_CONTRACT_VERIFIED` | 契约验证不是运行时验证 |
| open supOS runtime | NOT_VERIFIED | `npm run open-supos:verify -- --mode live` | — | `BLOCKED` | `REAL_OPEN_SUPOS_RUNTIME=NOT_VERIFIED` |
| real MES | NOT_VERIFIED | — | — | — | `REAL_MES_VERIFIED=false` |
| 真实工厂 / 真实客户 / 生产部署 | NOT_VERIFIED | — | — | — | 四项部署与客户标记保持 false |
| Superset 嵌入实现 | LOCALLY_VERIFIED | — | `tests/superset-guest-token.test.ts` | 历史本地仪表板记录 | 当前环境 `superset:verify-embed` 为 `BLOCKED_BY_ENVIRONMENT` |
| 依赖许可证与 SBOM | LOCALLY_VERIFIED | `npm run licenses:verify` | `npm run sbom` | `artifacts/sbom.cdx.json` | 项目许可证仍是 `LICENSE_DECISION_REQUIRED` |
| 干净目录复现 | LOCALLY_VERIFIED | `npm run competition:clean-room` | `npm run competition:verify` | `COMPETITION_CLEAN_ROOM_VERIFIED` | 不包含可选外部系统的现场验证 |

---

## A. 工业仿真与多系统来源

| # | CLAIM | PROOF | COMMAND | ARTIFACT | TRUTH_STATUS |
| --- | --- | --- | --- | --- | --- |
| A1 | 支持高仿真多系统工业数据（7 个来源系统、16 条按 14 天工业日历发生的事件） | `simulator:verify` → `multisystem.sources` PASS；每个场景 7 个来源系统均参与 | `npm run simulator:verify` | 终端报告 `INDUSTRIAL_SIMULATOR_LOCALLY_VERIFIED` | LOCALLY_VERIFIED |
| A2 | 同一 scenario + seed 完全可复现（ID / 顺序 / 数值） | 连跑 10 次 `demo:judge`，业务结论字段逐次一致 | `for i in $(seq 10); do npm run demo:judge --silent; done` | 10/10 `JUDGE_DEMO_VERIFIED` | LOCALLY_VERIFIED |
| A3 | 事件不是 fixture：按时间发生、来自不同系统、带各系统原始字段名 | `demo:judge` `[01]/[02]` 阶段；`tests/manufacturing-simulator.test.ts` 断言时间严格递增与来源系统映射 | `npm test -- manufacturing-simulator` | `.preview/judge-demo/uns-stream.jsonl` | LOCALLY_VERIFIED |
| A4 | 主场景只产生 1 个异常；正常场景 0 个异常 | `simulator:verify` → `discrimination.normal_vs_shortfall` PASS | `npm run simulator:verify` | 场景 A/B 报告 | LOCALLY_VERIFIED |

## B. UNS / 语义映射

| # | CLAIM | PROOF | COMMAND | ARTIFACT | TRUTH_STATUS |
| --- | --- | --- | --- | --- | --- |
| B1 | 全部事件落在 11 段 UNS topic 上（含 Enterprise/Site/Area/Line） | `simulator:verify` → `uns.topic_convention` PASS；`tests/industrial-uns-topic.test.ts` | `npm run simulator:verify` | topic 样例（`enterprise/demo-manufacturing/.../production/MO-IND-002/production.completed`） | LOCALLY_VERIFIED |
| B2 | 原始字段 → 统一工业语义的翻译是**声明式**的，且未声明字段 fail-closed | `mapping.coverage` 9/9；`tests/industrial-mapping-manifest.test.ts` 覆盖 7 类错误码 | `npm test -- industrial-mapping-manifest` | `industrial-mapping@1.0.0`（contentHash） | LOCALLY_VERIFIED |
| B3 | UNS topic 描述工业空间，不描述业务链（Context 与 UNS 分离） | `docs/industrial/uns-topic-convention.md`；解析结果 `tenantKey/contextBusinessKey = null` | `npm test -- industrial-uns-topic` | topic 与 Context 绑定对照 | LOCALLY_VERIFIED |
| B4 | open supOS **契约**已实现并通过本地验证 | `open-supos:verify --mode contract` 6/6 PASS | `npm run open-supos:verify -- --mode contract` | `LOCAL_CONTRACT_VERIFIED` | LOCALLY_VERIFIED |
| B5 | open supOS **真实运行时**可用 | 未连接任何运行时 | `npm run open-supos:verify -- --mode live` | gate 报告 `BLOCKED` | **NOT_VERIFIED** |

## C. 证据与回源（本项目的核心主张）

| # | CLAIM | PROOF | COMMAND | ARTIFACT | TRUTH_STATUS |
| --- | --- | --- | --- | --- | --- |
| C1 | 异常证据可回源：证据 → 账本 → 载荷哈希 → mapping 版本 → UNS → 规范事件 → 原始系统 | 10 跳全部 ✓ | `npm run evidence:verify -- --context <id>` | `EVIDENCE_TRACE_VERIFIED` | LOCALLY_VERIFIED |
| C2 | 结论能指出「订单 100 ← ERP-DEMO、完工 96 ← MES-DEMO」 | `evidence.json` 的 `sources.order/production` 带 systemKey / evidenceId / topic | `npm run demo:judge -- --json` | `.preview/judge-demo/evidence.json` | LOCALLY_VERIFIED |
| C3 | 拿不到留存载荷时**不算通过**（不把未检查当成已验证） | `tests/traceability-gate.test.ts` 缺载荷用例 → `EVIDENCE_NOT_VERIFIABLE` | `npm test -- traceability-gate` | trace 报告 `payload.retained` 失败 | LOCALLY_VERIFIED |
| C4 | 回源失败可被精确定位到具体那一条证据 | 故障注入后 15/16 条通过、1 条报 `raw_hash.match` | `npm run demo:judge -- --scenario evidence-broken` 后 `npm run evidence:verify` | 退出码 1 + 精确 evidenceId | LOCALLY_VERIFIED |

## D. 闸门 / 治理 / 执行（安全性质）

| # | CLAIM | PROOF | COMMAND | ARTIFACT | TRUTH_STATUS |
| --- | --- | --- | --- | --- | --- |
| D1 | 证据不可回源时，审批与执行被阻止，异常保留 | `demo:judge --scenario evidence-broken`：`governanceStatus=EVIDENCE_NOT_VERIFIABLE`、`executionStatus=blocked` | `npm run demo:judge -- --scenario evidence-broken` | 阶段 `[08]/[09]` 状态 `BLOCKED` | LOCALLY_VERIFIED |
| D2 | 闸门在 HTTP 审批/执行路径上真实生效（不是只写在 CLI 里） | `tests/judge-http.test.ts`：approve/execute 均 409 `EVIDENCE_NOT_VERIFIABLE`，且写入审计 `denied` | `npm test -- judge-http` | 409 响应体 + 安全审计记录 | LOCALLY_VERIFIED |
| D3 | 深度防御：即使审批在别处已完成，执行仍被拦 | 同一测试内先绕过 HTTP 批准，再 POST execute → 409 | `npm test -- judge-http` | 第二条 409 响应 | LOCALLY_VERIFIED |
| D4 | AI 不直接批准、不执行 | `evidence.json.ai.canApprove=false`、`canExecute=false`、`humanDecisionRequired=true`；确定性 provider 输出契约禁止结论 | `npm run demo:judge -- --json` | `decision-deterministic-demo` 输出 | LOCALLY_VERIFIED |
| D5 | SoD：同一个人不能批准自己提交的方案 | judge demo `[08]` 主动验证「同人批准被拒=是」；`tests/domain-v2-resolution-lifecycle.test.ts` 断言 `SEGREGATION_OF_DUTIES_VIOLATION` | `npm test -- domain-v2-resolution-lifecycle` | 治理阶段 PROOF 行 | LOCALLY_VERIFIED |
| D6 | 执行回读：write 成功 ≠ 业务完成；回读不一致 → failed，绝不 verified | 四态状态机 + 不一致/拒绝/异常/回读不可用用例 | `npm test -- execution-readback` | `execution-readback.json` | LOCALLY_VERIFIED |
| D7 | 结果测量有证据支撑、不主张因果 | `outcome.causalAttribution=false`，基线取自异常指标、当前值取自回读证据 | `npm run demo:judge` | `[10] Outcome` PROOF 行 | LOCALLY_VERIFIED |

## E. 重放 / 幂等 / 一致性

| # | CLAIM | PROOF | COMMAND | ARTIFACT | TRUTH_STATUS |
| --- | --- | --- | --- | --- | --- |
| E1 | 重放不产生重复异常（新账本=0 / 新事件=0 / 新异常=0） | `simulator:verify` → `replay.idempotent_all` 5/5 PASS | `npm run simulator:verify` | 重放证据行 | LOCALLY_VERIFIED |
| E2 | checkpoint 不会重复读取 | 同上报告 `checkpointRecordsRead=0` | `npm run simulator:verify` | 同上 | LOCALLY_VERIFIED |
| E3 | open supOS 契约路径同样幂等 | `open-supos:verify --mode contract` → `replay_idempotent` PASS | `npm run open-supos:verify -- --mode contract` | gate 报告 | LOCALLY_VERIFIED |

## F. 工程质量 / 可复现

| # | CLAIM | PROOF | COMMAND | ARTIFACT | TRUTH_STATUS |
| --- | --- | --- | --- | --- | --- |
| F1 | 一条命令完成核心演示 | CLI 11 阶段全 PASS | `npm install && npm run demo:judge` | `JUDGE_DEMO_VERIFIED` | LOCALLY_VERIFIED |
| F2 | 不依赖 Power BI / Superset / open supOS 运行时 / 外部 AI | `--ai none` 时 10/11 阶段通过；BI 不可用不影响 `[11] Analytics` | `npm run demo:judge -- --ai none` | 阶段报告 | LOCALLY_VERIFIED |
| F3 | 清场命令安全：只删 judge 专属工作区 | 路径安全闸门拒绝仓库根 / `.preview` / HOME / `.sqlite` / 越界路径 | `npm test -- judge-demo`；`npm run demo:judge:reset` | `JUDGE_WORKSPACE_RESET ok=true` | LOCALLY_VERIFIED |
| F4 | 全量测试通过且结果可复现（不是"偶尔绿"） | 后端 86 文件 / **620 用例全绿**、前端 68/68、e2e 6/6、typecheck、eval | `npm test && npm run frontend:test && npm run frontend:e2e && npm run typecheck && npm run eval` | 一次干净运行约 65s，无 failed/skipped 之外的不确定性 | LOCALLY_VERIFIED |
| F4b | 既有 flaky 已做根因审计并修复（不是放大超时） | 4 处 flaky 全部定位到「内部等待预算 > 外层预算」或「等待了非 UI 信号」；记录在 `docs/operations/production-operations.md` | `npm test`（跑前先清理残留 `src/server.ts`） | 同上 | LOCALLY_VERIFIED |
| F5 | 备份恢复与灾备可复现 | `db:verify-backup` 10/10；`ops:recovery-drill` 12/12 | `npm run db:verify-backup && npm run ops:recovery-drill` | `BACKUP_RESTORE_VERIFIED` / `RECOVERY_DRILL_VERIFIED` | LOCALLY_VERIFIED |
| F6 | Superset 嵌入链路 | 本机无 Docker，无法启动 Superset | `npm run superset:verify-embed` | `ECONNREFUSED 127.0.0.1:8088` | **BLOCKED_BY_ENVIRONMENT**（此前已有真实本地验证历史，本轮不复核） |
| F7 | Power BI 嵌入 | 未配置凭据 | — | — | **NOT_VERIFIED** |

## G. 明确不主张的能力

| # | CLAIM | TRUTH_STATUS |
| --- | --- | --- |
| G1 | 真实 MES 接入 | NOT_IMPLEMENTED |
| G2 | 真实 ERP 接入 | NOT_IMPLEMENTED |
| G3 | 真实 QMS 接入 | NOT_IMPLEMENTED |
| G4 | 真实 WMS 接入 | NOT_IMPLEMENTED |
| G5 | 真实工厂验证 | NOT_VERIFIED |
| G6 | 真实客户数据验证 | NOT_VERIFIED |
| G7 | open supOS 运行时验证 | NOT_VERIFIED |
| G8 | AI 自动批准 / 自动执行 | NOT_IMPLEMENTED（且被设计禁止） |
| G9 | 用仿真结果推导真实根因或责任归属 | NOT_IMPLEMENTED（输出明确标注 hypothesis / 不主张因果） |

---

## 一句话核对

```bash
npm install && npm run demo:judge && npm run evidence:verify -- --context <contextId>
```

`JUDGE_DEMO_VERIFIED` + `EVIDENCE_TRACE_VERIFIED` 同时成立，即为本轮全部主张。
