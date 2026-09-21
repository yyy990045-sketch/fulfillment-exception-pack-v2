# UNS Topic Convention

> 环境声明：**SIMULATED INDUSTRIAL ENVIRONMENT**。Topic 式子本身是长期契约，
> 与「这家工厂是仿真还是真实」无关 —— 这正是它必须一次定义清楚的原因。

集中定义处（唯一一处，业务逻辑禁止字面量拼 topic）：`src/industrial/uns-topic.ts`

---

## 1 式子

```text
enterprise/{enterpriseId}/site/{siteId}/area/{areaId}/line/{lineId}/{domain}/{entityId}/{eventType}
```

共 **11 段**。示例：

```text
enterprise/demo-manufacturing/site/factory-shanghai-01/area/assembly-workshop/line/line-a/production/MO-IND-002/production.completed
```

| 段 | 含义 | 取值来源 |
| --- | --- | --- |
| `enterprise` | 固定字面量 | 式子 |
| `{enterpriseId}` | 企业 | ISA-95 层级 |
| `site` / `{siteId}` | 工厂 | ISA-95 层级 |
| `area` / `{areaId}` | 车间 | ISA-95 层级 |
| `line` / `{lineId}` | 产线 | ISA-95 层级 |
| `{domain}` | 业务域 | `sales` / `production` / `quality` / `shipment` / `finance` / `service` |
| `{entityId}` | **该域业务对象的业务主键** | `SO-IND-002` / `MO-IND-002` / `QC-IND-002` / `SH-IND-002` / `AR-IND-002` / `PAY-IND-002` / `CP-IND-002` |
| `{eventType}` | 点分小写事件名 | `order.created` / `production.completed` / `quality.passed` / … |

### 与任务书示例的一处刻意细化

任务书示例写作 `production/SO-IND-001/production.completed`。本实现里 production 域的对象是
**工单** `MO-IND-00N`，所以产出的是 `production/MO-IND-002/production.completed`。

原因：`{entityId}` 段的语义是「**该域业务对象的业务主键**」。把销售订单号写进 production 域，
会让「这条 topic 说的是哪个对象」出现两种读法。销售订单与工单之间的对应关系属于
**Business Context 的 lineage**（同一 `context.businessKey`），不属于 Topic。
这条规则写在 `UNS_TOPIC_CONVENTION.entityIdSemantics` 里，可被代码读取。

---

## 2 三条设计纪律

### 2.1 Topic 描述工业空间，不描述业务履约链

`SO-IND-002` 是 Business Context 的 key，出现在 UNS 信封的 `context.businessKey`，
**不出现在 topic 里**。同一条 `line-a` 上可以并存任意多条 Context。

### 2.2 Topic 描述业务域，不描述系统名

ERP / MES / QMS / WMS / Finance 都往同一个域里发。系统身份留在两处：

- 信封的 `source.systemKey` / `source.systemType`（`MES-DEMO` / `mes`）
- 摄取账本 locator 的 `namespace` / `topic`

这样「换掉一个 MES 厂商」不会改变对外 topic 契约。

### 2.3 Topic 里没有租户段

租户隔离由信封 `tenantKey` + 连接器安装 + 来源账本保证；`enterprise` 已经是本方案的顶层命名空间。
（legacy 式子里的第一个业务段是 `tenantKey`，见第 4 节。）

---

## 3 事件名双向映射

领域事件类型是 Core 的方言（`PRODUCTION_COMPLETED`），topic 段是工业界更常见的点分小写
（`production.completed`）。二者由**同一张表**双向查，不各写一份：

`INDUSTRIAL_EVENT_TOPIC_BINDINGS`（`src/industrial/uns-topic.ts`）覆盖仿真与既有契约的全部事件：

| 领域事件 | domain | topic 事件名 |
| --- | --- | --- |
| `QUOTE_CREATED` / `QUOTE_CHANGED` | sales | `quote.created` / `quote.changed` |
| `ORDER_CREATED` / `ORDER_CHANGED` | sales | `order.created` / `order.changed` |
| `PRODUCTION_STARTED` / `PRODUCTION_PROGRESSED` / `PRODUCTION_COMPLETED` | production | `production.started` / `production.progressed` / `production.completed` |
| `QUALITY_INSPECTED` / `QUALITY_PASSED` / `QUALITY_FAILED` | quality | `quality.inspected` / `quality.passed` / `quality.failed` |
| `SHIPMENT_CREATED` / `SHIPMENT_DISPATCHED` / `SHIPMENT_SIGNED` | shipment | `shipment.created` / `shipment.dispatched` / `shipment.received` |
| `INVOICE_CREATED` / `RECEIVABLE_CREATED` / `PAYMENT_RECEIVED` | finance | `invoice.created` / `receivable.created` / `payment.received` |
| `COMPLAINT_OPENED` / `COMPLAINT_UPDATED` | service | `complaint.created` / `complaint.updated` |

未登记的事件类型按**实体所属域**回退（`canonicalEventTypeForTopicEvent` 的反向查表同理）；
连实体域都不认识的，直接抛 `UNSUPPORTED_INDUSTRIAL_EVENT_TYPE`，不静默造一个 domain。

段值一律 `encodeURIComponent` 转义。业务主键里出现 `/`、空格、`#` 不会污染 topic 结构
（`parseIndustrialUnsTopic` 能原样还原）。

---

## 4 与 legacy 式子并存

本 pack 早期（阶段 5A）的 6 段写法仍然有效，既有 fixture、既有 A/B 契约与既有测试继续使用它：

```text
fulfillment/{tenantKey}/{contextBusinessKey}/{entityType}/{entityBusinessKey}/{eventType}
```

选择规则是**数据驱动**的，不是开关：

- 信封 `metadata.unsSpace` 解析出合法工业空间 → 走 **industrial 11 段**式子；
- 否则 → 走 **legacy 6 段**式子。

`parseUnsTopic()` 返回带 `form` 判别字段的联合类型：

- `form: "legacy"` → 带 `tenantKey` / `contextBusinessKey`（topic 声明了业务上下文）
- `form: "industrial"` → `tenantKey` / `contextBusinessKey` 为 `null`（刻意不带）
- industrial 分支额外提供 `domain` 与 `space`

因此消费方永远能问「这个 topic 声明了业务上下文吗」，而不是靠 try/catch 猜式子。
`OpenSupOSAdapter.ingest()` 对两种式子做不同的**一致性校验**：
legacy 校验 tenant/context/entity/event 全部一致；industrial 只校验实体与事件
（tenant 与 context 不在 topic 里，二者分离是刻意的）。

连接器配置白名单 `UNS_TOPIC_PREFIXES = ["fulfillment", "enterprise"]`；
默认值仍是 `fulfillment`，不改变既有行为。

---

## 5 订阅模式

仿真与真实 broker 使用同一个 11 段订阅模式（`SIMULATOR_UNS_SUBSCRIBE_PATTERN`）：

```text
enterprise/+/site/+/area/+/line/+/+/+/+
```

`+` 逐段通配，段数严格相等 —— 这保证了「topic 结构被改坏」会在订阅侧立刻暴露，
而不是安静地读到错误的数据。

## 6 相关文档

- `docs/industrial/industrial-context-model.md` — 五个概念的边界
- `docs/industrial/mapping-manifest.md` — 字段翻译与 `unsPath`
- `docs/industrial/factory-simulator.md` — 谁在发这些 topic
