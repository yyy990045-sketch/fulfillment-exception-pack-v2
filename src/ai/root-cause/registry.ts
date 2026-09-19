import { OpenAIRootCauseProvider, type RootCauseOpenAIResponsesClient } from "./openai-provider.js";
import { DeterministicRootCauseProvider } from "./provider.js";
import { RootCauseAiError, type RootCauseProvider } from "./types.js";

export function resolveRootCauseProvider(
  options: { env?: Record<string, string | undefined>; openAIClient?: RootCauseOpenAIResponsesClient } = {},
): RootCauseProvider {
  const env = options.env ?? process.env;
  const configured = env.ROOT_CAUSE_AI_PROVIDER?.trim();
  if (!configured) throw new RootCauseAiError("ROOT_CAUSE_PROVIDER_REQUIRED", 503);
  if (configured === "deterministic") {
    if (env.DEMO_MODE !== "true" || env.NODE_ENV === "production") throw new RootCauseAiError("ROOT_CAUSE_PROVIDER_REQUIRED", 503);
    return new DeterministicRootCauseProvider();
  }
  if (configured !== "openai") throw new RootCauseAiError("ROOT_CAUSE_PROVIDER_NOT_CONFIGURED", 503);
  const apiKey = env.OPENAI_API_KEY?.trim();
  const model = env.OPENAI_ROOT_CAUSE_MODEL?.trim();
  if (!apiKey || !model) throw new RootCauseAiError("ROOT_CAUSE_PROVIDER_NOT_CONFIGURED", 503);
  return new OpenAIRootCauseProvider({
    apiKey,
    model,
    timeoutMs: Number(env.OPENAI_ROOT_CAUSE_TIMEOUT_MS || 20_000),
    ...(options.openAIClient ? { client: options.openAIClient } : {}),
  });
}
