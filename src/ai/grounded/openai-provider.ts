import OpenAI, { APIConnectionTimeoutError, APIUserAbortError } from "openai";
import type { Response, ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses.js";
import { GroundedAiError, type GroundedAiProvider, type GroundedAiRequest, type GroundedExplanationOutput } from "./types.js";
import { parseGroundedExplanationOutput } from "./validator.js";
import { groundedExplanationJsonSchema } from "./schema.js";

export type OpenAIRequestOptions = {
  signal?: AbortSignal;
  timeout?: number;
  maxRetries?: number;
};

export type OpenAIResponsesClient = {
  responses: {
    create(
      body: ResponseCreateParamsNonStreaming,
      options?: OpenAIRequestOptions,
    ): Promise<Response>;
  };
};

export type OpenAIGroundedProviderConfig = {
  apiKey: string;
  model: string;
  reasoningEffort?: "none" | "low" | "medium";
  timeoutMs?: number;
  client?: OpenAIResponsesClient;
};

function hasRefusal(response: Response) {
  return response.output.some((item) => {
    if (item.type !== "message") return false;
    return item.content.some((content) => content.type === "refusal");
  });
}

function providerFailure(error: unknown, timedOut: boolean) {
  if (error instanceof GroundedAiError) return error;
  if (timedOut || error instanceof APIUserAbortError || error instanceof APIConnectionTimeoutError) {
    return new GroundedAiError("AI_PROVIDER_TIMEOUT", 504);
  }
  return new GroundedAiError("AI_PROVIDER_FAILURE", 502);
}

export class OpenAIGroundedAiProvider implements GroundedAiProvider {
  readonly name = "openai";
  readonly model: string;
  private readonly client: OpenAIResponsesClient;
  private readonly reasoningEffort: "none" | "low" | "medium";
  private readonly timeoutMs: number;

  constructor(config: OpenAIGroundedProviderConfig) {
    if (!config.apiKey.trim()) throw new GroundedAiError("AI_PROVIDER_NOT_CONFIGURED", 503);
    if (!config.model.trim()) throw new GroundedAiError("AI_PROVIDER_NOT_CONFIGURED", 503);
    this.model = config.model.trim();
    this.reasoningEffort = config.reasoningEffort ?? "low";
    this.timeoutMs = config.timeoutMs ?? 20_000;
    if (this.timeoutMs < 1_000 || this.timeoutMs > 60_000) throw new GroundedAiError("AI_PROVIDER_NOT_CONFIGURED", 503);
    if (config.client) {
      this.client = config.client;
    } else {
      const sdk = new OpenAI({
        apiKey: config.apiKey,
        maxRetries: 0,
      });
      this.client = {
        responses: {
          create: (body, options) => sdk.responses.create(body, options),
        },
      };
    }
  }

  async generate(request: GroundedAiRequest): Promise<GroundedExplanationOutput> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const body: ResponseCreateParamsNonStreaming = {
      model: this.model,
      instructions: request.prompt.system,
      input: request.prompt.user,
      store: false,
      tools: [],
      reasoning: { effort: this.reasoningEffort },
      text: {
        format: {
          type: "json_schema",
          name: "grounded_explanation",
          strict: true,
          schema: groundedExplanationJsonSchema(),
        },
      },
    };
    let response: Response;
    try {
      response = await this.client.responses.create(body, {
        signal: controller.signal,
        maxRetries: 0,
      });
    } catch (error) {
      throw providerFailure(error, controller.signal.aborted);
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === "incomplete" || response.incomplete_details) {
      throw new GroundedAiError("AI_PROVIDER_INVALID_OUTPUT", 502);
    }
    if (response.status === "failed" || response.error) throw new GroundedAiError("AI_PROVIDER_FAILURE", 502);
    if (hasRefusal(response)) throw new GroundedAiError("AI_PROVIDER_REFUSAL", 422);
    if (!response.output_text.trim()) throw new GroundedAiError("AI_PROVIDER_INVALID_OUTPUT", 502);
    try {
      return parseGroundedExplanationOutput(response.output_text);
    } catch {
      throw new GroundedAiError("AI_PROVIDER_INVALID_OUTPUT", 502);
    }
  }
}
