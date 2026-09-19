# 1 Policy-bounded Automation

Phase 9 allows a narrow class of internal low-risk actions to execute after an existing Policy Evaluation returns `auto_eligible`.

It does not implement autonomous enterprise decision-making.

# 2 Allowed Actions

The internal executor supports only:

```text
create_task
supplement_evidence
```

Every action must also satisfy:

```text
customerFacing = false
financialMovement = false
legalEffect = false
reversible = true
```

# 3 Defense In Depth

`PolicyEvaluation.decision.mode = auto_eligible` is necessary but not sufficient.

The Automation layer rechecks Action Catalog metadata. A misconfigured policy cannot make a customer-facing, financial, legal, or irreversible action executable.

# 4 Policy Is Not Executor

The Policy Engine answers whether an action is an automation candidate.

The Automation Engine answers whether the current runtime has a safe executor and performs the internal effect.

# 5 Runtime Gate

Execution requires:

```text
AUTOMATION_ENABLED=true
AUTOMATION_EXECUTOR=internal
```

There is no fallback. Disabled or unknown executor configuration fails closed.

# 6 Internal Executor

The internal executor creates a real persisted `InternalWorkItem`:

- `create_task` creates `kind=task`
- `supplement_evidence` creates `kind=evidence_request`

It does not call ERP, WMS, CRM, email, enterprise messaging, or external APIs.

# 7 InternalWorkItem

The Work Item starts with:

```text
status = open
source = policy_automation
```

Phase 9 does not implement completion, cancellation, assignment, or a full task-management product.

# 8 AutomationRun and Receipt

An actual execution attempt creates an `AutomationRun`.

Successful execution creates:

- one `AutomationRun`
- one `InternalWorkItem`
- one `AutomationReceipt`

The three writes are atomic.

Blocked requests do not create a Run. Executor failures create a `failed` Run without a successful Work Item or Receipt.

# 9 Idempotency

The operation key derives from:

- tenant
- Policy Evaluation ID
- candidate ActionType
- executor version

Repeated requests return the same Run, Work Item, and Receipt IDs without increasing row counts.

# 10 Recommendation Integration

When the Policy Evaluation came from an AI Recommendation option, Automation rechecks:

- Recommendation exists
- status is `generated`
- scope matches
- option exists
- ActionType matches

AI is never called during execution.

# 11 No Resolution Mutation

Policy-bounded Automation does not:

- create a Resolution Case
- modify a Resolution Action
- submit approval
- approve
- execute the Resolution state machine
- close a Case

The internal executor and Resolution governance remain separate execution planes.

# 12 No Business Fact Mutation

Automation does not mark an Exception resolved, confirm a Root Cause, or create a Decision Recommendation disposition.

# 13 Meaning of Automatic

A user or future system trigger provides an existing Policy Evaluation.

If the mode is `auto_eligible` and the Runtime Safety Gate passes, the platform may create the internal Work Item without a separate approval step.

This is the full definition of automatic execution in Phase 9.

# 14 No External Execution

The platform is not connected to ERP or WMS execution in this phase.

There is no system-event scheduler, event bus, or unattended trigger loop.

# 15 Operations View

The Operations Workbench includes a read-only view of open internal tasks and evidence requests.

These counts are operational records, not an efficiency or ROI KPI.

# 16 Truthfulness Boundary

```text
POLICY_BOUNDED_AUTOMATION_IMPLEMENTED = true
INTERNAL_AUTOMATION_EXECUTOR = true
CREATE_TASK_AUTOMATION = true
SUPPLEMENT_EVIDENCE_AUTOMATION = true
CUSTOMER_FACING_AUTOMATION = false
FINANCIAL_AUTOMATION = false
LEGAL_AUTOMATION = false
REAL_ERP_WMS_EXECUTION = false
SYSTEM_EVENT_AUTO_TRIGGER = false
AI_DIRECT_EXECUTION = false
```
