export type DecisionRuntimeCallStatus = "succeeded" | "failed" | "abstained";

export type DecisionRuntimeCallRecord = {
  tenantId: string;
  id: string;
  taskId: string;
  provider: string;
  model: string;
  stateHash: string;
  questionHash: string;
  answer: unknown;
  latencyMs: number;
  usage?: Record<string, unknown>;
  status: DecisionRuntimeCallStatus;
  errorCode?: string;
  createdBy: string;
  createdAt: string;
};
