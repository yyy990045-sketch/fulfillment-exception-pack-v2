export type GroundedExplanationStatus = "generated" | "rejected";

export type GroundedExplanationRecord = {
  id: string;
  tenantId: string;
  contextId: string;
  exceptionId: string;
  ruleEvaluationId: string;
  inputSnapshotHash: string;
  provider: string;
  model: string;
  status: GroundedExplanationStatus;
  output: unknown;
  validation: unknown;
  createdBy: string;
  createdAt: string;
};
