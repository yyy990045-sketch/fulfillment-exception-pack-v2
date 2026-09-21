# Industrial Mapping Manifest

> 环境声明：**SIMULATED INDUSTRIAL ENVIRONMENT**。Manifest 的每一项都是为
> 未来真实 MES / ERP / QMS / WMS / Finance 接入而设计的声明，仿真只是第一份实现。

定义处：`src/industrial/mapping-manifest.ts`
运行时标识：`industrial-mapping@1.0.0`，内容指纹 `contentHash`（sha256）。

---

## 1 为什么需要它

真实系统之间的字段名互不相同：

```text
MES  completed_qty        QMS  passed_qty        WMS  shipped_qty
ERP  order_qty            FIN  ar_amount         SRV  claimed_received_qty
```

如果这段「翻译」藏在代码的 `if` 里：

- 一线业务无法复核「这个异常用的是哪个系统的哪个字段」；
- 甲方 IT 无法参与评审，接入新系统时只能读源码；
- 同一个字段的口径（是 `number` 还是 `currency`）由 `typeof` 顺手决定，会**静默选不到证据**。

Manifest 把翻译**显式声明**出来，于是这条链路可评审、可版本化、可 diff。

---

## 2 条目形状

```yaml
sourceSystem: MES
sourceField: completed_qty
semantic:
  entityType: ProductionOrder            # 语义对象（PascalCase）
  entityTypeCanonical: production_order  # 本 pack 领域模型的实体类型
  field: completedQuantity               # 语义字段名
  dataType: number
  unit: pcs
target:
  unsPath: enterprise/{enterpriseId}/site/{siteId}/area/{areaId}/line/{lineId}/production/{entityId}/production.completed
  domain: production
  canonicalField: completedQty           # CanonicalIndustrialEvent.payload 与 Evidence 里的字段名
provenance:
  mappingVersion: industrial-mapping/v1.0.0
  owner: company-ai-platform / industrial-semantic-layer
  description: MES 工单完工数量 → 生产订单 completedQty（订单履约比对的实际量）
```

三段各司其职：

- **source**：来源系统的原始字段名（snake_case），只有系统自己认得的名字。
- **semantic**：统一工业语义（PascalCase 对象 + camelCase 字段 + 数据类型 + 单位）。
- **target**：落到本平台的哪条 UNS 路径、哪个规范字段。

`dataType` **决定 Evidence 的 `valueType`**。例如 `ar_amount` 的 `dataType: currency`
让应收金额以 `valueType: "currency"` 落库；规则 `FULFILLMENT.PAYMENT_BALANCE_OUTSTANDING`
选的正是 `currency`。如果由 `typeof 100000 === "number"` 决定，这条规则会变成
`status: "invalid"` 而静默不命中 —— 这正是「口径必须由声明决定」的实际代价。

---

## 3 覆盖范围

`REQUIRED_MAPPING_TARGETS` 声明了必须覆盖的最小业务对象（任务书 §5 的要求）：

| 业务对象 | 规范字段 | 来源系统 |
| --- | --- | --- |
| Order | `sales_order.qty`、`quote.qty` | ERP、CRM |
| Production | `production_order.plannedQty`、`production_order.completedQty` | MES |
| Quality | `quality_event.inspectedQty`、`passedQty`、`failedQty` | QMS |
| Shipment | `shipment.qty`（另有 `plannedQty`、`signedQty`） | WMS |
| Payment | `receivable.amount`、`payment.amount`（另有 `invoice.amount`） | Finance |

`mappingCoverageReport()` 会算出覆盖率；`assertMappingCoverage()` 在缺失时抛
`MAPPING_COVERAGE_INCOMPLETE`。`npm run simulator:verify` 把这条检查作为独立闸门项
（当前 `covered=9/9`）。

---

## 4 双向翻译（两份方向都被真实使用）

### 4.1 正向：原始字段 → 规范事实

`mapSourceFields()` 由 **Factory Simulator** 使用：它拿到的是模拟 MES/ERP/QMS 的原始字段，
经 Manifest 翻译后才组装 UNS 信封。因此「信封里只有规范字段」是被强制的。

### 4.2 反向：规范事实 → (来源字段, 语义字段)

`resolveCanonicalFieldMapping()` 由 **Canonical Industrial Event** 使用：
UNS 信封承载的是规范字段（这是连接器契约），Manifest 负责把它翻译回
「哪个系统的哪个原始字段、语义上叫什么」，结果写进事件的 `provenance.fieldMapping`。

反向查表必须带 **topic 事件名**，因为同一个规范字段可能来自不同时点：

```text
production.progressed  report_qty     → completedQty（报工累计）
production.completed   completed_qty  → completedQty（工单完工）
```

缺了事件名，「这条证据到底来自报工还是完工」就说不清。

### 4.3 fail-closed 清单

以下情况一律抛 `IndustrialSemanticError`，绝不静默跳过：

| 错误码 | 触发条件 |
| --- | --- |
| `UNMAPPED_SOURCE_FIELD` | 原始字段未声明 |
| `UNMAPPED_CANONICAL_FIELD` | 信封里的规范字段未声明 |
| `MAPPING_ENTITY_TYPE_MISMATCH` | 声明指向的实体类型与事件不符 |
| `MAPPING_EVENT_PATH_MISMATCH` | 声明指向的 UNS 路径与事件不符 |
| `MAPPING_SOURCE_SYSTEM_MISMATCH` | 实际来源系统与声明的不一致（WMS 事件不能声称用了 MES 字段） |
| `MAPPING_VALUE_TYPE_MISMATCH` | 数值/金额字段拿到了非数值 |
| `MAPPING_CANONICAL_FIELD_COLLISION` | 同一事件里两个原始字段映射到同一规范字段 |

**宁可直接报错，也不让「没人复核过的字段」悄悄进入证据链。**

---

## 5 Mapping 版本与可复核性

- 连接器注册的 mapping 版本：`store.saveConnectorMappingVersion({ mappingId: "industrial-mapping", version: "1.0.0", definitionHash: <contentHash> })`。
- 每条摄取账本记录都带 `mappingId` / `mappingVersion`，因此**任何一个历史结论都能回答它用的是哪一版翻译**。
- Context Summary 暴露 `mappingVersions[]`（由证据 → 账本反查），示例：`["industrial-mapping@1.0.0"]`。
- 改一条 entry，`contentHash` 必然变化 —— 可以用来判定缓存/投影是否需要失效。

---

## 6 本轮没有做什么

- **没有做 UI 编辑器**。Manifest 是声明式的代码常量，靠 review 与 diff 治理。
- **没有做单位换算**。`unit` 只作为语义声明随证据透传，不做隐式转换（隐式换算会制造第二种真相）。
- **没有做字段自动发现**。未声明的字段就是错误，不猜。

## 7 相关文档

- `docs/industrial/industrial-context-model.md` — 五个概念的边界
- `docs/industrial/uns-topic-convention.md` — `unsPath` 里的 topic 式子
- `docs/industrial/factory-simulator.md` — 谁按这份 Manifest 发数据
