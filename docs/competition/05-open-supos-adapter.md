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
