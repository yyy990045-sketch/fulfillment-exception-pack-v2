# Exception → Resolution Case Bridge（阶段 3 封板）

# 1 Exception 与 Resolution Case

Exception：

```text
系统根据版本化规则检测到的业务异常。
```

Resolution Case：

```text
企业人工决定进入治理流程的案件。
```

两者不是同一生命周期对象。

# 2 Human Acceptance

Exception 不允许自动成为 Resolution Case。

必须由真人明确接受，并记录：

```text
ownerRole
rationale
acceptedBy
acceptedAt
```

# 3 Intake Snapshot

创建 Resolution Case 时固定：

```text
source RuleEvaluation
RuleVersion
Exception code / matchKey
Evidence refs
acceptance rationale
```

后续 Exception 或 Evidence 更新不会自动改写 intake snapshot。

# 4 Review

Resolution Review 决策：

```text
confirm
needs_evidence
reject
```

映射：

```text
triaged -> confirmed
triaged -> triaged
triaged -> rejected
```

# 5 Manual Proposal

Action 必须由人明确提交。

当前支持：

```text
supplement_evidence
urge_follow_up
reject_overclaim
route_quotation_to_review
approve_or_change_quotation_terms
create_task
```

系统不通过 LLM 自动生成处置方案。

# 6 Submit / Approval

Submit：

```text
draft -> pending_approval
```

Approval 必须满足：

- Case 状态为 proposed
- 所有 Action 均为 pending_approval
- 审批人角色合法
- 通过职责分离检查

v2 Resolution 不允许 draft Action 直接批准。

# 7 Segregation of Duties

以下 actor 不能审批：

- Review actor
- Proposed by actor

即使该 actor 具有 V1 审批角色，也必须拒绝。

错误：

```text
SEGREGATION_OF_DUTIES_VIOLATION
```

# 8 Execution

当前 Execution 属于：

```text
local-ledger demo execution
```

不是 ERP、MES 或 Finance 的真实执行。

不能声称：

- ERP 已退款
- MES 已修改
- 财务已催收

# 9 Receipt Idempotency

每个 Action Receipt 使用：

```text
tenantId
resolutionCaseId
actionId
operationKey
payloadHash
```

相同 operationKey 和相同 payload：

```text
返回已有 Receipt
```

相同 operationKey 但 payload 不同：

```text
RESOLUTION_EXECUTION_IDEMPOTENCY_CONFLICT
```

# 10 Verification / Close

Close 只允许从 executed 进入。

每个 Action 必须：

```text
status = succeeded / verified
receipt exists
receiptSource = local-ledger
```

否则不能关闭。

重复 close：

- 返回已有 closed Case
- 不新增 event
- 不新增 receipt
- 不修改既有时间

# 11 Exception / Resolution 双生命周期

Resolution Case closed 不表示 Exception 被删除。

```text
Resolution Case: closed
Exception: detected
```

Exception 继续作为业务异常事实存在。

# 12 Source Drift

Resolution Case 同时保留：

```text
intakeEvaluationId
currentEvaluationId
```

当 Exception 的 latest Evaluation 变化：

```text
sourceChanged = true
```

Source Drift 只提示变化，不自动修改 Case。

# 13 Snapshot 不自动 Rebase

以下字段永不因 Source Drift 自动修改：

```text
origin.ruleVersionId
origin.sourceRuleEvaluationId
origin.evidenceRefs
origin.acceptedAt
origin.acceptanceRationale
review
actions
status
```

# 14 Tenant Isolation

所有 Resolution Case 查询和操作必须：

- tenantId 来自认证上下文
- 跨 tenant 返回 404
- 不泄露 Case、Exception、Evidence 或 Receipt

# 15 Hero Case

正式 Hero：

```text
CUSTOMER_RECEIPT_CLAIM_MISMATCH
```

Facts：

```text
Shipment = 96
Customer Claim = 80
```

系统结论只能表达：

```text
客户主张与系统发货记录不一致。
```

不能自动表达：

```text
仓库少发 16 件
客户说谎
企业应赔偿
```

# 16 完整治理链

```text
Fulfillment Facts
  -> Rule
  -> Exception
  -> Human Accept
  -> Resolution Case
  -> Review
  -> Proposal
  -> Submit
  -> Approval
  -> Execution
  -> Receipt
  -> Verification
  -> Close
```

Rule Engine 可以产生 Exception。

只有真人接受后，才进入 Resolution Case 治理流程。
