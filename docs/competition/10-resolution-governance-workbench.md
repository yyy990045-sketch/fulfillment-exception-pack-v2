# 1 Why Exception != Resolution Case

The source Exception is a deterministic fact:

```text
Exception.status = detected
```

The Resolution Case is the human governance process applied to that fact:

```text
triaged -> confirmed -> proposed -> approved -> executed -> closed
```

Closing a Resolution Case does not remove, resolve, or rewrite the source Exception.

# 2 Human Acceptance

An Exception with no Resolution Case displays a human acceptance form.

The form calls:

```text
POST /api/v2/contexts/{contextId}/exceptions/{exceptionId}/resolution-case
```

The user must explicitly provide the owner role and acceptance rationale. The API does not automatically create a Case during rule evaluation or workbench GET.

# 3 Intake Snapshot

Acceptance freezes:

- acceptedBy
- acceptedAt
- acceptanceRationale
- sourceRuleEvaluationId
- Evidence references

The UI displays the intake Evaluation and current Evaluation separately.

If the source has changed, the UI shows:

```text
源证据自进入处置后已发生变化。本 Case 仍保留原始 intake lineage 与 Evidence references。
```

It does not rebase or replace the original intake lineage references.

# 4 Review Gate

A triaged Case displays the human review form:

- confirm
- needs_evidence
- reject

The review rationale is mandatory.

`needs_evidence` keeps the Case in `triaged` and allows a later review. `reject` is terminal.

# 5 Human Proposal

A confirmed Case displays a proposal form. The user can add one to three actions.

Allowed action types are exactly:

```text
supplement_evidence
urge_follow_up
reject_overclaim
review_quotation
create_task
```

Every action summary is human-authored. The UI does not use AI output to fill proposal text.

# 6 Submit vs Approve

After proposal:

```text
status = proposed
action.status = draft
```

Submit changes actions to:

```text
pending_approval
```

The outer Case status remains `proposed`.

Approval is a separate human mutation and changes the Case to `approved` with actions `authorized`.

# 7 Segregation of Duties

The Domain rejects approval when the approver is the review actor or the proposal author.

The UI shows review actor, proposal author, and an advance warning when the selected demo actor cannot approve. The warning does not replace Domain enforcement.

# 8 Local-ledger Execution

Execution is deliberately labeled:

```text
执行并记录本地演示回执
```

It writes `local-ledger` receipts. It does not call ERP, WMS, MES, Open supOS, or another external system.

# 9 Receipt-gated Closure

Closure is only available after execution. The Domain verifies that approved actions have receipts before allowing close.

The UI does not provide a manual “mark complete” path.

# 10 Audit Timeline

The Resolution tab renders `resolutionCase.runtime.events` in order:

- actor
- from -> to
- reason
- time

The UI does not invent audit events.

# 11 Source Drift

Source drift is shown as a warning. The original intake Evaluation and Evidence references remain visible. No automatic rebase, replacement, or rollback occurs.

# 12 Demo Actor Boundary

In demo mode, the UI sends only:

```text
x-tenant-id
x-actor
```

for mutations. The actor is never placed in the request body.

When a bearer token exists, the UI sends the Authorization header only and does not send `x-actor` or the demo tenant override.

# 13 No AI Action Recommendation

The AI Explanation tab remains read-only. Resolution actions are manually entered by a human. The UI does not call the AI endpoint to generate actions, approvals, or execution.

# 14 Closed Case Does Not Delete Exception

After Case closure:

- the Case is `closed`
- actions are `verified`
- receipts remain
- audit events remain
- the source Exception remains `detected`

This separation is an invariant of the workbench.

# 15 Truthfulness Boundary

```text
RESOLUTION_UI_IMPLEMENTED = true
HUMAN_ACCEPTANCE = true
HUMAN_REVIEW = true
HUMAN_PROPOSAL = true
SOD_ENFORCED_BY_DOMAIN = true
LOCAL_LEDGER_EXECUTION = true
REAL_EXTERNAL_EXECUTION = false
AI_ACTION_RECOMMENDATION = false
AUTO_APPROVAL = false
AUTO_RESOLUTION = false
```

Phase 7B adds governance operations to the V2 workbench, not a new workflow engine.
