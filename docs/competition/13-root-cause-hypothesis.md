# 1 Root Cause Hypothesis Layer

Root Cause Hypothesis is a separate AI capability from Grounded Explanation and Decision Recommendation.

It answers:

```text
Which causes deserve further investigation?
```

It does not answer:

```text
What was the confirmed root cause?
Who is responsible?
```

# 2 Input Boundary

The input contains only:

- current Exception
- latest RuleEvaluation
- current Exception Evidence Bundle
- SourceDocuments
- SourceSystems
- deterministic context facts for the Exception entities

Grounded Explanation outputs, Decision Recommendations, and Human Dispositions are not business facts and are not inputs.

# 3 Hypothesis Contract

Each item is explicitly marked:

```text
epistemicStatus = hypothesis
```

Allowed epistemic status values do not include confirmed, proven, fact, or root_cause.

# 4 Possible Causation

Phase 8B may describe:

- possible relationship
- possible source
- questions such as whether X contributed to Y

It must not state deterministic causation.

# 5 Evidence Grounding

Supporting and contradicting Evidence IDs must exist in the current scoped input.

Unknown citations are rejected with `ROOT_CAUSE_INVALID_CITATION`.

# 6 Numerical Grounding

Business numbers in summary, hypothesis statements, missing evidence, and verification steps must be grounded in:

- Evidence
- RuleEvaluation observations
- RuleEvaluation metrics

Unsupported numbers are rejected.

# 7 Certainty Guard

The Validator rejects deterministic assertions such as:

- 根因是
- 已经证明
- 确定由
- 必然导致
- confirmed cause
- root cause is

# 8 Responsibility Guard

The layer does not decide:

- warehouse responsibility
- customer responsibility
- logistics responsibility
- quality department responsibility
- compensation liability
- contractual liability

# 9 Human Review

A human can record:

```text
investigate
needs_evidence
rejected
```

Review is append-only feedback for the hypothesis.

`investigate` means the hypothesis deserves follow-up. It never means the hypothesis is confirmed.

# 10 Persistence and Snapshot

Migration 008 adds:

- `root_cause_analyses`
- `root_cause_hypothesis_reviews`

The snapshot includes Exception identity, the latest RuleEvaluation, Evidence values and source versions, scoped context facts, and the schema version.

# 11 Stale and Idempotency

The same tenant, Exception, snapshot, provider, and model are reused without a second provider call.

If Evidence, context facts, or the latest RuleEvaluation changes, the old analysis remains retained and becomes stale.

# 12 Provider Modes

The deterministic provider is explicitly demo-only:

```text
DEMO_MODE=true
ROOT_CAUSE_AI_PROVIDER=deterministic
```

The optional OpenAI provider uses Responses API Structured Outputs with:

- `store=false`
- `tools=[]`
- `maxRetries=0`
- AbortController timeout

There is no provider fallback.

# 13 No Root Cause Confirmation

The current layer does not:

- confirm a root cause
- create a business fact
- create a Resolution Action
- submit approval
- approve
- execute
- close a Case

# 14 Manufacturing Hero Boundaries

Customer Claim hypotheses may discuss the post-shipment receipt interval, but may not claim warehouse short shipment or customer misreporting.

Quality hypotheses may discuss a possible relationship between nonconforming quantity and shipment quantity, but may not claim deterministic causation.

Payment hypotheses may discuss incomplete payment or payment timing, but may not declare breach, bad debt, or liability.

# 15 Cross-industry Reuse

The capability is generic:

- tenant scoped
- Evidence grounded
- provider replaceable
- human review required
- no industry-specific root cause stored as fact

Manufacturing is the current scenario pack, not a hard dependency of the core.

# 16 Truthfulness Boundary

```text
ROOT_CAUSE_HYPOTHESIS_IMPLEMENTED = true
ROOT_CAUSE_CONFIRMED = false
HYPOTHESIS_IS_BUSINESS_FACT = false
LIABILITY_DECISION = false
HUMAN_VERIFICATION_REQUIRED = true
REAL_ROOT_CAUSE_LLM_VERIFIED = false
```
