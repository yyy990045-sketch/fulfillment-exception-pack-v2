import { DeterministicDecisionRecommendationProvider } from "./provider.js";
import { OpenAIDecisionRecommendationProvider, type DecisionOpenAIResponsesClient } from "./openai-provider.js";
import { DecisionAiError, type DecisionRecommendationProvider } from "./types.js";

export function resolveDecisionRecommendationProvider(
  options: { env?: Record<string, string | undefined>; openAIClient?: DecisionOpenAIResponsesClient } = {},
): DecisionRecommendationProvider {
  const env = options.env ?? process.env;
  const configured = env.DECISION_AI_PROVIDER?.trim();
  if (!configured) throw new DecisionAiError("DECISION_PROVIDER_REQUIRED", 503);
  if (configured === "deterministic") {
    if (env.DEMO_MODE !== "true" || env.NODE_ENV === "production") throw new DecisionAiError("DECISION_PROVIDER_REQUIRED", 503);
    return new DeterministicDecisionRecommendationProvider();
  }
  if (configured !== "openai") throw new DecisionAiError("DECISION_PROVIDER_NOT_CONFIGURED", 503);
  const apiKey = env.OPENAI_API_KEY?.trim();
  const model = env.OPENAI_DECISION_MODEL?.trim();
  if (!apiKey || !model) throw new DecisionAiError("DECISION_PROVIDER_NOT_CONFIGURED", 503);
  const timeoutMs = Number(env.OPENAI_DECISION_TIMEOUT_MS || 20_000);
  return new OpenAIDecisionRecommendationProvider({
    apiKey,
    model,
    timeoutMs,
    ...(options.openAIClient ? { client: options.openAIClient } : {}),
  });
}
