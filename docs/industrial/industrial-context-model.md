# 工业上下文模型（Industrial Context Model）

> 环境声明：本文描述的一切都在 **SIMULATED INDUSTRIAL ENVIRONMENT** 中运行。
> 事件顺序、多系统来源、UNS topic、mapping、connector、ledger、evidence、rule、exception、governance
> 全部是真实的执行链路；**只有「这家工厂」是仿真出来的**。
> 我们允许的表述是 *high-fidelity industrial simulation*，绝不是 *real factory*。

---

## 1 为什么需要五个不同的概念

一条「生产完工数量低于订单数量」的结论要成立，必须同时回答五个互相不能替代的问题。
把它们混成一个概念，就会出现两类事故：**结论无法复核**，或者**把仿真说成真实工厂**。

| 概念 | 回答的问题 | 定义位置 |
| --- | --- | --- |
| **UNS hierarchy** | 这件事发生在**哪个工业空间/资产**上？ | `src/industrial/hierarchy.ts` |
| **Business Context** | 这是**哪一条业务履约链**？ | `src/domain/v2/types.ts` (`FulfillmentContext`) |
| **Canonical Industrial Event** | 跨系统统一之后，这**一件事**到底是什么？ | `src/industrial/canonical-event.ts` |
| **SourceRecordEnvelope** | 这条数据是从**哪个连接器的哪一条原始记录**读到的？ | `src/connectors/core/types.ts` |
| **Evidence** | 这个结论**具体依据哪一份材料的哪一个字段**？ | `src/domain/v2/types.ts` (`V2Evidence`) |

五者的关系（注意箭头方向，依赖只有一条：集成 → 领域）：

```text
ISA-95 工业空间 (Enterprise/Site/Area/Line/Equipment)
        │  「在哪里发生」
        ▼
Factory Simulator  ──►  原始系统记录（ERP/MES/QMS/WMS/Finance/CRM/Service 各自的字段名）
        │
        │  Industrial Mapping Manifest：原始字段 → 统一工业语义
        ▼
Canonical Industrial Event        「发生了什么」
        ▲
        │  携带
SourceRecordEnvelope              「从哪条摄取记录来的」      ← Connector Core 契约，未改动
        │
        ▼
Domain Write Plan（Business Context / Entity / Event / Evidence）
        │
        ▼
Rule Evaluation → Exception → Resolution Governance → Outcome
```

---

## 2 UNS hierarchy：工业空间，不是业务链

ISA-95 风格层级（**不实现完整 ISA-95 标准**：不做 B2MML、不做设备能力模型）：

```text
Enterprise  demo-manufacturing
└── Site    factory-shanghai-01
    └── Area  assembly-workshop
        └── Line  line-a
            ├── Equipment  machine-a01          (MES 加工/装配)
            ├── Equipment  quality-station-a    (QMS 质检工位)
            └── Equipment  packing-station-a    (WMS 包装/发货工位)
```

**UNS 空间 ≠ Business Context。** 这是本层最重要的一条纪律：

- 空间回答「在哪里发生」。同一个 Line 上可以同时并存 `SO-IND-001`、`SO-IND-002` … 任意多条业务链。
- Context 回答「哪一条履约链」。它横跨销售、生产、质检、发货、财务、服务多个系统与多个工位。
- 因此 **UNS topic 里不出现 Context key**（见 `uns-topic-convention.md`），
  Context key 只出现在 UNS 信封的 `context.businessKey` 里。

设备粒度也遵循同一条纪律：

- Topic 只到 Line（不让 topic 维度爆炸）。
- 每条事件在自己的 `CanonicalIndustrialEvent.equipmentId` 与摄取账本 locator 里记录具体设备。
- **Context 级**的工业空间只声明到 Line。一个 Context 会跨加工中心 / 质检工位 / 包装工位，
  在 Context 上写一台设备就是编造；Context Summary 用 `equipmentIds[]` 如实列出实际涉及到的设备。

校验是 fail-closed 的：层级缺父级、层级错位、成环、空间坐标指向不存在的节点，
一律抛 `IndustrialSemanticError`，不会静默降级。

---

## 3 Business Context：一次业务履约链

Context 是既有领域模型里的对象，本轮**没有改动它的结构**。工业语义层只做两件事：

1. 把工业空间绑定写进 `context.metadata.unsSpace`（由 UNS 信封的 `metadata.unsSpace` 自然带入）；
2. 提供只读投影 `buildIndustrialContextSummary()`，让现有 Context 页面直接消费：

```text
enterprise / site / area / line     工业归属
unsRootPath                         该 Context 的 UNS 根路径
equipmentIds[]                      实际涉及到的设备
sourceSystems[]                     实际提供数据的来源系统（含 systemType 与 authorityLevel）
entities[]                          实体清单与各自事件数
eventCount / evidenceCount          事实与证据规模
exceptionCount / evaluationCount    规则与异常规模
trace[]                             可查询的履约链（见第 5 节）
mappingVersions[]                   这份数据是用哪个 mapping 版本翻译的
```

没有 UNS 绑定的历史 Context（例如既有 fixture）返回 `space: null`，**不编造**一个工业空间。

---

## 4 Canonical Industrial Event：统一事件语言

`CanonicalIndustrialEvent` 的位置严格在 `SourceRecordEnvelope` 与 Domain Event **之间**：

- 比 Envelope **多**：工业空间坐标（含设备）、原始字段→规范字段的翻译清单、UNS topic。
- 比 Domain Event **少**：不做领域投影的裁剪，也不决定写哪些实体。

字段（`src/industrial/types.ts`）：

```text
eventId            由 (tenant, connectorId, externalRecordId, sourceVersion, rawHash, mappingVersion) 决定，可重放去重
tenantId
enterpriseId / siteId / areaId / lineId / equipmentId
sourceSystem       例如 MES-DEMO
sourceRecordId     摄取账本里的真实记录 ID（join 得到，不编造）
entityType / entityId / eventType
occurredAt / observedAt
payload            规范字段（不是原始字段）
mappingVersion
sourceLocator      Connector Core 的摄取位置（topic / namespace / 外部记录）
rawHash
unsTopic
businessContextKey
provenance         connectorId / installation / sourceVersion / sourceSystemType / fieldMapping[]
```

这就让「MES、ERP、QMS、WMS、Finance 最终都映射成同一事件语言」成为**可检查**的事实：
每个事件的 `provenance.fieldMapping` 都写明它来自哪个系统的哪个字段。

`sourceRecordId` 由 `joinCanonicalEventsWithLedger()` 与来源账本做确定性 join。
对不上账本的 Canonical Event 一律抛 `CANONICAL_EVENT_WITHOUT_LEDGER_RECORD` —— 它没有摄取证据。
（重复投递的那一轮不会再触发适配，因此该轮不产出新的 Canonical Event；这不是缺口，是幂等的表现。）

---

## 5 可追溯性：一个 Exception 向前追到所有原始事实

不引入图数据库。链条全部由既有 Context model 推导（实体 + 事件 + 证据 + 来源）：

```text
SalesOrder → ProductionOrder → QualityInspection → Shipment
           → Invoice → Receivable → Payment → Complaint
```

- `INDUSTRIAL_TRACE_ORDER` 是唯一一处顺序定义（`src/industrial/context-summary.ts`）。
- 每个节点带：`entityType / businessKey / sourceSystemId(s) / domain / occurredAt / eventCount / evidenceIds[]`。
- 来源系统的取值优先用 `entityReference`（fixture 路径），否则回落到证据的 `sourceSystemId`
  （connector 摄取路径）。两条路径都不会编造来源；同一实体确实由多个系统写入时，
  `sourceSystemId` 为 `null` 而 `sourceSystemIds[]` 列出全部，不挑一个「看起来对」的。
- `buildIndustrialExceptionTrace()` 以**证据包**为唯一输入，为每条事实给出
  字段、值、证据 ID、来源系统、来源材料（`externalDocumentId` / `documentType` / `version`）、
  材料内位置（locator）与观测时间。**不含任何推断值。**

于是「这个结论的数据来自哪个模拟工业系统」是有答案的，而不是靠叙述。

---

## 6 真值边界（Truth Flags）

```text
INDUSTRIAL_SIMULATOR_IMPLEMENTED=true
INDUSTRIAL_SIMULATOR_LOCALLY_VERIFIED=true
ISA95_UNS_HIERARCHY_IMPLEMENTED=true
UNS_TOPIC_CONVENTION_IMPLEMENTED=true
INDUSTRIAL_MAPPING_MANIFEST_IMPLEMENTED=true
CANONICAL_INDUSTRIAL_EVENT_IMPLEMENTED=true
MULTISYSTEM_INDUSTRIAL_FLOW_LOCALLY_VERIFIED=true
INDUSTRIAL_REPLAY_LOCALLY_VERIFIED=true

REAL_MES_VERIFIED=false
REAL_ERP_VERIFIED=false
REAL_QMS_VERIFIED=false
REAL_WMS_VERIFIED=false
REAL_FACTORY_VERIFIED=false
```

这些 flag 由 `npm run simulator:verify` 真实跑出来后打印，不是文档里手写的声明。
只要任一检查项失败，`INDUSTRIAL_SIMULATOR_LOCALLY_VERIFIED` 与整体 verdict 一起变为 false / `FAILED`。

**Simulator 不是真实工厂。** 即使 `--transport mqtt` 成功投递到一个真实 broker，
它证明的仍然只是「同一份仿真数据能穿过真实传输层」，不能升级任何 `REAL_*_VERIFIED`。

---

## 7 与既有对象的关系（本轮没有删除任何东西）

| 既有对象 | 本轮变化 |
| --- | --- |
| `SO-MFG-001` fixture | 保留，继续作为静态演示数据；仿真数据不写进它的库 |
| `Manufacturing Pack` / 7 条规则 | 复用，未改规则语义；仿真直接使用同一套规则 |
| `OpenSuposInboundConnector` | 复用；只新增了对 industrial topic 前缀的接受与工业 locator 字段 |
| `SourceRecordEnvelope` | **未改动** |
| `Entity` / `Event` / `Evidence` | 未改结构 |
| `UNS manifest`（`SO_MFG_001_UNS_MANIFEST`） | 保留 legacy 6 段 topic；带 `unsSpace` 绑定的信封走新的 11 段式子 |

## 8 附录：本轮开始前的模型审计

### CURRENT_MODEL（审计时已存在，均未被删除）

| 对象 | 位置 | 说明 |
| --- | --- | --- |
| `SO-MFG-001` fixture | `src/domain/v2/fixtures/so-mfg-001.ts` | 静态制造业演示数据：1 Context、7 SourceSystem、8 Entity、8 EntityReference、8 SourceDocument、**11 条事件**、11 条 Evidence |
| 业务对象 | 同上 | Quote / SalesOrder / ProductionOrder / QualityEvent / Shipment / Receivable / Payment / Complaint（8 类实体，11 条事件） |
| Manufacturing Pack | `src/solution-packs/manufacturing-fulfillment/` | 规则 + Outcome + Presentation + Eligibility + Demo provisioning |
| 制造业规则 | `src/domain/v2/rules/so-mfg-001-rules.ts` | 7 条（4 条基础履约 + 3 条制造业专属），tenant `demo-manufacturing`、profile `manufacturing` |
| `OpenSuposInboundConnector` | `src/integrations/open-supos/connector.ts` | push 语义 → `InboundConnector` 契约，含 checkpoint cursor 与 `OpenSuposSourceAdapter` |
| UNS 信封 | `src/integrations/open-supos/envelope.ts` | `OpenSupOSUnsEnvelope` schemaVersion 1.0 + 严格解析 |
| UNS manifest | `src/integrations/open-supos/manifests/so-mfg-001.ts` | SO-MFG-001 的 11 条 UNS 信封 |
| `SourceRecordEnvelope` | `src/connectors/core/types.ts` | 摄取证据契约（Connector Core） |
| Connector Runtime | `src/connectors/core/inbound-runtime.ts` | Source Ledger / cursor / 幂等 / 重放 / 下游完成标记 |
| Entity / Event / Evidence | `src/domain/v2/types.ts` | 领域事实与证据 |
| Rules / Exception | `src/domain/v2/rule-engine.ts` | 确定性规则引擎，输出 RuleEvaluation + Exception candidate |
| A/B 契约用例 | `src/integrations/open-supos/ab-cases.ts` | `normal-order`（0 异常）与 `exception-order`（1 异常），共用同一条连接器入口 |

### MISSING_INDUSTRIAL_SEMANTICS（本轮之前缺失的能力）

| 缺失 | 后果 |
| --- | --- |
| 没有工业层级 | 业务对象无法回答「发生在哪个 Enterprise/Site/Area/Line/Equipment」 |
| 没有集中定义的 UNS topic 约定 | topic 只在 6 段 legacy 式子里，且不含工业空间；无集中定义处 |
| 没有 Mapping Manifest | 来源系统字段名 → 规范字段的翻译散落在适配器代码里，一线业务与甲方 IT 无法复核 |
| 没有 Canonical Industrial Event | 多系统数据没有统一的中间语义层；「MES/ERP/QMS/WMS/Finance 映射成同一语言」不可检查 |
| 没有数据产生器 | 只有静态 fixture，无法演示时间顺序、多系统来源、短少/不合格/短装/短款的判别力 |
| 没有 replay/判别力闸门 | 只有 A/B 两个点，缺 5 场景 + 重放的自动化 A/B 验证 |
| Context 无工业投影 | Context 页面拿不到 enterprise/site/area/line/sourceSystems/equipment |
| analytics 无工业维度 | 无法按 site / line / sourceSystem 看异常 |

### REUSABLE_COMPONENTS（本轮复用而非重写的东西）

| 复用对象 | 复用于 |
| --- | --- |
| Connector Core `runInboundSync` | 仿真的 ledger / cursor / 幂等 / 重放，全部沿用，未新增 ingestion framework |
| `OpenSuposInboundConnector` + `OpenSupOSUnsQueue` | 仿真信封的摄取入口；MQTT 载荷就是它现有契约 |
| `OpenSuposSourceAdapter` + `mapUnsEnvelopeToDomainPlan` | 领域写计划，完全未改；Canonical Event 只是链路中多出的一层 |
| `MANUFACTURING_RULE_DEFINITIONS/VERSIONS`（7 条规则） | 5 个仿真场景直接使用同一套规则，未改规则语义、未新增质量规则 |
| `evaluateContextRules` / `buildResolutionCapabilities` | demo 的第 07/08/09 步 |
| `buildOperationalAnalytics` | demo 的第 10 步；只做最小字段扩展 |
| `buildV2WorkbenchView` | Context 页面；只新增 `industrial` 只读投影 |
| `FULFILLMENT_EVENT_TYPES` | 新增 `PRODUCTION_PROGRESSED` 一项（既有的 `SHIPMENT_CREATED` / `SHIPMENT_SIGNED` / `INVOICE_CREATED` 直接复用） |
| `InMemoryUnsTransport` / `OpenSupOSMqttTransport` | transport 抽象的两个实现直接复用 |

## 9 相关文档

- `docs/industrial/uns-topic-convention.md` — topic 式子与双向映射
- `docs/industrial/mapping-manifest.md` — 声明式字段翻译
- `docs/industrial/factory-simulator.md` — 仿真器、场景与现场演示
