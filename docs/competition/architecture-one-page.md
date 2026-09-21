# Architecture One-Pager

一条主线，九个环节。**没有 30 个框，只有一条链路。**

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Industrial Systems（SIMULATED INDUSTRIAL ENVIRONMENT）               │
│   ERP 订单   MES 工单/报工/完工   QMS 检验   WMS 发货   Finance 收款  │
│   CRM 报价   Service 客诉                                            │
│   → 每个系统带自己的原始字段名（order_qty / completed_qty / ar_amount）│
└───────────────────────────────┬──────────────────────────────────────┘
                                │  16 条事件 · 14 天工业日历 · 7 个来源系统
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│ open supOS / UNS                                                     │
│   enterprise/{e}/site/{s}/area/{a}/line/{l}/{domain}/{entityId}/{event}│
│   ISA-95 空间（Enterprise→Site→Area→Line→Equipment）                  │
│   [已验证] UNS 契约 / MQTT-compatible 传输 / 运行时验证闸门            │
│   [未验证] 真实 open supOS 运行时                                     │
└───────────────────────────────┬──────────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Semantic Mapping（Industrial Mapping Manifest v1.0.0）               │
│   MES.completed_qty → ProductionOrder.completedQuantity → completedQty│
│   未声明字段直接报错（fail-closed）                                   │
└───────────────────────────────┬──────────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Evidence Layer                                                       │
│   Connector Runtime：Source Ledger / cursor / 幂等 / 重放             │
│   Evidence：来源系统 + 来源材料 + 材料内位置 + 观测时间               │
│   ← 回源闸门：账本 → rawHash 重算 → mapping 版本 → UNS → 规范事件     │
└───────────────────────────────┬──────────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Exception Engine（确定性）                                            │
│   7 条规则全部执行 → 命中 1 条：订单 100 vs 完工 96，差异 4            │
│   ORDER_PRODUCTION_COMPLETION_SHORTFALL × 1                          │
└───────────────────────────────┬──────────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│ AI Assistance（advisory only）                                        │
│   解释 + 候选动作；humanDecisionRequired=true                        │
│   canApprove=false　canExecute=false　不判断根因/责任                 │
└───────────────────────────────┬──────────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Human Governance（SoD 强制）                                          │
│   人受理 → 人复核 → 人提交 → 另一个人批准                              │
│   同人批准 → SEGREGATION_OF_DUTIES_VIOLATION                         │
│   证据不可回源 → EVIDENCE_NOT_VERIFIABLE（异常保留，禁止审批/执行）    │
└───────────────────────────────┬──────────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Execution / Outcome                                                  │
│   requested → accepted → 回读下游 → verified | failed                │
│   API write 成功 ≠ 业务动作完成                                       │
│   Outcome 用回读证据测量缺口是否归零（不主张因果）                     │
└───────────────────────────────┬──────────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Analytics（可选增强）                                                 │
│   只读运营投影 + site / line / sourceSystem 维度                      │
│   Superset 可用则嵌入；不可用不影响主流程                              │
└──────────────────────────────────────────────────────────────────────┘
```

## 依赖方向（只有一条）

```text
integration → domain → core
```

Domain 不导入 MQTT / UNS transport / BI SDK。工业语义层（`src/industrial`）与
回源层（`src/traceability`）都在领域之上，不反向依赖。

## 换个工厂要改什么

| 要改的 | 不用改的 |
| --- | --- |
| ISA-95 层级节点（企业/工厂/车间/产线/设备） | UNS topic 式子 |
| Mapping Manifest 条目（新系统的字段名） | Connector Runtime / Source Ledger |
| 场景参数（订单量、完工量…） | Evidence / Rule Engine / Governance / Outcome |
| 下游回读端点（真实 MES 客户端替换模拟下游） | 回源闸门与执行状态机 |

## 真值边界

```text
IMPLEMENTED + LOCALLY_VERIFIED   UNS 契约 / MQTT-compatible 传输 / Mapping / 回源闸门 / 回读 / 治理
NOT_VERIFIED                     真实 open supOS 运行时
NOT_IMPLEMENTED                  真实 MES / ERP / QMS / WMS 接入、真实工厂
```

逐条对照见 `docs/competition/judge-acceptance-matrix.md`。
