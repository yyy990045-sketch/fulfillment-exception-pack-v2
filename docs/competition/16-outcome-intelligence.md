# 1 Outcome Intelligence Layer

Outcome Intelligence measures the business state observed after an Exception, independently of governance and execution.

```text
Exception != ResolutionCase != AutomationRun != OutcomeEvaluation
```

# 2 Evidence-backed Measurement

The client submits only:

- Outcome Definition ID
- Evidence IDs
- optional Resolution Case ID
- optional Automation Run ID

The client cannot submit a baseline, current value, status, tenant, actor, or roles.

# 3 Baseline

The baseline is read from:

- `Exception.metrics`, or
- the latest deterministic `RuleEvaluation.metrics`

# 4 Current Measurement

The current value is read from Evidence whose `field` equals the definition's `currentEvidenceField`.

Missing, cross-tenant, wrong-context, wrong-field, or invalid-value Evidence fails closed.

# 5 Deterministic Evaluation

The status is one of:

```text
target_met
improved
unchanged
worsened
insufficient_evidence
```

The evaluator compares the baseline, current Evidence value, target, comparison operator, and declared better direction.

# 6 No Causal Attribution

A result after an intervention means only:

```text
The target business state was observed after the linked intervention.
```

It does not prove that the intervention caused the state.

There is no control group, counterfactual, causal model, or selection-bias correction in this phase.

# 7 Observed Associations

Analytics may group results by:

- automation intervention
- resolution intervention
- unlinked
- automation ActionType

These are observed associations, not effectiveness.

# 8 Closed Is Not Outcome

A closed Resolution Case remains governance completion.

The analytics explicitly expose:

- closed with a measured Outcome
- closed without a measured Outcome

# 9 Automation Is Not Outcome

A successful Automation Run creates an internal effect and Receipt.

It does not create a `target_met` Outcome. New Evidence must exist before an Outcome can be measured.

# 10 Synthetic Portfolio

The manufacturing synthetic portfolio includes deterministic post-action Evidence and covers:

- target met
- improved
- unchanged
- worsened
- insufficient evidence

Evidence metadata identifies synthetic records. The portfolio is not real customer outcome data.

# 11 Historical Boundaries

Outcome evaluation does not modify:

- Exception state
- Resolution Case state
- Automation Run state
- Policy Evaluation
- Decision Recommendation disposition
- Root Cause Hypothesis review

# 12 Stale

An old Outcome Evaluation becomes stale when:

- the Outcome Definition content changes
- the latest RuleEvaluation changes
- referenced Evidence is superseded
- a linked intervention disappears

Old evaluations remain retained.

# 13 Learning Signal

`buildOutcomeLearningSummary()` can return descriptive counts and observed action associations.

It does not rank actions, recommend an action based on success, or claim causal effectiveness.

# 14 Truthfulness Boundary

```text
OUTCOME_INTELLIGENCE_IMPLEMENTED = true
OUTCOME_EVIDENCE_BACKED = true
OUTCOME_EVALUATION_DETERMINISTIC = true
BUSINESS_OUTCOME_MEASURED = true
REAL_CUSTOMER_OUTCOME_DATA = false
CAUSAL_EFFECT_MEASURED = false
ACTION_EFFECTIVENESS_MEASURED = false
ROI_MEASURED = false
```

`BUSINESS_OUTCOME_MEASURED=true` means the platform can measure synthetic/demo business state from Evidence. It does not mean real customer outcome data has been collected.
