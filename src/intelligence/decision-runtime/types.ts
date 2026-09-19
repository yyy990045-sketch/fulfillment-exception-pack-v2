import type { DecisionRuntimeCallRecord } from "../../domain/v2/index.js";

export type DecisionConfidenceKind =
  | "deterministic"
  | "provider_reported_calibrated"
  | "self_reported"
  | "probability_only"
  | "none";

export type DecisionQuestion =
  | {
      id: string;
      type: "boolean";
      instructions: string;
      criteria?: { true: string; false: string };
    }
  | {
      id: string;
      type: "choice";
      instructions: string;
      criteria: Record<string, string>;
    }
  | {
      id: string;
      type: "score";
      instructions: string;
      criteria: string[];
    };

export type BooleanDecisionAnswer = {
  questionId: string;
  type: "boolean";
  value: boolean;
  probabilityYes: number | null;
  confidence: number | null;
  confidenceKind: DecisionConfidenceKind;
};

export type ChoiceDecisionAnswer = {
  questionId: string;
  type: "choice";
  choice: string;
  probabilities: Record<string, number> | null;
  confidence: number | null;
  confidenceKind: DecisionConfidenceKind;
};

export type ScoreDecisionAnswer = {
  questionId: string;
  type: "score";
  score: number;
  legend: string | null;
  probabilities: number[] | null;
  confidence: number | null;
  confidenceKind: DecisionConfidenceKind;
};

export type DecisionAnswer = BooleanDecisionAnswer | ChoiceDecisionAnswer | ScoreDecisionAnswer;

export type DecisionRequest = {
  taskId: string;
  state: unknown;
  questions: DecisionQuestion[];
};

export type DecisionBatchResult = {
  provider: string;
  model: string;
  answers: DecisionAnswer[];
  usage?: Record<string, unknown>;
  providerRequestId?: string;
};

export interface DecisionRuntimeProvider {
  name: string;
  model: string;
  evaluateBatch(request: DecisionRequest): Promise<DecisionBatchResult>;
}

export type DecisionRuntimeAuditContext = {
  tenantId: string;
  actor: string;
};

export type DecisionRuntimeCallView = DecisionRuntimeCallRecord;

export class DecisionRuntimeError extends Error {
  constructor(public readonly code: string, public readonly status = 502) {
    super(code);
    this.name = "DecisionRuntimeError";
  }
}
