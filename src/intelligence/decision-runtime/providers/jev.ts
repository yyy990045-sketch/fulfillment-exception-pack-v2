import {
  DecisionRuntimeError,
  type DecisionAnswer,
  type DecisionBatchResult,
  type DecisionQuestion,
  type DecisionRequest,
  type DecisionRuntimeProvider,
} from "../types.js";
import { validateDecisionAnswers, validateProbability } from "../validation.js";

export type JevFetch = typeof fetch;

function requestQuestion(question: DecisionQuestion) {
  return question.type === "boolean"
    ? { type: "noul", instructions: question.instructions, criteria: question.criteria }
    : question.type === "choice"
      ? { type: "choice", instructions: question.instructions, criteria: question.criteria }
      : { type: "score", instructions: question.instructions, criteria: question.criteria };
}

function requestQuestionMap(questions: DecisionQuestion[]) {
  const result: Record<string, ReturnType<typeof requestQuestion>> = {};
  for (const question of questions) {
    if (result[question.id]) throw new DecisionRuntimeError("DECISION_PROVIDER_INVALID_RESPONSE:duplicate_question_id");
    result[question.id] = requestQuestion(question);
  }
  return result;
}

function statusError(status: number) {
  if (status === 401) return new DecisionRuntimeError("DECISION_PROVIDER_AUTH_FAILED", 401);
  if (status === 403) return new DecisionRuntimeError("DECISION_PROVIDER_ACCESS_BLOCKED", 403);
  if (status === 429) return new DecisionRuntimeError("DECISION_PROVIDER_RATE_LIMITED", 429);
  if (status >= 500) return new DecisionRuntimeError("DECISION_PROVIDER_FAILURE", 502);
  return new DecisionRuntimeError("DECISION_PROVIDER_INVALID_RESPONSE", 502);
}

function confidence(value: unknown, path: string): number | null {
  if (value === null || value === undefined) return null;
  return validateProbability(value, path);
}

function scoreProbabilities(value: unknown, levelCount: number, path: string): number[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DecisionRuntimeError(`DECISION_PROVIDER_INVALID_RESPONSE:${path}`);
  }
  const record = value as Record<string, unknown>;
  const keys = Array.from({ length: levelCount }, (_, index) => String(index));
  const actualKeys = Object.keys(record);
  if (actualKeys.length !== keys.length || keys.some((key) => !actualKeys.includes(key))) {
    throw new DecisionRuntimeError(`DECISION_PROVIDER_INVALID_RESPONSE:${path}.keys`);
  }
  const probabilities = keys.map((key) => validateProbability(record[key], `${path}.${key}`));
  const sum = probabilities.reduce((total, item) => total + item, 0);
  if (sum < 0.98 || sum > 1.02) throw new DecisionRuntimeError(`DECISION_PROVIDER_INVALID_RESPONSE:${path}.sum`);
  return probabilities;
}

function expectedAnswerType(question: DecisionQuestion) {
  return question.type === "boolean" ? "noul" : question.type;
}

function mapAnswer(question: DecisionQuestion, value: Record<string, unknown>): DecisionAnswer {
  if (value.type !== expectedAnswerType(question)) {
    throw new DecisionRuntimeError(`DECISION_PROVIDER_INVALID_RESPONSE:${question.id}.type`);
  }
  if (question.type === "boolean") {
    const noul = value.noul;
    if (typeof noul !== "number" || noul < 0 || noul > 1) throw new DecisionRuntimeError("DECISION_PROVIDER_INVALID_RESPONSE:noul");
    return {
      questionId: question.id,
      type: "boolean",
      value: noul >= 0.5,
      probabilityYes: noul,
      confidence: null,
      confidenceKind: "probability_only",
    };
  }
  if (question.type === "choice") {
    if (typeof value.choice !== "string") throw new DecisionRuntimeError(`DECISION_PROVIDER_INVALID_RESPONSE:${question.id}.choice`);
    return {
      questionId: question.id,
      type: "choice",
      choice: value.choice,
      probabilities: value.probabilities as Record<string, number> | null,
      confidence: confidence(value.confidence, `${question.id}.confidence`),
      confidenceKind: "provider_reported_calibrated",
    };
  }
  const score = value.score;
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > question.criteria.length - 1) {
    throw new DecisionRuntimeError(`DECISION_PROVIDER_INVALID_RESPONSE:${question.id}.score`);
  }
  return {
    questionId: question.id,
    type: "score",
    score,
    legend: Number.isInteger(score) ? question.criteria[score] ?? null : null,
    probabilities: scoreProbabilities(value.probabilities, question.criteria.length, `${question.id}.probabilities`),
    confidence: confidence(value.confidence, `${question.id}.confidence`),
    confidenceKind: "provider_reported_calibrated",
  };
}

export class JevDecisionRuntimeProvider implements DecisionRuntimeProvider {
  readonly name = "jev";
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: JevFetch;

  constructor(config: {
    apiKey: string;
    model: string;
    baseUrl?: string;
    timeoutMs?: number;
    fetchImpl?: JevFetch;
  }) {
    if (!config.apiKey.trim() || !config.model.trim()) throw new DecisionRuntimeError("DECISION_PROVIDER_NOT_CONFIGURED", 503);
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.baseUrl = (config.baseUrl ?? "https://api.typesafe.ai").replace(/\/$/, "");
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async evaluateBatch(request: DecisionRequest): Promise<DecisionBatchResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/v1/systemone`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          state: request.state,
          model: this.model,
          questions: requestQuestionMap(request.questions),
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw statusError(response.status);
      const body = await response.json() as Record<string, unknown>;
      const rawAnswers = body.answers;
      if (!rawAnswers || typeof rawAnswers !== "object" || Array.isArray(rawAnswers)) {
        throw new DecisionRuntimeError("DECISION_PROVIDER_INVALID_RESPONSE:answers");
      }
      const answerRecord = rawAnswers as Record<string, unknown>;
      const expectedIds = request.questions.map((question) => question.id);
      const actualIds = Object.keys(answerRecord);
      if (actualIds.length !== expectedIds.length || expectedIds.some((id) => !actualIds.includes(id))) {
        throw new DecisionRuntimeError("DECISION_PROVIDER_INVALID_RESPONSE:answers.keys");
      }
      const answers = request.questions.map((question) => {
        const item = answerRecord[question.id];
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          throw new DecisionRuntimeError(`DECISION_PROVIDER_INVALID_RESPONSE:answers.${question.id}`);
        }
        return mapAnswer(question, item as Record<string, unknown>);
      });
      return {
        provider: this.name,
        model: this.model,
        answers: validateDecisionAnswers(request.questions, answers),
        ...(body.usage && typeof body.usage === "object" ? { usage: body.usage as Record<string, unknown> } : {}),
        ...(typeof body.requestId === "string" ? { providerRequestId: body.requestId } : {}),
      };
    } catch (error) {
      if (error instanceof DecisionRuntimeError) throw error;
      if (controller.signal.aborted) throw new DecisionRuntimeError("DECISION_PROVIDER_TIMEOUT", 504);
      throw new DecisionRuntimeError("DECISION_PROVIDER_FAILURE", 502);
    } finally {
      clearTimeout(timeout);
    }
  }
}
