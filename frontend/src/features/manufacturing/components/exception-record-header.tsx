import { ChevronDown, ChevronLeft } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { SeverityBadge } from "../../../components/product/status-badge.js";
import { Badge } from "../../../components/ui/badge.js";
import { Button } from "../../../components/ui/button.js";
import { useResolutionCapabilities, useResolutionProcess } from "../../../hooks/use-manufacturing.js";
import type { CapabilityDecisionView } from "../analysis-types.js";
import { governanceStageFromStatus, governanceStageLabel } from "../exception-queue.js";
import { isResolutionApprovalSubmitted } from "../governance-step.js";
import { governanceErrorMessage } from "../governance-errors.js";
import {
  governanceActionSuccessMessages,
  useGovernanceActionController,
} from "../governance-action-controller.js";
import { exceptionStatusLabel, formatMetricValue, metricLabel } from "../utils.js";
import type { ExceptionView, WorkbenchView } from "../types.js";
import { ExceptionDetailsSheet } from "./exception-details-sheet.js";

type PrimaryAction =
  | { kind: "navigate"; label: string; capability: CapabilityDecisionView }
  | {
    kind: "mutation";
    mutation: "submit" | "approve" | "execute" | "close";
    label: string;
    pendingLabel: string;
    capability: CapabilityDecisionView;
  };

export function ExceptionRecordHeader({
  exception,
  contextId,
  context,
  showPrimaryAction = true,
}: {
  exception: ExceptionView;
  contextId: string;
  context: WorkbenchView["context"];
  showPrimaryAction?: boolean;
}) {
  const capabilities = useResolutionCapabilities(contextId, exception.id);
  const resolution = useResolutionProcess(contextId, exception.id);
  const [searchParams] = useSearchParams();
  const { mutations, requestAction } = useGovernanceActionController();
  const caps = capabilities.data?.resolutionCapabilities;
  const resolutionCase = resolution.detail.data?.resolutionCase;
  const metrics = Object.entries(exception.metrics ?? {}).slice(0, 3);
  const currentStage = resolutionCase
    ? resolutionCase.status === "proposed"
      ? isResolutionApprovalSubmitted(resolutionCase) ? "approval" : "propose"
      : governanceStageFromStatus(resolutionCase.status)
    : "accept";
  const governanceHref = `/manufacturing/${encodeURIComponent(contextId)}/exceptions/${encodeURIComponent(exception.id)}/governance`;
  const queueHref = `/manufacturing/${encodeURIComponent(contextId)}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
  const primary: PrimaryAction | undefined = caps ? [
    caps.canAccept.applicable && { kind: "navigate" as const, label: "进入治理", capability: caps.canAccept },
    caps.canReview.applicable && { kind: "navigate" as const, label: "进入治理", capability: caps.canReview },
    caps.canPropose.applicable && { kind: "navigate" as const, label: "进入治理", capability: caps.canPropose },
    caps.canSubmit.applicable && {
      kind: "mutation" as const,
      mutation: "submit" as const,
      label: "提交审批",
      pendingLabel: "正在提交...",
      capability: caps.canSubmit,
    },
    caps.canApprove.applicable && {
      kind: "mutation" as const,
      mutation: "approve" as const,
      label: "批准方案",
      pendingLabel: "正在审批...",
      capability: caps.canApprove,
    },
    caps.canExecute.applicable && {
      kind: "mutation" as const,
      mutation: "execute" as const,
      label: "执行方案",
      pendingLabel: "正在执行...",
      capability: caps.canExecute,
    },
    caps.canClose.applicable && {
      kind: "mutation" as const,
      mutation: "close" as const,
      label: "核验并结案",
      pendingLabel: "正在核验...",
      capability: caps.canClose,
    },
  ].find(Boolean) as PrimaryAction | undefined : undefined;

  const runPrimary = () => {
    if (!primary) return;
    if (primary.kind === "navigate") return;
    const caseId = resolutionCase?.id;
    if (!caseId) return;
    requestAction(primary.mutation, { caseId }, governanceActionSuccessMessages[primary.mutation]);
  };
  const mutationError = primary?.kind === "mutation" ? mutations[primary.mutation].mutation.error : undefined;
  const pending = primary?.kind === "mutation" && mutations[primary.mutation].mutation.isPending;

  return (
    <header data-testid="selected-exception-header" className="border-b border-border bg-surface">
      <div className="px-4 py-3 lg:px-5">
        <Link
          to={queueHref}
          className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-interactive"
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          返回 {context.businessKey} 异常队列
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{exception.label}</h1>
              <SeverityBadge severity={exception.severity} />
              <Badge>{exceptionStatusLabel(exception.status)}</Badge>
            </div>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-text-muted">
              {metrics.map(([key, value]) => (
                <span key={key}>
                  {metricLabel(key)} <strong className="font-semibold text-text-primary">{formatMetricValue(value)}</strong>
                </span>
              ))}
              <span>
                当前阶段 <strong className="font-semibold text-text-secondary">{governanceStageLabel(currentStage)}</strong>
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {capabilities.isLoading && <span className="text-xs text-text-muted">正在读取操作能力</span>}
            {capabilities.isError && <span className="text-xs text-warning">操作能力暂不可用</span>}
            {primary && showPrimaryAction && (
              primary.kind === "navigate" ? (
                <Button asChild disabled={!primary.capability.allowed}>
                  <Link to={governanceHref}>{primary.label}</Link>
                </Button>
              ) : (
                <Button
                  disabled={!primary.capability.allowed || !resolutionCase || Boolean(pending)}
                  onClick={runPrimary}
                >
                  {pending ? primary.pendingLabel : primary.label}
                </Button>
              )
            )}
            <details className="relative">
              <summary className="flex h-9 cursor-pointer list-none items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium text-text-secondary hover:bg-surface-muted [&::-webkit-details-marker]:hidden">
                更多
                <ChevronDown className="size-3.5" aria-hidden="true" />
              </summary>
              <div className="absolute right-0 top-10 z-30 w-48 border border-border bg-surface p-1.5 shadow-sm">
                <div className="px-1 py-1">
                  <ExceptionDetailsSheet contextId={contextId} exception={exception} context={context} />
                </div>
              </div>
            </details>
          </div>
        </div>
        {primary && !primary.capability.allowed && (
          <p className="mt-2 text-xs text-warning">{primary.capability.reason}</p>
        )}
        {mutationError && <p className="mt-2 text-xs text-danger">{governanceErrorMessage(mutationError)}</p>}
      </div>
    </header>
  );
}
