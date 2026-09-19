import OpenAI, { APIConnectionTimeoutError, APIUserAbortError } from "openai";
import type { Response, ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses.js";
import { decisionRecommendationJsonSchema } from "./schema.js";
import { DecisionAiError, type DecisionRecommendationProvider } from "./types.js";
import { parseDecisionRecommendationOutput } from "./validator.js";

export type DecisionOpenAIRequestOptions = {
  signal?: AbortSignal;
  timeout?: number;
  maxRetries?: number;
};

export type DecisionOpenAIResponsesClient = {
  responses: { create(body: ResponseCreateParamsNonStreaming, options?: DecisionOpenAIRequestOptions): Promise<Response> };
};

function mapError(error: unknown, timedOut: boolean) {
  if (error instanceof DecisionAiError) return error;
  if (timedOut || error instanceof APIUserAbortError || error instanceof APIConnectionTimeoutError) return new DecisionAiError("DECISION_PROVIDER_TIMEOUT", 504);
  return new DecisionAiError("DECISION_PROVIDER_FAILURE", 502);
}

export class OpenAIDecisionRecommendationProvider implements DecisionRecommendationProvider {
  readonly name = "openai";
  readonly model: string;
  private readonly client: DecisionOpenAIResponsesClient;
  private readonly timeoutMs: number;
  private readonly reasoningEffort: "none" | "low" | "medium";

  constructor(config: { apiKey: string; model: string; timeoutMs?: number; reasoningEffort?: "none" | "low" | "medium"; client?: DecisionOpenAIResponsesClient }) {
    if (!config.apiKey.trim() || !config.model.trim()) throw new DecisionAiError("DECISION_PROVIDER_NOT_CONFIGURED", 503);
    this.model = config.model.trim();
    this.timeoutMs = config.timeoutMs ?? 20_000;
    this.reasoningEffort = config.reasoningEffort ?? "low";
    if (config.client) this.client = config.client;
    else {
      const sdk = new OpenAI({ apiKey: config.apiKey, maxRetries: 0 });
      this.client = { responses: { create: (body, options) => sdk.responses.create(body, options) } };
    }
  }

  async generate(request: { input: any; prompt: { system: string; user: string } }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      const body: ResponseCreateParamsNonStreaming = {
        model: this.model,
        instructions: request.prompt.system,
        input: request.prompt.user,
        store: false,
        tools: [],
        reasoning: { effort: this.reasoningEffort },
        text: { format: { type: "json_schema", name: "decision_recommendation", strict: true, schema: decisionRecommendationJsonSchema() } },
      };
      response = await this.client.responses.create(body, { signal: controller.signal, maxRetries: 0 });
    } catch (error) {
      throw mapError(error, controller.signal.aborted);
    } finally {
      clearTimeout(timeout);
    }
    if (response.status === "incomplete" || response.incomplete_details) throw new DecisionAiError("DECISION_PROVIDER_INVALID_OUTPUT", 502);
    if (response.status === "failed" || response.error) throw new DecisionAiError("DECISION_PROVIDER_FAILURE", 502);
    if (response.output.some((item) => item.type === "message" && item.content.some((content) => content.type === "refusal"))) throw new DecisionAiError("DECISION_PROVIDER_REFUSAL", 422);
    if (!response.output_text.trim()) throw new DecisionAiError("DECISION_PROVIDER_INVALID_OUTPUT", 502);
    try {
      parseDecisionRecommendationOutput(response.output_text);
      return response.output_text;
    } catch {
      throw new DecisionAiError("DECISION_PROVIDER_INVALID_OUTPUT", 502);
    }
  }
}
