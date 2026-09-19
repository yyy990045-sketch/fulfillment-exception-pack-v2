import type { BenchmarkUsage } from "./types.js";

function numeric(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function extractTokenUsage(usage: Record<string, unknown> | undefined): {
  inputTokens: number | null;
  outputTokens: number | null;
} {
  if (!usage) return { inputTokens: null, outputTokens: null };
  return {
    inputTokens: numeric(usage.input_tokens) ?? numeric(usage.inputTokens) ?? numeric(usage.prompt_tokens),
    outputTokens: numeric(usage.output_tokens) ?? numeric(usage.outputTokens) ?? numeric(usage.completion_tokens),
  };
}

export type BenchmarkPricingConfig = {
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
};

export function benchmarkPricingFromEnv(provider: string, env: Record<string, string | undefined>): BenchmarkPricingConfig | null {
  const prefix = provider === "openai"
    ? "DECISION_BENCHMARK_OPENAI"
    : provider === "jev"
      ? "DECISION_BENCHMARK_JEV"
      : null;
  if (!prefix) return null;
  const input = Number(env[`${prefix}_INPUT_USD_PER_MTOK`]);
  const output = Number(env[`${prefix}_OUTPUT_USD_PER_MTOK`]);
  if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) return null;
  return {
    inputUsdPerMillionTokens: input,
    outputUsdPerMillionTokens: output,
  };
}

export function estimateBenchmarkCost(usage: {
  inputTokens: number | null;
  outputTokens: number | null;
}, pricing: BenchmarkPricingConfig | null): BenchmarkUsage {
  if (!pricing || usage.inputTokens === null || usage.outputTokens === null) {
    return { ...usage, estimatedCostUsd: null };
  }
  return {
    ...usage,
    estimatedCostUsd:
      (usage.inputTokens * pricing.inputUsdPerMillionTokens + usage.outputTokens * pricing.outputUsdPerMillionTokens) / 1_000_000,
  };
}
