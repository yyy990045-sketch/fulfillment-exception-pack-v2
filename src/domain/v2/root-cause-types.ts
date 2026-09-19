export type RootCauseAnalysisStatus = "generated" | "rejected";
export type RootCauseReviewDecision = "investigate" | "needs_evidence" | "rejected";

export type RootCauseAnalysisRecord = {
  id: string;
  tenantId: string;
  contextId: string;
  exceptionId: string;
  ruleEvaluationId: string;
  inputSnapshotHash: string;
  provider: string;
  model: string;
  status: RootCauseAnalysisStatus;
  output: unknown;
  validation: unknown;
  createdBy: string;
  createdAt: string;
};

export type RootCauseHypothesisReview = {
  id: string;
  tenantId: string;
  analysisId: string;
  hypothesisId: string;
  exceptionId: string;
  decision: RootCauseReviewDecision;
  rationale: string;
  actor: string;
  createdAt: string;
};
