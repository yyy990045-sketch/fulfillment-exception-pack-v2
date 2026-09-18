# V2 Rule / Exception Engine（阶段 2 封板）

## 1. 定位

V2 Rule / Exception Engine 用于把可回源的 Fulfillment Evidence 转换为：

```text
FactObservation
  -> RuleEvaluation
  -> Exception
  -> ExceptionEvidenceBundle
```

它只做确定性规则判断：

- 不依赖 LLM。
- 不进行自然语言猜测。
- 不自动创建 V1 Case。
- 不自动执行企业动作。
- 不依据 Source Authority 自动裁决冲突。

## 2. RuleDefinition

`RuleDefinition` 是规则稳定身份，包含：

```text
id
tenantId
code
name
description
exceptionType
enabled
createdAt
metadata
```

Demo 规则使用 `FULFILLMENT.*` code。

## 3. Immutable RuleVersion

`RuleVersion` 包含：

```text
id
tenantId
ruleId
version
status
config
contentHash
createdAt
```

status：

```text
draft
active
retired
```

约束：

- 同 `tenantId + ruleId + version` 不允许出现不同配置。
- 相同版本完全一致重复 provisioning 视为幂等。
- 配置变化必须创建新版本。
- 已有 RuleVersion 内容不可原地更新。

## 4. FactSelector

规则事实只从 V2Evidence 读取。

不使用 `BusinessEntity.attributes` 作为确定性判断输入。

selector：

```text
key
entityType
field
valueType
aggregation
```

aggregation：

```text
single_latest
sum_latest_per_entity
```

- `single_latest`：最多允许一个 Entity；同一 Entity 取最新 Evidence。
- `sum_latest_per_entity`：每个 Entity 先取最新 Evidence，再求和。

## 5. FactObservation

Observation 不只保存数字：

```text
selectorKey
status
value
entityIds
evidenceIds
sourceSystemIds
observedAt
candidateEvidenceIds
```

状态：

```text
resolved
missing
ambiguous
invalid
```

Evidence 语义：

- 无 Evidence，或只有 partial/unsupported：`missing`
- supported 但类型或数值无效：`invalid`
- 多个有效事实无法唯一选择：`ambiguous`
- 唯一有效事实：`resolved`

`candidateEvidenceIds` 保留“存在材料但不足作为确定事实”的解释线索。

## 6. RuleEvaluation

`RuleEvaluation` 包含：

```text
id
tenantId
contextId
ruleId
ruleVersionId
status
observations
metrics
inputHash
matchKey
evaluatedAt
metadata
```

状态：

```text
matched
not_matched
insufficient_evidence
ambiguous_evidence
invalid
```

## 7. inputHash 与 stable matchKey

`inputHash`：

- 表示一次具体事实快照。
- 与 Evidence 内容、Observation 和 RuleVersion config 有关。

`matchKey`：

- 表示同一个业务异常身份。
- 不依赖 inputHash。
- 不依赖 evaluatedAt。
- 不依赖 Evidence version。
- 由 rule code + contextId + 排序后的 entityIds 生成。

因此 Evidence 从一个版本更新到新版本时：

```text
RuleEvaluation：可以有多个版本
Exception：仍保持同一个稳定 ID
```

## 8. Exception stable identity

Exception 包含：

```text
id
tenantId
contextId
latestRuleEvaluationId
exceptionType
status
severity
matchKey
title
summary
metrics
createdAt
lastDetectedAt
```

新 Evaluation 再次 MATCHED：

- 更新 `latestRuleEvaluationId`
- 更新 `lastDetectedAt`
- 更新 metrics 和 summary
- 不改变 Exception ID
- 不改变 createdAt

## 9. Severity / Metrics / Presentation

severity 来自 RuleVersion config：

```text
low
medium
high
critical
```

metrics 由 config 驱动，当前支持：

```text
absolute_difference
positive_difference
difference_ratio
ratio
```

title / summary 由 RuleVersion presentation config 确定性生成。

不使用 LLM。

## 10. Evidence Role

RuleVersion config 决定 Evidence role：

```text
expected
actual
claim
context
```

例如：

- Shipment Shortfall：订单 Evidence = expected，发货 Evidence = actual
- Payment Outstanding：应收 Evidence = expected，回款 Evidence = actual
- Customer Claim：发货 Evidence = actual，客诉 Evidence = claim

role 不由 API 或 UI 猜测。

## 11. Current Demo Rules

当前有 4 条规则：

1. `FULFILLMENT.SHIPMENT_QUANTITY_SHORTFALL`
2. `FULFILLMENT.PAYMENT_BALANCE_OUTSTANDING`
3. `FULFILLMENT.CUSTOMER_RECEIPT_CLAIM_MISMATCH`
4. `FULFILLMENT.QUOTE_ORDER_QUANTITY_MISMATCH`

SO-DEMO-001 执行结果：

```text
Rules = 4
MATCHED = 3
NOT_MATCHED = 1
Exceptions = 3
```

Quote 100 与 Order 100 不产生 Exception。

## 12. Runtime Boundary

规则运行必须通过 Application Service：

```text
evaluateContextRules(tenantId, contextId)
```

运行流程：

```text
load Context
  -> load enabled RuleDefinitions
  -> load active RuleVersions
  -> replay Context
  -> evaluate rules
  -> persist RuleEvaluation
  -> upsert stable Exception
  -> persist ExceptionEvidence roles
```

运行 API：

```text
POST /api/v2/contexts/:contextId/evaluations/run
```

GET API 始终是纯查询：

```text
GET /rule-evaluations
GET /exceptions
GET /exceptions/:exceptionId/bundle
```

## 13. Exception 与 Resolution Case

本阶段只生成 Exception。

Exception 不自动成为 Resolution Case。

后续企业处置必须经过真人明确接受：

```text
Exception
  -> human accept
  -> Resolution Case
```

Rule Engine 不创建 Case、不审批、不执行动作。
