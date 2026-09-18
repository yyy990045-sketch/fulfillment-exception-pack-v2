# Manufacturing Fulfillment Thread（阶段 4 封板）

# 1 场景定位

`SO-MFG-001` 是比赛主场景，用于表达：

```text
CRM
  -> ERP
  -> MES
  -> QMS
  -> WMS
  -> Finance
  -> Service
```

以及：

```text
Quote
  -> SalesOrder
  -> ProductionOrder
  -> QualityInspection
  -> Shipment
  -> Receivable
  -> Payment
  -> Complaint
```

`SO-DEMO-001` 继续作为阶段 1-3 的 regression fixture。

# 2 Manufacturing Facts

SO-MFG-001 包含：

```text
7 SourceSystem
8 BusinessEntity
8 EntityReference
8 SourceDocument
11 FulfillmentEvent
11 V2Evidence
```

事实包括：

- Quote qty = 100
- SalesOrder qty = 100
- Production plannedQty = 100
- Production completedQty = 100
- Quality inspectedQty = 100
- Quality passedQty = 96
- Quality failedQty = 4
- Shipment qty = 96
- Receivable amount = 100000
- Payment amount = 80000
- Complaint claimedReceivedQty = 80

# 3 Production / Quality Lineage

Production Evidence：

```text
plannedQty
  -> PRODUCTION_STARTED

completedQty
  -> PRODUCTION_COMPLETED
```

Quality Evidence：

```text
inspectedQty
  -> QUALITY_INSPECTED

passedQty
  -> QUALITY_PASSED

failedQty
  -> QUALITY_FAILED
```

多个 Quality 事实不能全部挂在同一个 Quality Event 上。

# 4 Rule Factory

Base Fulfillment Rules 通过：

```text
buildBaseFulfillmentRuleDefinitions(tenantId)
buildBaseFulfillmentRuleVersions(tenantId)
```

生成。

SO-DEMO 与 SO-MFG 共用规则配置构造逻辑，不复制四份完整配置。

# 5 Manufacturing Rule Catalog

SO-MFG-001 当前共有 7 条规则：

Base：

1. `FULFILLMENT.SHIPMENT_QUANTITY_SHORTFALL`
2. `FULFILLMENT.PAYMENT_BALANCE_OUTSTANDING`
3. `FULFILLMENT.CUSTOMER_RECEIPT_CLAIM_MISMATCH`
4. `FULFILLMENT.QUOTE_ORDER_QUANTITY_MISMATCH`

Manufacturing：

5. `MANUFACTURING.ORDER_PRODUCTION_COMPLETION_SHORTFALL`
6. `MANUFACTURING.QUALITY_NONCONFORMING_QUANTITY_DETECTED`
7. `MANUFACTURING.QUALITY_SHIPMENT_QUANTITY_MISMATCH`

# 6 Order / Production

Rule：

```text
MANUFACTURING.ORDER_PRODUCTION_COMPLETION_SHORTFALL
```

比较：

```text
SalesOrder.qty
vs
ProductionOrder.completedQty
```

SO-MFG-001：

```text
100 vs 100
```

结果：

```text
NOT_MATCHED
```

# 7 Quality Nonconforming

Rule：

```text
MANUFACTURING.QUALITY_NONCONFORMING_QUANTITY_DETECTED
```

比较：

```text
QualityEvent.inspectedQty
vs
QualityEvent.passedQty
```

SO-MFG-001：

```text
100 vs 96
```

结果：

```text
MATCHED
```

metrics：

```text
difference = 4
nonconformingQty = 4
passRatio = 0.96
```

系统只表达：

```text
质检存在未通过数量。
```

不能推断：

- 生产质量失控
- 严重质量事故
- 质量问题导致少发
- 应当返工
- 责任属于生产部门

# 8 Quality / Shipment

Rule：

```text
MANUFACTURING.QUALITY_SHIPMENT_QUANTITY_MISMATCH
```

比较：

```text
QualityEvent.passedQty
vs
Shipment.qty
```

SO-MFG-001：

```text
96 vs 96
```

结果：

```text
NOT_MATCHED
```

# 9 Final Evaluation Result

显式运行规则后：

```text
Rules = 7
Evaluations = 7
MATCHED = 4
NOT_MATCHED = 3
Exceptions = 4
```

MATCHED：

- SHIPMENT_QUANTITY_SHORTFALL
- PAYMENT_BALANCE_OUTSTANDING
- CUSTOMER_RECEIPT_CLAIM_MISMATCH
- QUALITY_NONCONFORMING_QUANTITY_DETECTED

NOT_MATCHED：

- QUOTE_ORDER_QUANTITY_MISMATCH
- ORDER_PRODUCTION_COMPLETION_SHORTFALL
- QUALITY_SHIPMENT_QUANTITY_MISMATCH

# 10 Quality Evidence Bundle

Quality Exception Bundle：

```text
expected:
  evidence-quality-mfg-inspected
  role = expected
  value = 100
  QMS-DEMO
  QC-MFG-001
  QUALITY_INSPECTED

actual:
  evidence-quality-mfg-passed
  role = actual
  value = 96
  QMS-DEMO
  QC-MFG-001
  QUALITY_PASSED
```

`failedQty = 4` 继续保存在 Context Evidence 中，但不会为了三 selector 强行塞进当前 Bundle。

# 11 No Causal Inference

系统允许分别表达：

```text
Production completed = 100
Quality passed = 96
Shipment = 96
```

但不能生成：

```text
causedBy
rootCause
causalConfidence
AI reasoning
```

系统没有因果证明能力。

# 12 Provisioning

```bash
npm run seed:v2-manufacturing
```

只执行：

- seed SO-MFG-001 facts
- save Manufacturing RuleDefinitions
- save Manufacturing RuleVersions

不自动执行 Rule Engine。

# 13 Persistence Ordering

Exception 排序不依赖 Exception Code。

Persistence Core 使用通用稳定排序：

```text
created_at
id
```

Store 不包含 exception code aware 的排序逻辑。
