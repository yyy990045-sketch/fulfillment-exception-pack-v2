# 履约例外处理台目标架构（阶段 1 封板）

# 1. 项目目标

当前项目起点是 Case-centric 的履约异常演示包：

```text
材料 -> Evidence -> Conflict -> Case -> Action -> Approval -> Receipt -> Verification
```

目标升级为 Order-centric / Fulfillment-centric 的跨系统履约风险治理平台：

```text
业务来源
  -> 统一履约上下文
  -> 跨系统业务实体与事件
  -> 可回源 Evidence
  -> 风险识别与解释
  -> 人工确认
  -> 处置、审批、执行和核验
```

V1 和 V2 暂时并行：

- V1 继续承担履约异常处理闭环。
- V2 建立订单履约事实、关系、时间线和证据底座。
- 本阶段不实现 Rule Engine、Exception Engine 或 AI 判断。

# 2. V1 架构

V1 的核心对象和处理链继续复用：

```text
Case
  -> Evidence
  -> Conflict
  -> Finding
  -> Action
  -> Approval
  -> Capability Receipt
  -> Verification
  -> Closure
```

V1 中可继续复用的能力：

- Case 状态机和非法跳转保护。
- Evidence 的 source、version、locator、quote、confidence、support 语义。
- 冲突检测和冲突人工核对。
- Action draft、审批门禁、执行幂等和本地回执。
- 无回执不得核验结案。
- Case 事件轨迹和历史回放。
- V1 工作台和现有 API。

# 3. V1 的边界

V1 Case 是异常处理对象，不是订单业务事实对象。

```text
V1 Case
  = 已发现的异常及其处理过程

V2 FulfillmentContext
  = 一笔持续存在的商业履约事实
```

两者边界：

- Context 可以在没有异常时存在。
- 异常是 Context 上某一时刻的判断结果，不是 Context 本身。
- Case 可以指向 Context，但 Context 不能被建模成 Case。
- Case 的处理状态不能替代订单履约状态。
- V1 的 Conflict 不能直接作为 V2 的业务事实。
- V2 的 Evidence 不能被自动当作已确认异常。

# 4. V2 Domain Kernel

V2 领域核心包括：

| 对象 | 职责 |
| --- | --- |
| `FulfillmentContext` | 一笔需要追踪的完整商业履约上下文 |
| `BusinessEntity` | 报价、订单、生产、质量、发运、应收、回款、客诉等业务对象 |
| `EntityReference` | 内部实体与外部系统 ID 的映射 |
| `SourceSystem` | 来源系统、系统类型、来源权威级别和状态 |
| `SourceDocument` | 来源文档、版本、内容哈希和业务生效时间 |
| `FulfillmentEvent` | 发生过的业务事件、业务时间和记录时间 |
| `V2Evidence` | 绑定来源文档、实体、事件和原文位置的事实 |

关系约束：

```text
Context 1 -> N BusinessEntity
BusinessEntity 1 -> N EntityReference
SourceDocument N -> 1 SourceSystem
FulfillmentEvent N -> 1 FulfillmentContext
FulfillmentEvent N -> 1 BusinessEntity
V2Evidence N -> 1 SourceDocument
V2Evidence N -> 0..1 BusinessEntity
V2Evidence N -> 0..1 FulfillmentEvent
```

所有关系都必须 tenant-scoped；跨租户关系 fail-closed。

# 5. Fulfillment Digital Thread

第一份正式 V2 fixture 是 `SO-DEMO-001`：

```text
Quote
  QT-DEMO-001
  qty = 100
        |
        v
SalesOrder
  SO-DEMO-001
  qty = 100
        |
        v
Shipment
  SH-DEMO-001
  qty = 96
        |
        v
Receivable
  AR-DEMO-001
  amount = 100000
        |
        v
Payment
  PAY-DEMO-001
  amount = 80000
        |
        v
Complaint
  CP-DEMO-001
  claimedReceivedQty = 80
```

这是一条事实链，不是结论链。

当前不判断：

- `100 vs 96` 是否异常。
- `96 vs 80` 是否异常。
- `80000 / 100000` 是否存在回款风险。
- 客诉声明是否成立。

这些判断属于后续 Rule / Exception Engine。

# 6. Source & Lineage

Lineage 的正式方向：

```text
V2Evidence
  -> SourceDocument
  -> SourceSystem

V2Evidence
  -> BusinessEntity

V2Evidence
  -> FulfillmentEvent

FulfillmentEvent
  -> FulfillmentContext
```

Evidence 同时校验：

- `sourceDocumentId` 必须存在。
- `sourceVersion` 必须等于 Document version。
- `sourceSystemId` 必须等于 Document 的 source system。
- 绑定的 Event 必须属于同一 tenant 和 Context。
- 如果 Event 绑定 Entity，Evidence 绑定的 Entity 必须一致。
- 如果 Event 绑定 SourceDocument，Evidence 的 Document 必须一致。

禁止生成“表面有 citation，实际引用链错位”的 Evidence。

# 7. 时间语义

| 字段 | 含义 |
| --- | --- |
| `effectiveAt` | 业务事实实际生效的时间；可以为空 |
| `occurredAt` | 业务事件真实发生的时间 |
| `recordedAt` | 本系统接收并记录事件的时间 |
| `receivedAt` | 本系统收到来源文档的时间 |
| `observedAt` | Evidence 所描述事实被观察到的时间 |

约束：

- `effectiveAt` 不等于 `receivedAt`。
- `occurredAt` 不等于 `recordedAt`。
- 重复同步可以改变 `receivedAt` / `recordedAt`，但不能改变业务事实时间。
- Replay 必须保留原始时间和记录时间。

# 8. Source Authority

支持的 authority level：

```text
system_of_record
authoritative
contributing
reference
```

当前只作为 SourceSystem 的属性。

它不表示：

- 来源内容一定正确。
- 来源一定胜过其他系统。
- 冲突时自动选择该来源。
- 可以绕过 Evidence 和人工确认。

未来冲突裁决必须结合规则、业务上下文、时间和明确的人工决策。

# 9. Tenant Boundary

所有 V2 对象必须 tenant-scoped：

- Context
- BusinessEntity
- EntityReference
- SourceSystem
- SourceDocument
- FulfillmentEvent
- V2Evidence

规则：

- 跨 Tenant 关系 fail-closed。
- 不自动改写 tenantId。
- 不自动复制对象到另一个 tenant。
- 不通过对象 ID 猜测对象归属。
- API 越权查询返回 `404`，避免泄露资源是否存在。

# 10. Persistence

V1 继续保留：

```text
cases
  tenant_id + case_id + payload JSON + updated_at

capability_receipts
  tenant_id + case_id + action_id + operation_key + ...
```

V2 使用关系型 SQLite 表：

```text
fulfillment_contexts
business_entities
entity_references
source_systems
source_documents
fulfillment_events
v2_evidence
v2_schema_migrations
```

JSON 只用于开放字段：

- metadata
- attributes
- payload
- locator

身份、关系、时间和关键索引是正式列，不能继续塞进 Case JSON blob。

# 11. Strangler Migration

V1 不删除。

V2 在旁路建立。

迁移原则：

1. 新业务事实先进入 V2 Context、Entity、Event 和 Evidence。
2. V1 Case 继续处理异常和人工闭环。
3. 后续通过明确映射将 V1 Case 与 V2 Context 关联。
4. 不在本阶段替换 V1 UI、Case 状态机或存储。
5. 不在本阶段引入 Rule Engine、Exception Engine、AI、ERP/MES/QMS/WMS 真实连接器。
6. 任何迁移必须保持 V1 API、工作台和测试可运行。

阶段 1 的封板边界：

```text
V1：异常处理闭环，继续运行
V2：订单履约事实、lineage、持久化、查询和回放
下一阶段：规则与异常判断
```
