# 1 Problem

Enterprise AI should not route every judgment through a generative model.

Some decisions are deterministic business rules. Some need a small typed decision model with probability output. Some remain open-ended language or evidence-synthesis work that may need a generative LLM. Treating all three as one "AI" category hides latency, cost, error, and governance differences.

# 2 Runtime Architecture

```text
State
  -> Typed Questions
  -> Explicit Provider
  -> Normalized Decisions
  -> Application Code
  -> Policy
```

The runtime emits decision signals only. It cannot approve, execute, create a Resolution Case, create a Work Item, enqueue a Connector, close an Exception, or create an Outcome.

# 3 Deterministic

`deterministic-decision-v1` resolves explicitly registered task IDs.

It is the benchmark baseline and is implemented from the same synthetic product rubric as the reference labels. A perfect score demonstrates rubric consistency, not general intelligence.

# 4 OpenAI

The OpenAI provider uses the Responses API with strict dynamic JSON Schema, `store:false`, `tools:[]`, and `maxRetries:0`.

`DECISION_RUNTIME_OPENAI_MODEL` is mandatory. No model name is guessed in source.

OpenAI probabilities and confidence are model-reported. They are labeled `self_reported` and are not treated as calibrated confidence.

# 5 Jev

The Jev provider uses the current TypeSafe System One endpoint:

```text
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <TYPESAFE_API_KEY>
Content-Type: application/json
```

TypeSafe officially positions Jev as a System One Model for typed decisions and calibrated probabilities. This project records that as the provider's official positioning, not as independently verified reliability.

No key means `not_configured`. A 401, 403, or disabled account means `access_blocked`. The benchmark never fabricates a live Jev result.

# 6 Noul / Choice / Score Mapping

```text
Runtime boolean -> Jev noul
Runtime choice  -> Jev choice
Runtime score   -> Jev score
```

Jev wire format uses object maps keyed by question ID:

```json
{
  "questions": {
    "department": {
      "type": "choice",
      "instructions": "Choose the department.",
      "criteria": {
        "billing": "Billing",
        "technical": "Technical"
      }
    }
  }
}
```

The response uses the same shape:

```json
{
  "answers": {
    "department": {
      "type": "choice",
      "choice": "billing",
      "probabilities": {
        "billing": 0.84,
        "technical": 0.159,
        "sales": 0.001
      },
      "confidence": 0.596
    }
  }
}
```

Question IDs are map keys only. They are not embedded in each Jev question object.

Noul maps to:

```text
value = noul >= 0.5
probabilityYes = noul
confidence = null
confidenceKind = probability_only
```

Choice maps directly as:

```text
choice
probabilities: Record<string, number>
confidence: number | null
confidenceKind = provider_reported_calibrated
```

Choice requires valid options, probability keys that exactly match the criteria, probabilities in `[0,1]`, a probability sum near 1, and confidence in `[0,1]`.

Jev Score may be fractional. The normalized score therefore accepts any finite number:

```text
0 <= score <= criteria.length - 1
```

Jev score probabilities use an object keyed by level index:

```json
{
  "0": 0.0,
  "1": 0.7,
  "2": 0.3
}
```

The Jev adapter converts them to the provider-neutral array:

```text
[0.0, 0.7, 0.3]
```

Jev returns `legend` as an object map. The adapter does not trust or cast it. Integer scores use the Runtime criteria as canonical legend; fractional scores normalize `legend` to `null`.

# 7 Benchmark Dataset

The dataset is synthetic and deterministic:

```text
total cases = 51
Suite A next action = 21
Suite B human governance gate = 15
Suite C automation risk score = 15
manufacturing cases = 22
finance cases = 19
generic governance/risk variants = 10
```

Case IDs, state, questions, and labels are fixed in source. No case uses `Math.random`, `randomUUID`, or the current time.

The suites cover:

- customer receipt claim mismatch
- quality nonconforming quantity
- shipment quantity shortfall
- quotation/order mismatch
- payment balance outstanding
- invoice/payment mismatch
- human governance boundaries
- automation risk levels

# 8 Reference Labels

The project calls the labels `reference labels`, not ground truth.

The source is:

```text
synthetic product rubric derived from the current Action Catalog and human-governance boundary
```

The labels are deterministic synthetic expectations. They do not represent unique real-world truth and contain no customer data.

# 9 Metrics

The harness reports:

- exact accuracy
- binary and multiclass Brier score
- score MAE
- exact-level and within-one-level score accuracy
- schema-valid rate
- error rate
- latency p50 and p95
- confidence-kind breakdown
- unsafe decision rate
- coverage and selective accuracy at thresholds 0.60, 0.75, and 0.90
- provider token usage when returned
- estimated cost only when explicit pricing environment variables are supplied

Latency measures `evaluateBatch` only. Fixture construction and database setup are excluded.

# 10 Calibration Limitations

Only Brier score is used as a calibration-related metric.

The sample size is small. The project does not claim statistical calibration proof.

OpenAI confidence is `self_reported`. Jev choice and score confidence is `provider_reported_calibrated`; Jev Noul is `probability_only`, because it has no independent confidence field. These confidence kinds are reported separately and are never averaged together.

# 11 Safety Metrics

Unsafe decisions include:

- a human-governance reference of `true` answered as `false`
- a provider choosing customer-facing or financial/legal action when the reference allows only internal or human-governed handling

Safety metrics do not grant execution permission.

# 12 Cost / Latency

Live benchmarks run sequentially, with at most one warmup request per live provider. Warmup is not included in metrics.

No automatic retries are used. Provider failure remains visible in error rate and is never replaced by another provider.

Pricing is applied only from explicit environment configuration:

```text
DECISION_BENCHMARK_OPENAI_INPUT_USD_PER_MTOK
DECISION_BENCHMARK_OPENAI_OUTPUT_USD_PER_MTOK
DECISION_BENCHMARK_JEV_INPUT_USD_PER_MTOK
DECISION_BENCHMARK_JEV_OUTPUT_USD_PER_MTOK
```

Jev pricing snapshot recorded on 2026-09-19:

```text
$0.042 / 1M input tokens
output currently free
```

This is a dated public pricing snapshot, not a long-term business fact.

# 13 Production Boundary

This runtime does not replace:

- Grounded Explanation
- Root Cause Hypothesis
- Decision Recommendation
- Policy Engine
- Automation
- Connector
- Outcome Intelligence

Jev and OpenAI are not called in production decision paths. The benchmark has no production routing side effects.

# 14 Future Multi-project Reuse

Future integration mapping, not implemented in this phase:

```text
OpenELab       -> evidence classification
qa-system      -> case/action routing
Customer Service -> intent and human escalation
CRM            -> lead routing
WALOVI         -> evidence/signal classification
Zhibian        -> stance classification
```

No code from those projects is copied into this repository in Phase 13.

# 15 Commands and Artifacts

```bash
npm run decision-runtime:benchmark
npm run decision-runtime:benchmark-v2
npm run decision-runtime:verify-openai
npm run decision-runtime:verify-jev
```

Default benchmark selection is deterministic only. Explicit multi-provider selection:

```bash
DECISION_BENCHMARK_PROVIDERS=deterministic,openai,jev npm run decision-runtime:benchmark
```

Raw safe trace:

```text
data/runtime/decision-runtime/benchmark-raw.json
```

Committed summary:

```text
docs/competition/runtime/decision-runtime-benchmark-summary.json
```

V2 benchmark artifacts are versioned separately:

```text
data/runtime/decision-runtime/benchmark-v2-raw.json
docs/competition/runtime/decision-runtime-benchmark-v2-summary.json
```

The raw trace stores normalized answers, latency, errors, metrics, and usage. It does not store API keys, authorization headers, raw state, prompts containing secrets, raw provider responses, chain-of-thought, or stack traces.

# 16 Truthfulness

```text
DECISION_RUNTIME_IMPLEMENTED=true
PROVIDER_NEUTRAL_RUNTIME=true
DETERMINISTIC_PROVIDER_IMPLEMENTED=true
OPENAI_DECISION_PROVIDER_IMPLEMENTED=true
JEV_PROVIDER_IMPLEMENTED=true
SYNTHETIC_BENCHMARK_DATA=true
PRODUCTION_DECISION_ROUTING_CHANGED=false
POLICY_ENGINE_CHANGED=false   # retained in the V1 historical artifact
AI_EXECUTION_PERMISSION=false
```

V2 records `POLICY_ENGINE_CHANGED=true` because Decision Action Taxonomy V2 changes the policy boundary.

The dynamic benchmark summary records:

```text
REAL_OPENAI_BENCHMARK_VERIFIED=true/false
REAL_JEV_BENCHMARK_VERIFIED=true/false
JEV_STATUS=verified/not_configured/access_blocked/failed
```

No live provider is marked verified without an actual successful call.

# 17 Decision Action Taxonomy V2

Benchmark V2 keeps V1 data and artifacts unchanged. It derives benchmark state from the Action Catalog metadata and separates governance into three questions:

```text
isHumanReviewTransition
requiresApprovalBeforeExecution
hasMaterialBusinessEffect
```

The split actions are:

```text
route_quotation_to_review
approve_or_change_quotation_terms
```

V2 does not use the V1 rule `create_task/supplement_evidence=false; everything else=true`. Its references are derived from explicit action metadata and the deterministic policy boundary.
