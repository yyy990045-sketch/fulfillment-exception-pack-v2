# 1 Operational Intelligence as Platform Capability

Operational Intelligence is a cross-context read projection over the V2 Domain. It is not named after Manufacturing and does not write a second business model.

The same layer can later project:

- manufacturing fulfillment
- procurement
- finance reconciliation
- contract fulfillment
- customer service
- project delivery
- IT operations

# 2 Why Analytics is Derived from Domain Facts

Analytics reads:

- FulfillmentContext
- BusinessEntity
- FulfillmentEvent
- Evidence
- RuleEvaluation
- Exception
- ResolutionCase
- ResolutionAction
- ResolutionReceipt

It does not create an Exception, Outcome, Root Cause, Risk Score, Financial Impact, or Resolution state.

# 3 Cross-context Model

`/api/v2/analytics/operational` aggregates all contexts visible to the authenticated tenant.

The API has no contextId parameter. Tenant isolation is therefore structural: a request can only aggregate the tenant from Auth.

The V2 store adds `listContexts(tenantId)` as the required tenant-level read API. Analytics does not access SQLite directly.

# 4 Metric Contracts

The response contains `metricDefinitions`; rate definitions are part of the product contract rather than UI copy.

Key definitions:

```text
governanceCoverageRate =
  Exceptions with at least one Resolution Case / detected Exceptions

resolutionClosureRate =
  Closed Resolution Cases / all Resolution Cases

ruleTriggerRate =
  Matched evaluations / all evaluations

exceptionOccurrenceAt =
  Latest observedAt in the current Exception Evidence Bundle,
  fallback Exception.createdAt
```

Zero denominator returns `null`, not zero or NaN.

# 5 Governance Coverage

Governance coverage measures how many detected Exceptions have entered the human governance process.

It is not:

- a success rate
- a resolution rate
- a measure of business outcome

# 6 Resolution Closure Rate

The UI label is:

```text
处置结案率
```

It is not:

```text
异常事实消除率
```

A closed Resolution Case does not remove the source Exception. The source Exception remains `detected`.

# 7 Rule Trigger Rate vs Accuracy

The workbench and documentation may show:

```text
规则触发率
```

They do not claim:

- accuracy
- precision
- recall
- false-positive rate

There are no human ground-truth labels in the current model.

# 8 Exception Trend

Exception trend groups by `exceptionOccurrenceAt`:

```text
latest current Evidence observedAt
```

It does not use `RuleEvaluation.evaluatedAt`, because rules may be backfilled later.

Supported buckets:

```text
day
week
month
```

# 9 Resolution Funnel

The funnel preserves Domain states:

```text
no_case
triaged
confirmed
proposed_draft
pending_approval
approved
executed
closed
rejected
```

`proposed_draft` and `pending_approval` are distinguished using ResolutionAction status, not only the outer Case status.

# 10 Action Analytics

Actions remain structured and are aggregated by:

- ActionType
- total
- draft
- pending approval
- authorized
- succeeded
- verified
- failed

This projection is prepared for a future Policy Engine but does not implement one.

# 11 Source System Involvement

Source-system involvement is calculated from each Exception Evidence Bundle.

One Exception can involve multiple systems. Counts can therefore overlap, and the UI explicitly states:

```text
一起涉及多个系统的异常会在多个来源中重复计数。
```

# 12 Synthetic Demo Portfolio

The portfolio is deterministic and synthetic:

- 10 additional contexts
- `SO-OPS-001` through `SO-OPS-010`
- fixed openedAt dates
- fixed quantities and amounts
- no Math.random

Each context is provisioned through Domain facts and evaluated through the existing Rule Engine.

Resolution states are established through the existing Resolution Domain APIs:

- no case
- triaged
- confirmed
- proposed draft
- pending approval
- approved
- executed
- closed
- rejected

Prepare the portfolio with:

```bash
npm run demo:operations:prepare
```

Run the operations server with:

```bash
npm run demo:operations
```

The portfolio is explicitly synthetic. It is not real customer history.

# 13 No Financial Impact Yet

Exception metrics may contain values such as `outstandingAmount`, but the current system has:

- no normalized currency model
- no impact semantics
- no double-count prevention

Operational Analytics therefore does not aggregate a financial amount impact or investment return.

# 14 No Outcome Claim Yet

Close proves that the governance process reached a verified close state. It does not prove that the business issue was solved.

```text
closed Resolution != successful business outcome
```

Outcome Intelligence remains a later phase.

# 15 Future Decision Intelligence

The structured history is designed for later phases:

- similar case retrieval
- action outcome analysis
- decision options
- policy automation

Those capabilities are not implemented in Phase 7C.

# 16 Scale Boundary

Current analytics is a query-time projection suitable for demos, MVPs, and small or medium tenants.

It does not introduce:

- materialized analytics tables
- ClickHouse
- DuckDB
- Kafka
- Spark
- a warehouse

Large-scale aggregation will be a separate capacity decision when real data volume requires it.

# 17 Truthfulness Boundary

```text
OPERATIONAL_ANALYTICS_IMPLEMENTED = true
CROSS_CONTEXT_ANALYTICS = true
METRICS_DERIVED_FROM_DOMAIN = true
SYNTHETIC_PORTFOLIO = true
RULE_TRIGGER_RATE_AVAILABLE = true
RULE_ACCURACY_MEASURED = false
FINANCIAL_IMPACT_MEASURED = false
REAL_BUSINESS_OUTCOME_MEASURED = false
AI_DECISION_RECOMMENDATION = false
POLICY_AUTOMATION = false
```

This is an operational intelligence projection, not an AI decision system.
