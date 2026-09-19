import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { recordWidthClass } from "../../../components/product/page-layout.js";
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
import { exceptionStatusLabel, formatBusinessValue, formatMetricValue, metricLabel } from "../utils.js";
import type { ExceptionView, ThreadStage, WorkbenchView } from "../types.js";
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
  stages,
  showPrimaryAction = true,
}: {
  exception: ExceptionView;
  contextId: string;
  context: WorkbenchView["context"];
  stages: ThreadStage[];
  showPrimaryAction?: boolean;
}) {
  const capabilities = useResolutionCapabilities(contextId, exception.id);
  const resolution = useResolutionProcess(contextId, exception.id);
  const [searchParams] = useSearchParams();
  const { mutations, requestAction } = useGovernanceActionController();
  const caps = capabilities.data?.resolutionCapabilities;
  const resolutionCase = resolution.detail.data?.resolutionCase;
  const metrics = Object.entries(exception.metrics ?? {}).slice(0, 3);
  const relatedStages = exception.stageKeys.flatMap((key) => {
    const stage = stages.find((item) => item.key === key);
    return stage ? [stage] : [];
  });
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
      <div className={`${recordWidthClass} py-4`}>
        <Link
          to={queueHref}
          className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-interactive"
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          返回 {context.businessKey} 异常队列
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[23px] font-semibold leading-8">{exception.label}</h1>
              <SeverityBadge severity={exception.severity} className="px-1.5 py-0 text-[10px]" />
              <Badge>{exceptionStatusLabel(exception.status)}</Badge>
            </div>
            <dl className="mt-3 grid max-w-3xl grid-cols-2 gap-px overflow-hidden rounded-lg border border-border/80 bg-border/70 sm:grid-cols-4">
              {metrics.map(([key, value]) => (
                <div key={key} className="bg-surface px-3 py-2.5">
                  <dt className="text-[11px] text-text-muted">{metricLabel(key)}</dt>
                  <dd className="mt-1 text-[20px] font-semibold leading-7 tabular-nums">{formatMetricValue(value)}</dd>
                </div>
              ))}
              <div className="bg-surface px-3 py-2.5">
                <dt className="text-[11px] text-text-muted">当前阶段</dt>
                <dd className="mt-1 text-[15px] font-semibold leading-6 text-text-secondary">{governanceStageLabel(currentStage)}</dd>
              </div>
            </dl>
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
              <summary className="flex h-9 cursor-pointer list-none items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium text-text-secondary hover:bg-surface-subtle [&::-webkit-details-marker]:hidden">
                更多
                <ChevronDown className="size-3.5" aria-hidden="true" />
              </summary>
              <div className="absolute right-0 top-10 z-30 w-48 rounded-lg border border-border bg-surface p-1.5 shadow-popover">
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
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/70 pt-2.5">
          <span className="text-[11px] font-medium text-text-muted">相关链路</span>
          {relatedStages.map((stage, index) => {
            const fact = stage.facts[0];
            return (
              <span key={stage.key} className="inline-flex items-center gap-2 text-[12px] text-text-secondary">
                {index > 0 && <ChevronRight className="size-3.5 text-text-muted" aria-hidden="true" />}
                <span>{stage.label}</span>
                {fact && <strong className="font-semibold text-text-primary">{formatBusinessValue(fact)}</strong>}
              </span>
            );
          })}
          <Link
            to={`/manufacturing/${encodeURIComponent(contextId)}?stageKey=${encodeURIComponent(exception.stageKeys[0] ?? "")}`}
            className="ml-auto text-[11px] font-medium text-interactive hover:underline"
          >
            查看完整履约链路 →
          </Link>
        </div>
      </div>
    </header>
  );
}
