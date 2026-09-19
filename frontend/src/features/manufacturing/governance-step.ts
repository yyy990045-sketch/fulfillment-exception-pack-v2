import type { ResolutionCaseView } from "./analysis-types.js";

export type GovernanceStepId = "recommendation" | "governance" | "approval" | "execution" | "receipt" | "outcome";

export const governanceSteps: Array<{ id: GovernanceStepId; label: string }> = [
  { id: "recommendation", label: "建议" },
  { id: "governance", label: "治理" },
  { id: "approval", label: "审批" },
  { id: "execution", label: "执行" },
  { id: "receipt", label: "回执" },
  { id: "outcome", label: "结果" },
];

export function isResolutionApprovalSubmitted(resolution: ResolutionCaseView | undefined) {
  return Boolean(
    resolution?.status === "proposed" &&
    resolution.runtime.actions.length > 0 &&
    resolution.runtime.actions.every((action) => action.status === "pending_approval"),
  );
}

export function resolveGovernanceStep(
  resolution: ResolutionCaseView | undefined,
  hasRecommendation: boolean,
): GovernanceStepId {
  if (!hasRecommendation) return "recommendation";
  if (!resolution) return "governance";
  if (resolution.status === "triaged" || resolution.status === "confirmed" || resolution.status === "rejected") return "governance";
  if (resolution.status === "proposed") {
    return isResolutionApprovalSubmitted(resolution) ? "approval" : "governance";
  }
  if (resolution.status === "approved") return "execution";
  if (resolution.status === "executed") return "receipt";
  return "outcome";
}

export function governanceStageToStep(stage: string): GovernanceStepId {
  if (stage === "review" || stage === "proposal" || stage === "proposal_draft") return "governance";
  if (stage === "pending_approval") return "approval";
  if (stage === "approved") return "execution";
  if (stage === "executed") return "receipt";
  if (stage === "closed") return "outcome";
  if (stage === "rejected") return "governance";
  return "governance";
}

export function governanceStageToCompactStep(stage: string) {
  if (stage === "review") return "review";
  if (stage === "proposal" || stage === "proposal_draft" || stage === "rejected") return "propose";
  if (stage === "pending_approval") return "approval";
  if (stage === "approved") return "execution";
  if (stage === "executed") return "receipt";
  if (stage === "closed") return "outcome";
  return "accept";
}

export function governanceStepStatus(
  step: GovernanceStepId,
  current: GovernanceStepId,
  options: { rejected?: boolean } = {},
) {
  if (step === current) return options.rejected && step === "governance" ? "error" as const : "current" as const;
  const stepIndex = governanceSteps.findIndex((item) => item.id === step);
  const currentIndex = governanceSteps.findIndex((item) => item.id === current);
  return stepIndex < currentIndex ? "done" as const : "pending" as const;
}
