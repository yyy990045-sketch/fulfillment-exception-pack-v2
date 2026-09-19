import OpenAI, { APIConnectionTimeoutError, APIUserAbortError } from "openai";
import type { Response, ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses.js";
import { rootCauseJsonSchema } from "./schema.js";
import { RootCauseAiError, type RootCauseOutput, type RootCauseProvider, type RootCauseRequest } from "./types.js";
import { parseRootCauseOutput } from "./validator.js";

export type RootCauseOpenAIRequestOptions = {
  signal?: AbortSignal;
  timeout?: number;
  maxRetries?: number;
};

export type RootCauseOpenAIResponsesClient = {
  responses: { create(body: ResponseCreateParamsNonStreaming, options?: RootCauseOpenAIRequestOptions): Promise<Response> };
};

function mapError(error: unknown, timedOut: boolean) {
  if (error instanceof RootCauseAiError) return error;
  if (timedOut || error instanceof APIUserAbortError || error instanceof APIConnectionTimeoutError) return new RootCauseAiError("ROOT_CAUSE_PROVIDER_TIMEOUT", 504);
  return new RootCauseAiError("ROOT_CAUSE_PROVIDER_FAILURE", 502);
}

export class OpenAIRootCauseProvider implements RootCauseProvider {
  readonly name = "openai";
  readonly model: string;
  private readonly client: RootCauseOpenAIResponsesClient;
  private readonly timeoutMs: number;
  private readonly reasoningEffort: "none" | "low" | "medium";

  constructor(config: { apiKey: string; model: string; timeoutMs?: number; reasoningEffort?: "none" | "low" | "medium"; client?: RootCauseOpenAIResponsesClient }) {
    if (!config.apiKey.trim() || !config.model.trim()) throw new RootCauseAiError("ROOT_CAUSE_PROVIDER_NOT_CONFIGURED", 503);
    const timeoutMs = config.timeoutMs ?? 20_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) throw new RootCauseAiError("ROOT_CAUSE_PROVIDER_NOT_CONFIGURED", 503);
    this.model = config.model.trim();
    this.timeoutMs = timeoutMs;
    this.reasoningEffort = config.reasoningEffort ?? "low";
    if (config.client) this.client = config.client;
    else {
      const sdk = new OpenAI({ apiKey: config.apiKey, maxRetries: 0 });
      this.client = { responses: { create: (body, options) => sdk.responses.create(body, options) } };
    }
  }

  async generate(request: RootCauseRequest): Promise<RootCauseOutput> {
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
        text: { format: { type: "json_schema", name: "root_cause_hypothesis", strict: true, schema: rootCauseJsonSchema() } },
      };
      response = await this.client.responses.create(body, { signal: controller.signal, maxRetries: 0 });
    } catch (error) {
      throw mapError(error, controller.signal.aborted);
    } finally {
      clearTimeout(timeout);
    }
    if (response.status === "incomplete" || response.incomplete_details) throw new RootCauseAiError("ROOT_CAUSE_PROVIDER_INVALID_OUTPUT", 502);
    if (response.status === "failed" || response.error) throw new RootCauseAiError("ROOT_CAUSE_PROVIDER_FAILURE", 502);
    if (response.output.some((item) => item.type === "message" && item.content.some((content) => content.type === "refusal"))) {
      throw new RootCauseAiError("ROOT_CAUSE_PROVIDER_REFUSAL", 422);
    }
    if (!response.output_text.trim()) throw new RootCauseAiError("ROOT_CAUSE_PROVIDER_INVALID_OUTPUT", 502);
    try {
      return parseRootCauseOutput(response.output_text);
    } catch {
      throw new RootCauseAiError("ROOT_CAUSE_PROVIDER_INVALID_OUTPUT", 502);
    }
  }
}
