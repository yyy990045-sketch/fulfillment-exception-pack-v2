export type DecisionRecommendationStatus = "generated" | "rejected";
export type DecisionDispositionDecision = "accepted" | "modified" | "rejected";

export type DecisionRecommendationRecord = {
  id: string;
  tenantId: string;
  contextId: string;
  exceptionId: string;
  ruleEvaluationId: string;
  inputSnapshotHash: string;
  provider: string;
  model: string;
  status: DecisionRecommendationStatus;
  output: unknown;
  validation: unknown;
  historySnapshot: unknown;
  eligibility: unknown;
  createdBy: string;
  createdAt: string;
};

export type DecisionRecommendationDisposition = {
  id: string;
  tenantId: string;
  recommendationId: string;
  exceptionId: string;
  decision: DecisionDispositionDecision;
  selectedOptionId?: string;
  rationale: string;
  actor: string;
  createdAt: string;
};
