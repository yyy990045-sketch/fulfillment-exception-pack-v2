import { JevDecisionRuntimeProvider, type JevFetch } from "./providers/jev.js";
import { OpenAIDecisionRuntimeProvider, type DecisionOpenAIResponsesClient } from "./providers/openai.js";
import { DeterministicDecisionProvider, type DeterministicResolver } from "./providers/deterministic.js";
import { DecisionRuntimeError, type DecisionRuntimeProvider } from "./types.js";

export function resolveDecisionRuntimeProvider(input: {
  provider: string;
  env?: Record<string, string | undefined>;
  deterministicResolvers?: Record<string, DeterministicResolver>;
  openAIClient?: DecisionOpenAIResponsesClient;
  jevFetch?: JevFetch;
}): DecisionRuntimeProvider {
  const env = input.env ?? process.env;
  if (input.provider === "deterministic") {
    if (!input.deterministicResolvers) throw new DecisionRuntimeError("DECISION_PROVIDER_NOT_CONFIGURED", 503);
    return new DeterministicDecisionProvider({ resolvers: input.deterministicResolvers });
  }
  if (input.provider === "openai") {
    const apiKey = env.OPENAI_API_KEY?.trim();
    const model = env.DECISION_RUNTIME_OPENAI_MODEL?.trim();
    if (!apiKey || !model) throw new DecisionRuntimeError("DECISION_PROVIDER_NOT_CONFIGURED", 503);
    return new OpenAIDecisionRuntimeProvider({
      apiKey,
      model,
      timeoutMs: Number(env.DECISION_RUNTIME_OPENAI_TIMEOUT_MS || 20_000),
      ...(input.openAIClient ? { client: input.openAIClient } : {}),
    });
  }
  if (input.provider === "jev") {
    const apiKey = env.TYPESAFE_API_KEY?.trim();
    if (!apiKey) throw new DecisionRuntimeError("DECISION_PROVIDER_NOT_CONFIGURED", 503);
    return new JevDecisionRuntimeProvider({
      apiKey,
      model: env.TYPESAFE_MODEL?.trim() || "jev-latest",
      baseUrl: env.TYPESAFE_BASE_URL?.trim() || "https://api.typesafe.ai",
      timeoutMs: Number(env.TYPESAFE_TIMEOUT_MS || 10_000),
      ...(input.jevFetch ? { fetchImpl: input.jevFetch } : {}),
    });
  }
  throw new DecisionRuntimeError("DECISION_PROVIDER_NOT_CONFIGURED", 503);
}
