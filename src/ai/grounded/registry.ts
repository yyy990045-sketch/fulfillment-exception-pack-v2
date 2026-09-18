import { OpenAIGroundedAiProvider, type OpenAIResponsesClient } from "./openai-provider.js";
import { DeterministicGroundedAiProvider } from "./provider.js";
import { GroundedAiError, type GroundedAiProvider } from "./types.js";

export type GroundedProviderRegistryOptions = {
  env?: Record<string, string | undefined>;
  openAIClient?: OpenAIResponsesClient;
};

function parseTimeout(value: string | undefined) {
  const timeout = value === undefined || value.trim() === "" ? 20_000 : Number(value);
  if (!Number.isFinite(timeout) || timeout < 1_000 || timeout > 60_000) {
    throw new GroundedAiError("AI_PROVIDER_NOT_CONFIGURED", 503);
  }
  return timeout;
}

function parseReasoningEffort(value: string | undefined): "none" | "low" | "medium" {
  const effort = value?.trim() || "low";
  if (!["none", "low", "medium"].includes(effort)) throw new GroundedAiError("AI_PROVIDER_NOT_CONFIGURED", 503);
  return effort as "none" | "low" | "medium";
}

export function resolveGroundedAiProvider(options: GroundedProviderRegistryOptions = {}): GroundedAiProvider {
  const env = options.env ?? process.env;
  const configured = env.GROUNDING_AI_PROVIDER?.trim();
  if (!configured) throw new GroundedAiError("GROUNDING_AI_PROVIDER_REQUIRED", 503);
  if (configured === "deterministic") {
    if (env.DEMO_MODE !== "true" || env.NODE_ENV === "production") {
      throw new GroundedAiError("GROUNDING_AI_PROVIDER_REQUIRED", 503);
    }
    return new DeterministicGroundedAiProvider();
  }
  if (configured !== "openai") throw new GroundedAiError("AI_PROVIDER_NOT_CONFIGURED", 503);
  const apiKey = env.OPENAI_API_KEY?.trim();
  const model = env.OPENAI_GROUNDED_MODEL?.trim();
  if (!apiKey || !model) throw new GroundedAiError("AI_PROVIDER_NOT_CONFIGURED", 503);
  return new OpenAIGroundedAiProvider({
    apiKey,
    model,
    reasoningEffort: parseReasoningEffort(env.OPENAI_GROUNDED_REASONING_EFFORT),
    timeoutMs: parseTimeout(env.OPENAI_GROUNDED_TIMEOUT_MS),
    ...(options.openAIClient ? { client: options.openAIClient } : {}),
  });
}
