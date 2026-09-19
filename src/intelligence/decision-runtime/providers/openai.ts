import OpenAI, { APIConnectionTimeoutError, APIUserAbortError } from "openai";
import type { Response, ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses.js";
import {
  DecisionRuntimeError,
  type DecisionAnswer,
  type DecisionBatchResult,
  type DecisionQuestion,
  type DecisionRequest,
  type DecisionRuntimeProvider,
} from "../types.js";
import { validateDecisionAnswers } from "../validation.js";

export type DecisionOpenAIResponsesClient = {
  responses: { create(body: ResponseCreateParamsNonStreaming, options?: { signal?: AbortSignal; maxRetries?: number }): Promise<Response> };
};

function dynamicSchema(questions: DecisionQuestion[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["answers"],
    properties: {
      answers: {
        type: "array",
        minItems: questions.length,
        maxItems: questions.length,
        items: {
          oneOf: questions.map((question) => {
            const base = {
              type: "object",
              additionalProperties: false,
              properties: { questionId: { type: "string", const: question.id } },
            } as const;
            if (question.type === "boolean") return {
              ...base,
              required: ["questionId", "type", "value", "probabilityYes", "confidence"],
              properties: {
                ...base.properties,
                type: { type: "string", const: "boolean" },
                value: { type: "boolean" },
                probabilityYes: { anyOf: [{ type: "number" }, { type: "null" }] },
                confidence: { anyOf: [{ type: "number" }, { type: "null" }] },
              },
            };
            if (question.type === "choice") return {
              ...base,
              required: ["questionId", "type", "choice", "probabilities", "confidence"],
              properties: {
                ...base.properties,
                type: { type: "string", const: "choice" },
                choice: { type: "string", enum: Object.keys(question.criteria) },
                probabilities: {
                  anyOf: [
                    { type: "null" },
                    {
                      type: "object",
                      additionalProperties: false,
                      required: Object.keys(question.criteria),
                      properties: Object.fromEntries(Object.keys(question.criteria).map((key) => [key, { type: "number" }])),
                    },
                  ],
                },
                confidence: { anyOf: [{ type: "number" }, { type: "null" }] },
              },
            };
            return {
              ...base,
              required: ["questionId", "type", "score", "legend", "probabilities", "confidence"],
              properties: {
                ...base.properties,
                type: { type: "string", const: "score" },
                score: { type: "integer", minimum: 0, maximum: Math.max(0, question.criteria.length - 1) },
                legend: { anyOf: [{ type: "string" }, { type: "null" }] },
                probabilities: { anyOf: [{ type: "array", items: { type: "number" } }, { type: "null" }] },
                confidence: { anyOf: [{ type: "number" }, { type: "null" }] },
              },
            };
          }),
        },
      },
    },
  } as const;
}

function mapError(error: unknown, timedOut: boolean) {
  if (error instanceof DecisionRuntimeError) return error;
  if (timedOut || error instanceof APIUserAbortError || error instanceof APIConnectionTimeoutError) return new DecisionRuntimeError("DECISION_PROVIDER_TIMEOUT", 504);
  return new DecisionRuntimeError("DECISION_PROVIDER_FAILURE", 502);
}

export class OpenAIDecisionRuntimeProvider implements DecisionRuntimeProvider {
  readonly name = "openai";
  readonly model: string;
  private readonly client: DecisionOpenAIResponsesClient;
  private readonly timeoutMs: number;

  constructor(config: { apiKey: string; model: string; timeoutMs?: number; client?: DecisionOpenAIResponsesClient }) {
    if (!config.apiKey.trim() || !config.model.trim()) throw new DecisionRuntimeError("DECISION_PROVIDER_NOT_CONFIGURED", 503);
    this.model = config.model.trim();
    this.timeoutMs = config.timeoutMs ?? 20_000;
    if (config.client) this.client = config.client;
    else {
      const sdk = new OpenAI({ apiKey: config.apiKey, maxRetries: 0 });
      this.client = { responses: { create: (body, options) => sdk.responses.create(body, options) } };
    }
  }

  async evaluateBatch(request: DecisionRequest): Promise<DecisionBatchResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const body: ResponseCreateParamsNonStreaming = {
        model: this.model,
        instructions: "Answer the typed decision questions. Return only the requested JSON.",
        input: JSON.stringify({ taskId: request.taskId, state: request.state, questions: request.questions }),
        store: false,
        tools: [],
        max_output_tokens: 2000,
        text: { format: { type: "json_schema", name: "decision_runtime_answers", strict: true, schema: dynamicSchema(request.questions) } },
      };
      const response = await this.client.responses.create(body, { signal: controller.signal, maxRetries: 0 });
      if (response.status === "incomplete" || response.incomplete_details) throw new DecisionRuntimeError("DECISION_PROVIDER_INVALID_RESPONSE", 502);
      if (response.status === "failed" || response.error) throw new DecisionRuntimeError("DECISION_PROVIDER_FAILURE", 502);
      if (response.output.some((item) => item.type === "message" && item.content.some((content) => content.type === "refusal"))) {
        throw new DecisionRuntimeError("DECISION_PROVIDER_ACCESS_BLOCKED", 403);
      }
      const parsed = JSON.parse(response.output_text) as { answers: Array<Record<string, unknown>> };
      const answers = parsed.answers.map((item) => ({
        ...item,
        confidenceKind: "self_reported",
      })) as DecisionAnswer[];
      return {
        provider: this.name,
        model: this.model,
        answers: validateDecisionAnswers(request.questions, answers),
        ...(response.usage ? { usage: response.usage as unknown as Record<string, unknown> } : {}),
        providerRequestId: response.id,
      };
    } catch (error) {
      throw mapError(error, controller.signal.aborted);
    } finally {
      clearTimeout(timeout);
    }
  }
}
