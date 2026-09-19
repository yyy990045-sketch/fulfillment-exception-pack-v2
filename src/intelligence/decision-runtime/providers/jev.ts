import {
  DecisionRuntimeError,
  type DecisionAnswer,
  type DecisionBatchResult,
  type DecisionQuestion,
  type DecisionRequest,
  type DecisionRuntimeProvider,
} from "../types.js";
import { validateDecisionAnswers } from "../validation.js";

export type JevFetch = typeof fetch;

function requestQuestion(question: DecisionQuestion) {
  return question.type === "boolean"
    ? { id: question.id, type: "noul", instructions: question.instructions, criteria: question.criteria }
    : question.type === "choice"
      ? { id: question.id, type: "choice", instructions: question.instructions, criteria: question.criteria }
      : { id: question.id, type: "score", instructions: question.instructions, criteria: question.criteria };
}

function statusError(status: number) {
  if (status === 401) return new DecisionRuntimeError("DECISION_PROVIDER_AUTH_FAILED", 401);
  if (status === 403) return new DecisionRuntimeError("DECISION_PROVIDER_ACCESS_BLOCKED", 403);
  if (status === 429) return new DecisionRuntimeError("DECISION_PROVIDER_RATE_LIMITED", 429);
  if (status >= 500) return new DecisionRuntimeError("DECISION_PROVIDER_FAILURE", 502);
  return new DecisionRuntimeError("DECISION_PROVIDER_INVALID_RESPONSE", 502);
}

function mapAnswer(question: DecisionQuestion, value: Record<string, unknown>): DecisionAnswer {
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
    return {
      questionId: question.id,
      type: "choice",
      choice: String(value.choice),
      probabilities: value.probabilities as Record<string, number> | null,
      confidence: typeof value.confidence === "number" ? value.confidence : null,
      confidenceKind: "provider_reported_calibrated",
    };
  }
  return {
    questionId: question.id,
    type: "score",
    score: Number(value.score),
    legend: typeof value.legend === "string" ? value.legend : null,
    probabilities: Array.isArray(value.probabilities) ? value.probabilities as number[] : null,
    confidence: typeof value.confidence === "number" ? value.confidence : null,
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
          questions: request.questions.map(requestQuestion),
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw statusError(response.status);
      const body = await response.json() as Record<string, unknown>;
      const rawAnswers = Array.isArray(body.answers) ? body.answers : Array.isArray(body.results) ? body.results : [];
      const answers = request.questions.map((question, index) => {
        const item = rawAnswers[index];
        if (!item || typeof item !== "object") throw new DecisionRuntimeError("DECISION_PROVIDER_INVALID_RESPONSE:answers");
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
