# 1 Policy Engine Position

The Decision Policy Engine is deterministic software.

It answers:

```text
What level of human or automated governance should handle this candidate action?
```

It does not call an LLM and does not execute the action.

# 2 Eligibility Guard Is Not Policy

The Decision Recommendation eligibility guard answers:

```text
May the AI suggest this ActionType at all?
```

The Policy Engine answers:

```text
Under the current deterministic governance policy, does this action require a human,
an independent approval, or is it only an automation candidate?
```

# 3 Policy Engine Is Not Automation

The only policy modes are:

```text
human_only
approval_required
auto_eligible
```

`auto_eligible` does not mean executed.

Every result includes:

```text
automationAvailable = false
executionPerformed = false
```

# 4 Generic Action Catalog

The catalog describes action effects without adding business logic:

- `create_task`: internal task
- `supplement_evidence`: internal evidence request
- `urge_follow_up`: external communication
- `review_quotation`: internal review
- `reject_overclaim`: customer-facing financial and legal decision

# 5 Policy DSL

Conditions are typed. Supported operators are:

- `actionTypeIn`
- `exceptionCodeIn`
- `severityIn`
- `candidateSourceIn`
- `hasClaimEvidence`
- `customerFacing`
- `financialMovement`
- `legalEffect`

All conditions on one Policy Definition are evaluated as an AND boundary.

# 6 Default Policy Pack

Default policies are explicitly provisioned:

```text
reject_overclaim -> human_only
legalEffect=true -> human_only
financialMovement=true -> human_only
urge_follow_up -> approval_required
review_quotation -> approval_required
internal create_task -> auto_eligible
internal supplement_evidence -> auto_eligible
```

If no policy matches, the result is `human_only`.

# 7 Default Deny

The Policy Engine never defaults to automation.

No matching policy means:

```text
mode = human_only
reason = default_deny
```

# 8 Recommendation Integration

An AI Recommendation option can be evaluated only if:

- the Recommendation exists
- status is `generated`
- it is not stale
- the option exists
- the option ActionType matches the candidate action

The AI text cannot override the Policy Engine.

# 9 Snapshot and Stale

The Policy snapshot includes:

- Exception identity
- latest RuleEvaluation
- Action metadata
- deterministic policy facts
- enabled policy versions and content hashes

Changing the latest RuleEvaluation or policy definitions makes the old evaluation stale.

# 10 Resolution Boundary

Policy Evaluation does not:

- accept the Exception
- create a Resolution Case
- write a Resolution Action
- submit approval
- approve
- execute
- close a Case

# 11 Financial Thresholds

Phase 8C does not implement amount thresholds because a unified currency and financial-impact model is not yet in place.

# 12 Future Automation Contract

Phase 9 may combine:

- Policy Evaluation
- Resolution governance
- execution adapters

to implement controlled automation.

Phase 8C only returns the eligibility signal and never executes.

Phase 9 is implemented as a separate bounded layer documented in `15-policy-bounded-automation.md`. Existing Policy Evaluation records keep `automationAvailable=false` and `executionPerformed=false` as historical Phase 8C semantics.

# 13 Cross-industry Reuse

The Policy Engine is generic:

- tenant scoped
- deterministic
- typed action metadata
- versioned policy definitions
- default deny
- human governance first

Manufacturing actions are the current scenario pack, not a hard dependency of the policy core.

# 14 Truthfulness Boundary

```text
POLICY_ENGINE_IMPLEMENTED = true
POLICY_EVALUATION_DETERMINISTIC = true
POLICY_DEFAULT_DENY = true
AUTO_ELIGIBILITY_AVAILABLE = true
AUTO_EXECUTION = false
AI_CAN_OVERRIDE_POLICY = false
FINANCIAL_THRESHOLD_POLICY = false
REAL_EXTERNAL_EXECUTION = false
```
