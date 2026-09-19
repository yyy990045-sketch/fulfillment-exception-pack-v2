import { ChevronDown } from "lucide-react";
import { SeverityBadge } from "../../../components/product/status-badge.js";
import { Badge } from "../../../components/ui/badge.js";
import { Button } from "../../../components/ui/button.js";
import { useGovernanceMutations, useResolutionCapabilities, useResolutionProcess } from "../../../hooks/use-manufacturing.js";
import type { CapabilityDecisionView } from "../analysis-types.js";
import { governanceErrorMessage } from "../governance-errors.js";
import { exceptionStatusLabel, formatMetricValue, metricLabel } from "../utils.js";
import type { ExceptionView, WorkbenchView } from "../types.js";
import { ExceptionDetailsSheet } from "./exception-details-sheet.js";

type PrimaryAction =
  | { kind: "navigate"; tab: "decision"; label: string; capability: CapabilityDecisionView }
  | { kind: "mutation"; mutation: "submit" | "approve" | "execute" | "close"; label: string; pendingLabel: string; capability: CapabilityDecisionView };

export function SelectedExceptionHeader({
  exception,
  contextId,
  context,
  onNavigateTab,
}: {
  exception: ExceptionView;
  contextId: string;
  context: WorkbenchView["context"];
  onNavigateTab: (tab: "overview" | "evidence" | "analysis" | "decision") => void;
}) {
  const capabilities = useResolutionCapabilities(contextId, exception.id);
  const resolution = useResolutionProcess(contextId, exception.id);
  const mutations = useGovernanceMutations(contextId, exception.id);
  const caps = capabilities.data?.resolutionCapabilities;
  const metrics = Object.entries(exception.metrics ?? {}).slice(0, 3);
  const primary: PrimaryAction | undefined = caps ? [
    caps.canAccept.applicable && { kind: "navigate" as const, tab: "decision" as const, label: "进入治理", capability: caps.canAccept },
    caps.canReview.applicable && { kind: "navigate" as const, tab: "decision" as const, label: "提交复核", capability: caps.canReview },
    caps.canPropose.applicable && { kind: "navigate" as const, tab: "decision" as const, label: "拟定方案", capability: caps.canPropose },
    caps.canSubmit.applicable && { kind: "mutation" as const, mutation: "submit" as const, label: "提交审批", pendingLabel: "正在提交...", capability: caps.canSubmit },
    caps.canApprove.applicable && { kind: "mutation" as const, mutation: "approve" as const, label: "批准方案", pendingLabel: "正在审批...", capability: caps.canApprove },
    caps.canExecute.applicable && { kind: "mutation" as const, mutation: "execute" as const, label: "执行方案", pendingLabel: "正在执行...", capability: caps.canExecute },
    caps.canClose.applicable && { kind: "mutation" as const, mutation: "close" as const, label: "核验并结案", pendingLabel: "正在核验...", capability: caps.canClose },
  ].find(Boolean) as PrimaryAction | undefined : undefined;

  const runPrimary = () => {
    if (!primary || !caps) return;
    if (primary.kind === "navigate") {
      onNavigateTab(primary.tab);
      return;
    }
    const caseId = resolution.detail.data?.resolutionCase.id;
    if (!caseId) return;
    const mutation = mutations[primary.mutation];
    if (primary.mutation === "submit" || primary.mutation === "approve" || primary.mutation === "execute" || primary.mutation === "close") {
      void mutation.run({ caseId });
    }
  };
  const mutationError = primary?.kind === "mutation"
    ? mutations[primary.mutation].mutation.error
    : undefined;
  const mutationReady = primary?.kind !== "mutation" || Boolean(resolution.detail.data?.resolutionCase.id);

  return (
    <header data-testid="selected-exception-header" className="min-h-[86px] border-b border-border px-4 py-3 lg:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">{exception.label}</h2>
            <SeverityBadge severity={exception.severity} />
            <Badge>{exceptionStatusLabel(exception.status)}</Badge>
          </div>
          {metrics.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-text-muted">
              {metrics.map(([key, value]) => (
                <span key={key}>
                  {metricLabel(key)} <strong className="font-semibold text-text-primary">{formatMetricValue(value)}</strong>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {capabilities.isLoading && <span className="text-xs text-text-muted">正在读取操作能力</span>}
          {capabilities.isError && <span className="text-xs text-warning">操作能力暂不可用</span>}
          {primary && (
            <Button
              disabled={!primary.capability.allowed || !mutationReady || primary.kind === "mutation" && mutations[primary.mutation].mutation.isPending}
              onClick={runPrimary}
            >
              {primary.kind === "mutation" && mutations[primary.mutation].mutation.isPending
                ? primary.pendingLabel
                : primary.label}
            </Button>
          )}
          <details className="relative">
            <summary className="flex h-9 cursor-pointer list-none items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium text-text-secondary hover:bg-surface-muted [&::-webkit-details-marker]:hidden">
              更多
              <ChevronDown className="size-3.5" aria-hidden="true" />
            </summary>
            <div className="absolute right-0 top-10 z-30 w-48 border border-border bg-surface p-1.5 shadow-sm">
              <button type="button" className="block w-full px-2 py-2 text-left text-xs hover:bg-surface-muted" onClick={() => onNavigateTab("overview")}>查看概览</button>
              <button type="button" className="block w-full px-2 py-2 text-left text-xs hover:bg-surface-muted" onClick={() => onNavigateTab("evidence")}>查看证据</button>
              <button type="button" className="block w-full px-2 py-2 text-left text-xs hover:bg-surface-muted" onClick={() => onNavigateTab("analysis")}>查看分析</button>
              <button type="button" className="block w-full px-2 py-2 text-left text-xs hover:bg-surface-muted" onClick={() => onNavigateTab("decision")}>进入治理</button>
              <div className="mt-1 border-t border-border pt-1">
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
    </header>
  );
}
