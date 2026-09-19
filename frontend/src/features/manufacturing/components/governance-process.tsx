import { useEffect, useState } from "react";
import { OutcomeStatusBadge } from "../../../components/product/status-badge.js";
import { Badge } from "../../../components/ui/badge.js";
import { Button } from "../../../components/ui/button.js";
import { outcomeStatusLabel } from "../../../lib/presentation.js";
import { cn } from "../../../lib/utils.js";
import {
  useOutcomeEvaluations,
  usePolicyEvaluations,
  useResolutionCapabilities,
  useResolutionProcess,
} from "../../../hooks/use-manufacturing.js";
import type {
  CapabilityDecisionView,
  DecisionRecommendationView,
  PolicyEvaluationView,
  ResolutionCaseView,
} from "../analysis-types.js";
import {
  governanceSteps,
  governanceStepStatus,
  isResolutionApprovalSubmitted,
  resolveGovernanceStep,
} from "../governance-step.js";
import { governanceErrorMessage } from "../governance-errors.js";
import {
  governanceActionSuccessMessages,
  useGovernanceActionController,
} from "../governance-action-controller.js";
import {
  actionTypeLabel,
  fieldLabel,
  formatShortDateTime,
  governanceActionStatusLabel,
  metricLabel,
  policyModeLabel,
  resolutionStatusLabel,
} from "../utils.js";
import { ProcessStep, type ProcessStepStatus } from "./process-step.js";
import { InlineEmpty, InlineError, SectionSkeleton } from "./query-state.js";

const actionLabels: Record<string, string> = {
  supplement_evidence: "补充证据",
  urge_follow_up: "跟进催办",
  reject_overclaim: "驳回超额主张",
  review_quotation: "复核报价",
  create_task: "创建任务",
};

function latestPolicyForOption(
  evaluations: PolicyEvaluationView[],
  recommendationId: string | undefined,
  optionId: string | undefined,
) {
  if (!recommendationId || !optionId) return undefined;
  return evaluations
    .filter((item) => item.sourceRecommendationId === recommendationId && item.sourceOptionId === optionId)
    .at(-1);
}

function ActionList({ resolution }: { resolution: ResolutionCaseView }) {
  return (
    <div className="divide-y divide-border border-y border-border">
      {resolution.runtime.actions.map((action) => (
        <div key={action.id} className="flex items-start justify-between gap-3 py-2 text-sm">
          <div>
            <div className="font-medium">{actionLabels[action.type] ?? action.type}</div>
            <div className="text-xs text-text-muted">{action.summary}</div>
          </div>
          <Badge>{governanceActionStatusLabel(action.status)}</Badge>
        </div>
      ))}
    </div>
  );
}

function CapabilityReason({ capability }: { capability: CapabilityDecisionView }) {
  if (!capability.applicable || capability.allowed) return null;
  return <p className="text-xs text-warning">{capability.reason}</p>;
}

function CapabilityButton({
  capability,
  pending,
  pendingLabel,
  onClick,
  variant,
  children,
}: {
  capability: CapabilityDecisionView;
  pending: boolean;
  pendingLabel: string;
  onClick: () => void;
  variant?: "outline";
  children: string;
}) {
  if (!capability.applicable) return null;
  return (
    <>
      <Button variant={variant} disabled={pending || !capability.allowed} onClick={onClick}>
        {pending ? pendingLabel : children}
      </Button>
      <CapabilityReason capability={capability} />
    </>
  );
}

function AcceptanceForm({
  ownership,
  ownerRoles,
  pending,
  error,
  onSubmit,
}: {
  ownership: CapabilityDecisionView;
  ownerRoles: string[];
  pending: boolean;
  error: string | null;
  onSubmit: (ownerRole: string, rationale: string) => void;
}) {
  const [ownerRole, setOwnerRole] = useState(ownerRoles[0] ?? "");
  const [rationale, setRationale] = useState("");
  useEffect(() => {
    setOwnerRole(ownerRoles[0] ?? "");
  }, [ownerRoles]);
  return (
    <form className="space-y-3" onSubmit={(event) => {
      event.preventDefault();
      onSubmit(ownerRole, rationale.trim());
    }}>
      <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
        <label className="space-y-1 text-xs text-text-muted">
          处置负责人
          <select
            className="h-9 w-full rounded-md border border-border-strong bg-surface px-2 text-sm"
            value={ownerRole}
            disabled={!ownerRoles.length || !ownership.allowed}
            onChange={(event) => setOwnerRole(event.target.value)}
          >
            {ownerRoles.length
              ? ownerRoles.map((role) => <option key={role}>{role}</option>)
              : <option value="">无可用负责人角色</option>}
          </select>
        </label>
        <label className="space-y-1 text-xs text-text-muted">
          进入治理原因
          <textarea
            className="min-h-20 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm"
            value={rationale}
            onChange={(event) => setRationale(event.target.value)}
            placeholder="说明为什么需要进入人工治理。"
          />
        </label>
      </div>
      {!ownerRoles.length && <p className="text-xs text-warning">当前没有可指派负责人角色。</p>}
      <CapabilityReason capability={ownership} />
      {error && <p className="text-xs text-danger">{error}</p>}
      <Button type="submit" disabled={pending || !rationale.trim() || !ownerRole || !ownership.allowed}>
        {pending ? "正在进入治理..." : "进入人工治理"}
      </Button>
    </form>
  );
}

function ReviewForm({
  capability,
  pending,
  error,
  onSubmit,
}: {
  capability: CapabilityDecisionView;
  pending: boolean;
  error: string | null;
  onSubmit: (decision: "confirm" | "needs_evidence" | "reject", rationale: string) => void;
}) {
  const [decision, setDecision] = useState<"confirm" | "needs_evidence" | "reject">("confirm");
  const [rationale, setRationale] = useState("");
  return (
    <form className="space-y-3" onSubmit={(event) => {
      event.preventDefault();
      onSubmit(decision, rationale.trim());
    }}>
      <label className="block space-y-1 text-xs text-text-muted">
        复核结论
        <select
          className="h-9 w-full rounded-md border border-border-strong bg-surface px-2 text-sm"
          value={decision}
          onChange={(event) => setDecision(event.target.value as typeof decision)}
        >
          <option value="confirm">确认进入处置</option>
          <option value="needs_evidence">仍需补充材料</option>
          <option value="reject">不继续处置</option>
        </select>
      </label>
      <label className="block space-y-1 text-xs text-text-muted">
        复核说明
        <textarea
          className="min-h-20 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm"
          value={rationale}
          onChange={(event) => setRationale(event.target.value)}
        />
      </label>
      <CapabilityReason capability={capability} />
      {error && <p className="text-xs text-danger">{error}</p>}
      <Button type="submit" disabled={pending || !rationale.trim() || !capability.allowed}>
        {pending ? "正在提交复核..." : "提交复核"}
      </Button>
    </form>
  );
}

function ProposalForm({
  recommendation,
  selectedOptionId,
  capability,
  pending,
  error,
  onSubmit,
}: {
  recommendation: DecisionRecommendationView | undefined;
  selectedOptionId: string | undefined;
  capability: CapabilityDecisionView;
  pending: boolean;
  error: string | null;
  onSubmit: (actions: Array<{ type: string; summary: string }>) => void;
}) {
  const selectedOption = recommendation?.output.options.find((option) => option.id === selectedOptionId);
  const [type, setType] = useState<string>(selectedOption?.actionType ?? "create_task");
  const [summary, setSummary] = useState(selectedOption?.actionSummary ?? "");
  useEffect(() => {
    setType(selectedOption?.actionType ?? "create_task");
    setSummary(selectedOption?.actionSummary ?? "");
  }, [selectedOption?.id, selectedOption?.actionType, selectedOption?.actionSummary]);
  return (
    <form className="space-y-3" onSubmit={(event) => {
      event.preventDefault();
      onSubmit([{ type, summary: summary.trim() }]);
    }}>
      {selectedOption && (
        <p className="text-xs text-interactive">已带入所选建议草稿，提交前仍需人工核对和修改。</p>
      )}
      <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
        <label className="space-y-1 text-xs text-text-muted">
          治理动作
          <select
            className="h-9 w-full rounded-md border border-border-strong bg-surface px-2 text-sm"
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            {Object.entries(actionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs text-text-muted">
          动作说明与完成标准
          <textarea
            className="min-h-20 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
        </label>
      </div>
      <CapabilityReason capability={capability} />
      {error && <p className="text-xs text-danger">{error}</p>}
      <Button type="submit" disabled={pending || !summary.trim() || !capability.allowed}>
        {pending ? "正在拟定方案..." : "拟定处置方案"}
      </Button>
    </form>
  );
}

export function GovernanceProcess({
  contextId,
  exceptionId,
  recommendation,
  selectedOptionId,
}: {
  contextId: string;
  exceptionId: string;
  recommendation: DecisionRecommendationView | undefined;
  selectedOptionId: string | undefined;
}) {
  const policy = usePolicyEvaluations(contextId, exceptionId);
  const resolution = useResolutionProcess(contextId, exceptionId);
  const outcomes = useOutcomeEvaluations(contextId, exceptionId);
  const capabilities = useResolutionCapabilities(contextId, exceptionId);
  const { mutations, requestAction } = useGovernanceActionController();
  const resolutionCase = resolution.detail.data?.resolutionCase;
  const receipts = resolution.detail.data?.receipts ?? [];
  const policyEvaluations = policy.data?.evaluations ?? [];
  const outcomeEvaluations = outcomes.data?.evaluations ?? [];
  const latestOutcome = [...outcomeEvaluations]
    .sort((left, right) => left.evaluatedAt.localeCompare(right.evaluatedAt))
    .at(-1);
  const historicalOutcomes = outcomeEvaluations.filter((item) => item.id !== latestOutcome?.id);
  const currentPolicy = latestPolicyForOption(policyEvaluations, recommendation?.id, selectedOptionId);
  const current = resolveGovernanceStep(resolutionCase, Boolean(recommendation));
  const [expandedStep, setExpandedStep] = useState<typeof current | "">(current);

  useEffect(() => {
    setExpandedStep(current);
  }, [current]);

  const invocationError = (mutation: { error: unknown }) => mutation.error ? governanceErrorMessage(mutation.error) : null;

  if (resolution.list.isLoading || (resolution.summary && resolution.detail.isLoading) || policy.isLoading || outcomes.isLoading || capabilities.isLoading) {
    return <SectionSkeleton />;
  }
  const resolutionCapabilities = capabilities.data?.resolutionCapabilities;
  if (
    resolution.list.isError ||
    resolution.detail.isError ||
    policy.isError ||
    outcomes.isError ||
    capabilities.isError ||
    !resolutionCapabilities
  ) {
    return <InlineError title="治理进程加载失败" detail="当前治理、审批、权限或结果数据无法读取。" />;
  }
  const assignableOwnerRoles = capabilities.data?.assignableOwnerRoles ?? [];

  const policyDone = Boolean(currentPolicy && !currentPolicy.stale);
  const rejected = resolutionCase?.status === "rejected";
  const approvalSubmitted = isResolutionApprovalSubmitted(resolutionCase);
  const approvalDone = Boolean(resolutionCase && ["approved", "executed", "closed"].includes(resolutionCase.status));
  const executionDone = Boolean(resolutionCase && ["executed", "closed"].includes(resolutionCase.status));
  const approvalEvent = resolutionCase?.runtime.events.filter((event) => event.to === "approved").at(-1);
  const approvalOwner = approvalDone
    ? approvalEvent?.actor ?? "审批角色未记录"
    : currentPolicy?.decision.requiredRoles.join("、") || "独立审批人";
  const approvalResult = resolutionCase?.status === "proposed"
    ? approvalSubmitted
      ? "等待审批"
      : "未提交审批"
    : resolutionCase?.status === "rejected"
      ? "已终止"
      : approvalDone
        ? "已批准"
        : "未开始";
  const governanceResult = resolutionCase
    ? resolutionCase.status === "proposed"
      ? approvalSubmitted
        ? "待审批"
        : "方案草案"
      : resolutionStatusLabel(resolutionCase.status)
    : "未进入治理";
  const currentStepLabel = governanceSteps.find((step) => step.id === current)?.label ?? "治理";
  const currentPlan = resolutionCase?.runtime.actions.at(-1)?.summary ?? "待拟定处置方案";
  const compactSteps = [
    { id: "accept", label: "受理", target: "governance" as const },
    { id: "review", label: "复核", target: "governance" as const },
    { id: "propose", label: "方案", target: "governance" as const },
    { id: "approval", label: "审批", target: "approval" as const },
    { id: "execution", label: "执行", target: "execution" as const },
    { id: "receipt", label: "回执", target: "receipt" as const },
    { id: "outcome", label: "结果", target: "outcome" as const },
  ];
  const compactCurrent = !resolutionCase
    ? "accept"
    : resolutionCase.status === "triaged"
      ? "review"
      : resolutionCase.status === "confirmed"
        ? "propose"
        : resolutionCase.status === "proposed"
          ? approvalSubmitted ? "approval" : "propose"
          : resolutionCase.status === "approved"
            ? "execution"
            : resolutionCase.status === "executed"
              ? "receipt"
              : resolutionCase.status === "closed"
                ? "outcome"
                : "accept";
  const compactCurrentIndex = compactSteps.findIndex((step) => step.id === compactCurrent);

  const stepStatus = (step: string): ProcessStepStatus => {
    if (step === "governance") return governanceStepStatus("governance", current, { rejected });
    if (step === "approval") return governanceStepStatus("approval", current);
    if (step === "execution") return governanceStepStatus("execution", current);
    if (step === "receipt") return governanceStepStatus("receipt", current);
    return governanceStepStatus("outcome", current);
  };

  return (
    <section className="mt-4" aria-labelledby="governance-process-title">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="governance-process-title" className="text-sm font-semibold">处理进程</h2>
          <p className="mt-0.5 text-xs text-text-muted">建议 → 治理 → 审批 → 执行 → 回执 → 结果</p>
        </div>
        {resolutionCase && <Badge variant="info">治理：{resolutionStatusLabel(resolutionCase.status)}</Badge>}
      </div>
      <dl className="grid border-y border-border bg-surface-muted/40 sm:grid-cols-3 sm:divide-x sm:divide-border">
        <div className="px-3 py-2.5">
          <dt className="text-[11px] text-text-muted">当前阶段</dt>
          <dd className="mt-0.5 text-sm font-medium">{currentStepLabel}</dd>
        </div>
        <div className="px-3 py-2.5">
          <dt className="text-[11px] text-text-muted">负责人</dt>
          <dd className="mt-0.5 text-sm font-medium">{resolutionCase?.ownerRole ?? "待指定"}</dd>
        </div>
        <div className="px-3 py-2.5">
          <dt className="text-[11px] text-text-muted">当前方案</dt>
          <dd className="mt-0.5 truncate text-sm font-medium" title={currentPlan}>{currentPlan}</dd>
        </div>
      </dl>
      <div className="mt-3 flex overflow-x-auto rounded-lg border border-border/80 bg-surface">
        {compactSteps.map((step, index) => {
          const done = index < compactCurrentIndex;
          const currentCompact = index === compactCurrentIndex;
          const disabled = index > compactCurrentIndex;
          return (
            <button
              key={step.id}
              type="button"
              disabled={disabled}
              onClick={() => setExpandedStep(step.target)}
              className={cn(
                "flex min-w-[108px] flex-1 items-center gap-2 border-r border-border/70 px-3 py-2.5 text-left text-[12px] last:border-r-0",
                done && "text-success",
                currentCompact && "bg-interactive/[0.035] font-semibold text-text-primary",
                disabled && "cursor-not-allowed text-text-muted/55",
              )}
            >
              <span className={cn(
                "flex size-4 items-center justify-center rounded-full border text-[9px]",
                done && "border-success/30 bg-success/10",
                currentCompact && "border-interactive/30 bg-interactive/10 text-interactive",
                disabled && "border-border",
              )}>
                {done ? "✓" : currentCompact ? "●" : ""}
              </span>
              {step.label}
            </button>
          );
        })}
      </div>
      <ProcessStep
        id="governance"
        title="治理"
        status={stepStatus("governance")}
        summary={policyDone ? `处理资格：${policyModeLabel(currentPolicy!.decision.mode)}` : "等待选择候选并完成处理资格确认与人工治理"}
        owner={resolutionCase?.ownerRole ?? "待指定负责人"}
        result={governanceResult}
        expanded={expandedStep === "governance"}
        onToggle={() => setExpandedStep(expandedStep === "governance" ? "" : "governance")}
      >
        <div className="space-y-5">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-xs font-semibold text-text-muted">处理资格</h3>
              {currentPolicy && !currentPolicy.stale && <Badge variant="info">{policyModeLabel(currentPolicy.decision.mode)}</Badge>}
              {currentPolicy?.stale && <Badge variant="warning">处理资格已变化</Badge>}
            </div>
            {!selectedOptionId ? (
              <p className="mt-2 text-sm text-text-muted">请先在上方处置建议中选择一个治理候选。</p>
            ) : (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={mutations.policy.mutation.isPending}
                  onClick={() => {
                    if (!recommendation) return;
                    void requestAction(
                      "policy",
                      { recommendationId: recommendation.id, optionId: selectedOptionId },
                      governanceActionSuccessMessages.policy,
                    );
                  }}
                >
                  {mutations.policy.mutation.isPending ? "正在评估..." : currentPolicy ? "重新确认资格" : "确认处理资格"}
                </Button>
                {mutations.policy.mutation.error && <span className="text-xs text-danger">{invocationError(mutations.policy.mutation)}</span>}
              </div>
            )}
            {currentPolicy && (
              <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                <div><dt className="text-text-muted">处理方式</dt><dd className="mt-0.5 text-text-secondary">{policyModeLabel(currentPolicy.decision.mode)}</dd></div>
                <div><dt className="text-text-muted">审批角色</dt><dd className="mt-0.5 text-text-secondary">{currentPolicy.decision.requiredRoles.join("、") || "无"}</dd></div>
                <div><dt className="text-text-muted">候选动作</dt><dd className="mt-0.5 text-text-secondary">{actionLabels[currentPolicy.candidateActionType] ?? currentPolicy.candidateActionType}</dd></div>
              </dl>
            )}
            {currentPolicy?.decision.reasons.length ? (
              <ul className="mt-3 space-y-1 text-xs text-text-secondary">
                {currentPolicy.decision.reasons.map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
            ) : null}
            <p className="mt-3 text-xs text-text-muted">
              处理资格不代表方案已经完成审批或执行。
            </p>
          </div>

          <div className="border-t border-border pt-4">
            <h3 className="text-xs font-semibold text-text-muted">人工治理</h3>
            {resolutionCapabilities.canAccept.applicable ? (
              <div className="mt-3">
                <AcceptanceForm
                  ownership={resolutionCapabilities.canAccept}
                  ownerRoles={assignableOwnerRoles}
                  pending={mutations.accept.mutation.isPending}
                  error={invocationError(mutations.accept.mutation)}
                  onSubmit={(ownerRole, rationale) => {
                    if (!rationale) return;
                    void requestAction("accept", { ownerRole, rationale }, governanceActionSuccessMessages.accept);
                  }}
                />
              </div>
            ) : resolutionCapabilities.canReview.applicable && resolutionCase ? (
              <div className="mt-3">
                <ReviewForm
                  capability={resolutionCapabilities.canReview}
                  pending={mutations.review.mutation.isPending}
                  error={invocationError(mutations.review.mutation)}
                  onSubmit={(decision, rationale) => {
                    if (!rationale) return;
                    void requestAction(
                      "review",
                      { caseId: resolutionCase.id, decision, rationale },
                      governanceActionSuccessMessages.review,
                    );
                  }}
                />
              </div>
            ) : resolutionCapabilities.canPropose.applicable && resolutionCase ? (
              <div className="mt-3">
                <ProposalForm
                  recommendation={recommendation}
                  selectedOptionId={selectedOptionId}
                  capability={resolutionCapabilities.canPropose}
                  pending={mutations.propose.mutation.isPending}
                  error={invocationError(mutations.propose.mutation)}
                  onSubmit={(actions) => void requestAction(
                    "propose",
                    { caseId: resolutionCase.id, actions },
                    governanceActionSuccessMessages.propose,
                  )}
                />
              </div>
            ) : resolutionCase ? (
              <div className="mt-3 space-y-3">
                <ActionList resolution={resolutionCase} />
                <div className="flex flex-wrap items-center gap-3">
                  {resolutionCapabilities.canSubmit.applicable && (
                    <CapabilityButton
                      capability={resolutionCapabilities.canSubmit}
                      pending={mutations.submit.mutation.isPending}
                      pendingLabel="正在提交..."
                      onClick={() => void requestAction(
                        "submit",
                        { caseId: resolutionCase.id },
                        governanceActionSuccessMessages.submit,
                      )}
                    >
                      提交审批
                    </CapabilityButton>
                  )}
                  {approvalSubmitted && <Badge variant="warning">等待独立审批</Badge>}
                  {resolutionCase.status === "rejected" && <Badge variant="danger">治理已终止</Badge>}
                  {invocationError(mutations.submit.mutation) && <span className="text-xs text-danger">{invocationError(mutations.submit.mutation)}</span>}
                </div>
              </div>
            ) : (
              <InlineEmpty message="当前没有可执行的治理操作" />
            )}
          </div>
        </div>
      </ProcessStep>

      <ProcessStep
        id="approval"
        title="审批"
        status={stepStatus("approval")}
        summary="独立审批人确认已提交的治理方案"
        owner={approvalOwner}
        result={approvalResult}
        expanded={expandedStep === "approval"}
        onToggle={() => setExpandedStep(expandedStep === "approval" ? "" : "approval")}
      >
        {resolutionCapabilities.canApprove.applicable && resolutionCase ? (
          <div className="space-y-3">
            <p className="text-xs text-text-muted">
              复核人：{resolutionCase.review?.actor || "—"}；方案提出人：{resolutionCase.proposedBy || "—"}。复核人与方案提出人不能由同一人担任。
            </p>
            {mutations.approve.mutation.error && (
              <p className="border border-danger/25 bg-danger/5 px-3 py-2 text-xs text-danger">
                {invocationError(mutations.approve.mutation)}
              </p>
            )}
            <CapabilityButton
              capability={resolutionCapabilities.canApprove}
              pending={mutations.approve.mutation.isPending}
              pendingLabel="正在审批..."
              onClick={() => requestAction(
                "approve",
                { caseId: resolutionCase.id },
                governanceActionSuccessMessages.approve,
              )}
            >
              批准方案
            </CapabilityButton>
          </div>
        ) : approvalDone ? (
          <dl className="grid gap-2 text-xs sm:grid-cols-3">
            <div><dt className="text-text-muted">审批状态</dt><dd className="mt-0.5 text-success">已完成</dd></div>
            <div><dt className="text-text-muted">审批人</dt><dd className="mt-0.5">{approvalOwner}</dd></div>
            <div><dt className="text-text-muted">审批时间</dt><dd className="mt-0.5">{approvalEvent?.at ? formatShortDateTime(approvalEvent.at) : "未记录"}</dd></div>
          </dl>
        ) : (
          <InlineEmpty message="尚未进入审批步骤" />
        )}
      </ProcessStep>

      <ProcessStep
        id="execution"
        title="执行"
        status={stepStatus("execution")}
        summary="仅执行已批准方案，执行结果由系统登记"
        owner={resolutionCase?.ownerRole ?? "待指定执行主体"}
        result={executionDone ? "已执行" : "未执行"}
        expanded={expandedStep === "execution"}
        onToggle={() => setExpandedStep(expandedStep === "execution" ? "" : "execution")}
      >
        {resolutionCapabilities.canExecute.applicable && resolutionCase ? (
          <div className="space-y-3">
            <ActionList resolution={resolutionCase} />
            {mutations.execute.mutation.error && <p className="text-xs text-danger">{invocationError(mutations.execute.mutation)}</p>}
            <CapabilityButton
              capability={resolutionCapabilities.canExecute}
              pending={mutations.execute.mutation.isPending}
              pendingLabel="正在执行..."
              onClick={() => requestAction(
                "execute",
                { caseId: resolutionCase.id },
                governanceActionSuccessMessages.execute,
              )}
            >
              执行已批准方案
            </CapabilityButton>
          </div>
        ) : executionDone && resolutionCase ? (
          <ActionList resolution={resolutionCase} />
        ) : (
          <InlineEmpty message="尚无已批准方案可执行" />
        )}
      </ProcessStep>

      <ProcessStep
        id="receipt"
        title="回执"
        status={stepStatus("receipt")}
        summary="回执登记不等于治理结案"
        owner={receipts.length ? "内部台账回执" : "执行记录"}
        result={receipts.length ? `${receipts.length} 条回执` : "暂无回执"}
        expanded={expandedStep === "receipt"}
        onToggle={() => setExpandedStep(expandedStep === "receipt" ? "" : "receipt")}
      >
        {receipts.length ? (
          <div className="space-y-3">
            <div className="divide-y divide-border border-y border-border">
              {receipts.map((receipt) => {
                const action = resolutionCase?.runtime.actions.find((item) => item.id === receipt.actionId);
                return (
                  <div key={`${receipt.actionId}-${receipt.externalRequestId}`} className="grid gap-1 py-2 text-xs sm:grid-cols-[1fr_100px_140px]">
                    <span>{action ? `${actionTypeLabel(action.type)} · ${action.summary}` : "执行动作"}</span>
                    <Badge variant={receipt.status === "succeeded" ? "success" : "danger"}>
                      {receipt.status === "succeeded" ? "成功" : "失败"}
                    </Badge>
                    <span className="text-text-muted">{formatShortDateTime(receipt.createdAt)}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-text-muted">回执表示执行结果已登记，治理仍需核验后结案。</p>
          </div>
        ) : (
          <InlineEmpty message="暂无执行回执" />
        )}
        {resolutionCapabilities.canClose.applicable && resolutionCase && (
          <div className="mt-3 space-y-2">
            {mutations.close.mutation.error && <p className="text-xs text-danger">{invocationError(mutations.close.mutation)}</p>}
            <CapabilityButton
              capability={resolutionCapabilities.canClose}
              pending={mutations.close.mutation.isPending}
              pendingLabel="正在核验结案..."
              variant="outline"
              onClick={() => requestAction(
                "close",
                { caseId: resolutionCase.id },
                governanceActionSuccessMessages.close,
              )}
            >
              核验回执并结案
            </CapabilityButton>
          </div>
        )}
      </ProcessStep>

      <ProcessStep
        id="outcome"
        title="结果"
        status={stepStatus("outcome")}
        summary="后续业务状态测量"
        owner={latestOutcome ? "结果测量" : "待测量"}
        result={latestOutcome ? "已有后续测量" : "暂无结果"}
        expanded={expandedStep === "outcome"}
        onToggle={() => setExpandedStep(expandedStep === "outcome" ? "" : "outcome")}
      >
        {latestOutcome ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-text-secondary">最新测量</span>
              <OutcomeStatusBadge status={latestOutcome.status} />
              <Badge>结果测量证据</Badge>
            </div>
            <p className="text-sm">
              基准{metricLabel(latestOutcome.baseline.metricKey)} = {String(latestOutcome.baseline.value)}；{fieldLabel(latestOutcome.current.field)} = {String(latestOutcome.current.value ?? "—")}；目标 = {String(latestOutcome.targetValue)}
            </p>
            <p className="text-xs text-text-muted">测量时间：{formatShortDateTime(latestOutcome.evaluatedAt)}</p>
            <p className="text-xs text-text-muted">该测量用于观察后续业务状态，不代表前序动作直接导致结果变化。</p>
            {historicalOutcomes.length > 0 && (
              <details className="border-t border-border pt-3">
                <summary className="cursor-pointer text-xs font-medium text-text-secondary">
                  历史测量 {historicalOutcomes.length}
                </summary>
                <div className="mt-2 divide-y divide-border border-y border-border">
                  {historicalOutcomes.map((outcome) => (
                    <div key={outcome.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                      <span>{outcomeStatusLabel(outcome.status)}</span>
                      <span className="text-text-muted">{formatShortDateTime(outcome.evaluatedAt)}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
            {resolutionCase?.status === "closed" && <p className="text-xs text-warning">治理流程已结案，业务结果仍需以后续测量为准。</p>}
          </div>
        ) : (
          <div className="space-y-2">
            <InlineEmpty message="暂无业务结果测量" />
            {resolutionCase?.status === "closed" && <p className="text-xs text-warning">治理流程已结案，业务结果仍需以后续测量为准。</p>}
          </div>
        )}
      </ProcessStep>
    </section>
  );
}
