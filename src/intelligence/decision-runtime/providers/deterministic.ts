import {
  DecisionRuntimeError,
  type DecisionAnswer,
  type DecisionBatchResult,
  type DecisionQuestion,
  type DecisionRequest,
  type DecisionRuntimeProvider,
} from "../types.js";

export type DeterministicResolver = (request: DecisionRequest, question: DecisionQuestion) => DecisionAnswer;

export class DeterministicDecisionProvider implements DecisionRuntimeProvider {
  readonly name = "deterministic";
  readonly model = "deterministic-decision-v1";

  constructor(private readonly config: { resolvers: Record<string, DeterministicResolver> }) {}

  async evaluateBatch(request: DecisionRequest): Promise<DecisionBatchResult> {
    const resolver = this.config.resolvers[request.taskId];
    if (!resolver) throw new DecisionRuntimeError("DECISION_TASK_NOT_SUPPORTED", 422);
    return {
      provider: this.name,
      model: this.model,
      answers: request.questions.map((question) => resolver(request, question)),
    };
  }
}

export function deterministicBoolean(questionId: string, value: boolean): DecisionAnswer {
  return {
    questionId,
    type: "boolean",
    value,
    probabilityYes: value ? 1 : 0,
    confidence: 1,
    confidenceKind: "deterministic",
  };
}

export function deterministicChoice(questionId: string, choice: string, criteria: Record<string, string>): DecisionAnswer {
  return {
    questionId,
    type: "choice",
    choice,
    probabilities: Object.fromEntries(Object.keys(criteria).map((key) => [key, key === choice ? 1 : 0])),
    confidence: 1,
    confidenceKind: "deterministic",
  };
}

export function deterministicScore(questionId: string, score: number, criteria: string[]): DecisionAnswer {
  return {
    questionId,
    type: "score",
    score,
    legend: criteria[score] ?? null,
    probabilities: criteria.map((_, index) => index === score ? 1 : 0),
    confidence: 1,
    confidenceKind: "deterministic",
  };
}
