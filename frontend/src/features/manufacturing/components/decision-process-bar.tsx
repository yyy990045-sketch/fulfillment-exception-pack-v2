import { Check, Circle, LoaderCircle } from "lucide-react";
import { cn } from "../../../lib/utils.js";
import { useDecisionRecommendation, useResolutionProcess } from "../../../hooks/use-manufacturing.js";
import { governanceSteps, governanceStepStatus, resolveGovernanceStep } from "../governance-step.js";

export function DecisionProcessBar({
  contextId,
  exceptionId,
}: {
  contextId: string;
  exceptionId: string;
}) {
  const decision = useDecisionRecommendation(contextId, exceptionId);
  const resolution = useResolutionProcess(contextId, exceptionId);
  const resolutionCase = resolution.detail.data?.resolutionCase;
  const hasRecommendation = Boolean(decision.detail.data);
  const current = resolveGovernanceStep(resolutionCase, hasRecommendation);
  const currentLabel = governanceSteps.find((step) => step.id === current)?.label ?? "治理";

  return (
    <div
      data-testid="decision-process-bar"
      data-current-step={current}
      className="overflow-x-auto border-b border-border bg-surface-muted/50 px-3 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-text-secondary">当前步骤：{currentLabel}</span>
        <span className="text-xs text-text-muted">建议 → 治理 → 审批 → 执行 → 回执 → 结果</span>
      </div>
      <ol className="mt-2.5 grid min-w-[760px] grid-cols-6" aria-label="治理流程">
        {governanceSteps.map((step) => {
          const status = governanceStepStatus(step.id, current, { rejected: resolutionCase?.status === "rejected" });
          const Icon = status === "done" ? Check : status === "current" ? LoaderCircle : Circle;
          return (
            <li
              key={step.id}
              aria-current={status === "current" ? "step" : undefined}
              className={cn(
                "flex items-center gap-2 border-l border-border px-3 first:border-l-0",
                status === "current" && "text-interactive",
                status === "done" && "text-success",
                status === "pending" && "text-text-muted",
                status === "error" && "text-danger",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="text-sm font-medium">{step.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
