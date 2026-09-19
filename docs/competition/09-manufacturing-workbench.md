# 1 Why V2 gets a separate Workbench

The V1 workbench remains available at `/` and continues to use the existing case, conflict, action, and report APIs.

Phase 7A adds a separate V2 entry:

```text
/manufacturing
```

It is a manufacturing fulfillment governance view, not a replacement for the V1 workbench.

# 2 Hero Context SO-MFG-001

The Hero context is:

```text
businessKey = SO-MFG-001
tenantId = demo-manufacturing
contextId = ctx-so-mfg-001
```

The page uses `ctx-so-mfg-001` for API requests and displays `SO-MFG-001` as the business identifier.

# 3 Digital Thread

The workbench displays eight stages in fixed business order:

```text
quote
sales_order
production_order
quality_event
shipment
receivable
payment
complaint
```

Values are read from the V2 Domain projection. The front end does not contain hardcoded business quantities.

The connection between stages means process order only. It does not imply that one stage caused another.

# 4 Rule Overlay

The workbench exposes all deterministic RuleEvaluation results:

```text
7 evaluations
4 matched
3 not matched
```

Matched and not-matched rules are both shown on the relevant stages. The UI therefore does not imply that every observed difference is an exception.

# 5 Exception Rail

The same RuleEvaluation projection provides four current Exceptions:

- SHIPMENT_QUANTITY_SHORTFALL
- PAYMENT_BALANCE_OUTSTANDING
- CUSTOMER_RECEIPT_CLAIM_MISMATCH
- QUALITY_NONCONFORMING_QUANTITY_DETECTED

The default selection is `CUSTOMER_RECEIPT_CLAIM_MISMATCH`.

# 6 Evidence-first Detail

The selected Exception uses the existing Evidence Bundle API. Evidence is displayed with:

- role
- value
- source system
- source document and version
- event
- field
- quote
- observedAt
- support

The customer claim remains labeled as a claim. It is not converted into verified actual receipt.

# 7 Grounded AI Read-only

The AI Explanation tab performs only:

```text
GET /api/v2/contexts/{contextId}/exceptions/{exceptionId}/explanations
```

If no Explanation exists, the page displays an empty state. It does not generate one.

`deterministic-demo` is labeled as a demonstration explainer. `openai` is labeled as OpenAI only when that provider is actually configured. No provider is represented as live-verified.

# 8 Resolution Read-only

The Resolution tab performs only:

```text
GET /api/v2/contexts/{contextId}/resolution-cases
GET /api/v2/resolution-cases/{caseId}
```

It displays the current case, source change state, review, actions, and receipts. It does not review, propose, approve, execute, or close a case.

# 9 No Causal Inference

The Digital Thread connector represents the fulfillment sequence only.

The UI does not state:

- quality failures caused a shipment shortfall
- the warehouse short-shipped the order
- the customer actually received 80 units

The customer value is described as a customer claim.

# 10 Demo Preparation

Prepare the manufacturing hero explicitly:

```bash
npm run demo:manufacturing:prepare
```

This command performs the two explicit demo steps:

```text
provisionV2ManufacturingDemoData()
evaluateContextRules()
```

It is demo orchestration. The pure-query Workbench GET never calls either function.

# 11 V1 Compatibility

The original `/` page and `/api/cases` behavior remain in place.

The V2 workbench does not reuse or rewrite the V1 workbench HTML.

# 12 Truthfulness Boundary

```text
MANUFACTURING_WORKBENCH_IMPLEMENTED = true
V2_DATA_FROM_DOMAIN = true
RULES_DETERMINISTIC = true
AI_EXPLANATION_READ_ONLY = true
RESOLUTION_READ_ONLY = true
REAL_OPEN_SUPOS_RUNTIME_VERIFIED = false
REAL_OPENAI_API_VERIFIED = false
```

The workbench is a deterministic V2 projection over the current demonstration data. It does not claim a verified external Open supOS runtime, a live OpenAI call, Root Cause analysis, or automatic Resolution action.
