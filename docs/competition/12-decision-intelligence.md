# 1 Decision Intelligence Layer

Decision Intelligence is a separate AI capability from Grounded Explanation.

It is bounded by:

- current Exception
- current RuleEvaluation
- current Evidence Bundle
- deterministic historical governance summary
- eligible ActionType boundary

It does not decide the business outcome.

# 2 Explanation vs Recommendation vs Action

```text
Grounded Explanation = explains what is already known
Decision Recommendation = suggests possible next human choices
Resolution Action = a formal human-governed action
```

An AI recommendation is never written into `resolutionCase.runtime.actions`.

AI cannot submit, approve, execute, or close.

# 3 Current Evidence Boundary

Recommendation input uses only the current Exception Evidence Bundle plus explicitly scoped context facts.
Optional context facts carry `role=context` and are deterministic inputs owned by the domain layer.

Grounded Explanation is not a fact source for Recommendation. AI output is never promoted into business Evidence.

# 4 Historical Governance Signals

History is a deterministic tenant-scoped aggregate:

- same exception count
- same exception with Resolution Case
- Action type counts
- Resolution status counts
- closed and rejected Case counts
- `outcomeMeasured=false`

No embedding, semantic similarity, vector database, or RAG is used.

# 5 Why History Is Not Outcome

Historical action counts answer:

```text
What actions were recorded before?
```

They do not answer:

```text
Did those actions work?
```

Without an Outcome model, history cannot be presented as success rate or effectiveness.

# 6 Action Eligibility Guard

Only existing ActionTypes are allowed:

```text
supplement_evidence
urge_follow_up
reject_overclaim
review_quotation
create_task
```

The guard is separate from a future Policy Engine. In Phase 8A, `reject_overclaim` is ineligible because entitlement and policy proof are not available.

# 7 Structured Recommendation

The provider returns strict structured output with one recommended option and up to three options total.

Each option carries:

- ActionType
- human-readable action
- rationale
- Evidence citations
- supporting facts
- history claims
- assumptions
- missing evidence

`humanDecisionRequired` is always `true`.

# 8 Grounding Validation

The Recommendation is rejected when:

- an Evidence citation does not exist
- a numeric supporting fact conflicts with deterministic input
- a history claim conflicts with the history snapshot
- an ineligible ActionType is recommended
- Root Cause or responsibility is asserted
- historical effectiveness or success is asserted

# 9 Human Disposition

A human can record:

```text
accepted
modified
rejected
```

Disposition is append-only feedback about the Recommendation. It is not a Resolution transition and does not create a Resolution Case or Action.

# 10 Use-as-draft Boundary

When a Resolution Case is `confirmed`, a generated Recommendation can prefill the browser's Proposal Form.

This is a local UI convenience:

- no API mutation
- no automatic proposal
- no automatic submit
- user must review and click the existing Proposal action

Recommendation identity is not written into Resolution Action schema.

# 11 OpenAI Provider

The optional OpenAI provider follows the same safety contract as Grounded Explanation:

- Responses API
- strict Structured Outputs
- `store=false`
- `tools=[]`
- `maxRetries=0`
- AbortController timeout

No fallback to deterministic is allowed.
Provider selection is explicit and fail-closed. The deterministic provider has no implicit default and requires both `DEMO_MODE=true` and `DECISION_AI_PROVIDER=deterministic`.

# 12 No Root Cause Yet

Phase 8A may list missing evidence and verification questions.

It must not claim:

- root cause
- causal explanation
- liability
- responsibility

# 13 No Policy Automation Yet

Eligibility only asks whether an AI suggestion may appear.

It does not decide whether an action should be automatically executed under a risk, amount, or permission policy.

# 14 Future Outcome Learning

The persisted Recommendation and Disposition records prepare future evaluation of:

- human acceptance
- modifications
- rejection
- action adoption

But acceptance is not effectiveness. Outcome Intelligence remains a later phase.

# 15 Cross-industry Reuse

The Decision layer is generic:

- Evidence-grounded
- tenant scoped
- history aware
- eligibility bounded
- human disposition ready

Manufacturing is the current demo pack, not a hard dependency of the Decision core.

# 16 Truthfulness Boundary

```text
DECISION_RECOMMENDATION_IMPLEMENTED = true
DECISION_RECOMMENDATION_GROUNDED = true
HISTORY_AWARE = true
HISTORY_OUTCOME_AWARE = false
HUMAN_DECISION_REQUIRED = true
AI_RESOLUTION_ACTION_WRITE = false
AI_APPROVAL = false
AI_EXECUTION = false
ROOT_CAUSE_HYPOTHESIS = true
POLICY_ENGINE = true
AUTO_DECISION = false
REAL_DECISION_LLM_VERIFIED = false
```

The live OpenAI Decision provider remains blocked when no API key is configured.
