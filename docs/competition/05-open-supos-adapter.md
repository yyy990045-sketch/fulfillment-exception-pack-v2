# Open supOS Adapter Boundary + UNS Contract（阶段 5A）

# 1 Boundary

```text
ERP / MES / QMS / WMS / Finance
  -> Open supOS Source Flow
  -> Open supOS UNS
  -> OpenSupOS Adapter
  -> Canonical Fulfillment Envelope
  -> Fulfillment Domain Kernel
```

Open supOS 是 Integration Adapter，不是 Domain Kernel、Rule Engine 或 Resolution Engine。

# 2 Repository Direction

依赖方向：

```text
integration -> domain
```

Domain 不导入 MQTT、Open supOS、Node-RED 或 UNS transport。

# 3 Canonical UNS Envelope

稳定契约：

```text
OpenSupOSUnsEnvelope
```

包含：

- schemaVersion
- messageId
- tenantKey
- context
- source
- entity
- event
- facts
- lineage
- metadata

Envelope 不携带 Rule Result。

# 4 Schema Version

当前只接受：

```text
1.0
```

未知版本 fail closed：

```text
DOMAIN_UNS_SCHEMA_VERSION_UNSUPPORTED
```

# 5 Topic Contract

```text
fulfillment/{tenant}/{contextBusinessKey}/{entityType}/{entityBusinessKey}/{eventType}
```

示例：

```text
fulfillment/demo-manufacturing/SO-MFG-001/production_order/MO-MFG-001/PRODUCTION_COMPLETED
```

Topic 只使用稳定业务键，不包含内部 UUID。

# 6 Topic Safety

所有 segment 必须经过：

```text
encodeTopicSegment()
decodeTopicSegment()
```

处理 `/`、`+`、`#`、空格和空 segment。

非法 Topic fail closed。

# 7 Domain Mapping

```text
mapUnsEnvelopeToDomainPlan()
```

返回 `DomainWritePlan`，不直接写数据库。

Plan 包含：

```text
context
sourceSystem
businessEntity
entityReference
sourceDocument
event
evidence[]
```

# 8 Deterministic Identity

Adapter 不使用 random UUID。

内部 ID 由稳定业务身份 SHA-256 生成：

```text
tenant
context business key
source system
entity type/business key
document/version
event identity
```

同一消息重复消费得到相同 Domain Identity。

# 9 Idempotency

Event idempotencyKey：

```text
uns:{messageId}
```

重复消息不产生第二份：

- Event
- Document
- Evidence

复用现有 Domain idempotency 约束。

# 10 Multiple Evidence

一个 Envelope 的每个 fact 生成一条 V2Evidence。

Evidence 共享：

- Event
- Document
- Entity
- SourceSystem
- Context

# 11 Typed Facts

支持：

```text
string
number
boolean
date
datetime
currency
json
null
```

优先使用显式：

```json
{
  "completedQty": {
    "value": 100,
    "valueType": "number"
  }
}
```

不做 LLM 类型推断。

# 12 Domain Apply

```text
applyDomainWritePlan()
```

顺序：

```text
saveContext
saveSourceSystem
saveBusinessEntity
saveEntityReference
saveSourceDocument
appendEvent
saveEvidence
```

全部在一个 SQLite transaction 内。

失败时整条 integration chain 回滚。

# 13 Transport

抽象：

```text
UnsTransport
  connect
  disconnect
  subscribe
  publish
```

实现：

- `InMemoryUnsTransport`：CI / test
- `OpenSupOSMqttTransport`：真实 MQTT

MQTT 配置来自环境变量：

```text
OPEN_SUPOS_MQTT_URL
OPEN_SUPOS_MQTT_USERNAME
OPEN_SUPOS_MQTT_PASSWORD
OPEN_SUPOS_MQTT_CLIENT_ID
```

代码中不硬编码凭据，测试不连接真实 broker。

# 14 Adapter

```text
OpenSupOSAdapter.ingest(topic, payload)
```

返回：

```text
messageId
contextId
entityId
eventId
evidenceIds
duplicated
```

Adapter 不执行 Rule Engine，也不创建 Resolution Case。

# 15 Runtime Gate

`startOpenSupOSInbound()` 仍然是纯 transport primitive。

真实 runtime 使用：

```text
startConfiguredOpenSupOSInbound()
```

默认：

```text
OPEN_SUPOS_ENABLED != true
```

时返回：

```text
{ status: "disabled" }
```

不连接 MQTT、不 subscribe、不产生副作用。

只有显式：

```text
OPEN_SUPOS_ENABLED=true
```

才创建并连接 MQTT transport。

`npm run demo`、`npm test` 和 `server.ts` 都不会默认启动 MQTT。

可选命令：

```bash
npm run open-supos:inbound
```

同样受环境开关保护。

# 16 Outbound Exception Contract

```text
mapExceptionToUnsMessage()
```

Topic：

```text
fulfillment/{tenant}/{contextBusinessKey}/exceptions/{exceptionCode}/{exceptionId}
```

Payload 只包含：

- schemaVersion
- messageType = exception
- exception identity/status/severity
- title / summary / metrics
- latest RuleEvaluation
- detectedAt / lastDetectedAt

不包含：

- chain-of-thought
- internal reasoning
- Resolution actions
- 完整 Evidence Bundle

当前阶段不自动 publish。

# 17 Outbound Resolution Contract

```text
mapResolutionCaseToUnsMessage()
```

Topic：

```text
fulfillment/{tenant}/{contextBusinessKey}/resolution/{caseId}
```

Payload 是状态型合同，只包含：

- case / exception identity
- context identity
- status
- ownerRole
- updatedAt
- sourceChanged

不包含完整 Evidence Bundle、完整 runtime events、Receipts 或 Actions。

当前阶段不自动 publish。

# 18 Inbound / Outbound Topic Separation

Inbound：

```text
fulfillment/{tenant}/{context}/{entityType}/{entityBusinessKey}/{eventType}
```

Outbound：

```text
fulfillment/{tenant}/{context}/exceptions/{code}/{exceptionId}
fulfillment/{tenant}/{context}/resolution/{caseId}
```

Outbound 使用独立 helper，不复用或模糊化 `parseUnsTopic()`。

# 19 SO-MFG-001 Round-trip

`SO_MFG_001_UNS_MANIFEST` 和 `buildSoMfg001UnsMessages()` 提供 11 条消息级 UNS 输入。

从空数据库只使用这 11 条消息：

```text
Context = 1
SourceSystems = 7
Entities = 8
EntityReferences = 8
SourceDocuments = 8
Events = 11
Evidence = 11
```

Production：

```text
PRODUCTION_STARTED
PRODUCTION_COMPLETED
```

共享 `MO-MFG-001` v1 Document。

Quality：

```text
QUALITY_INSPECTED
QUALITY_PASSED
QUALITY_FAILED
```

共享 `QC-MFG-001` v1 Document。

11 条消息只产生 8 份 Document。

# 20 Idempotency / Version Update

同批消息重复 ingest：

- 不新增 SourceSystem、Entity、Reference、Document、Event、Evidence
- Event 层返回 duplicated

同一 messageId 但 payload facts 不同：

- fail closed
- 不静默覆盖 Evidence

合法 sourceVersion 更新：

- 新 Document 版本
- 新 Event
- 新 Evidence
- 旧版本保留

# 21 Deferred to 5B

本阶段未执行：

- 自动发布 Exception / Resolution outbound message
- 真实 Open supOS runtime 连接
- Dashboard
- Node-RED
- 私有 supOS REST API

真实 MQTT 连接和 outbound publish 留到阶段 5B。
