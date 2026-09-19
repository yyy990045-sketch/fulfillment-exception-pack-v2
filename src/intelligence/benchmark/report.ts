import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type {
  BenchmarkMetrics,
  BenchmarkProviderRun,
  BenchmarkProviderSummary,
  BenchmarkRawArtifact,
  BenchmarkSuite,
  DecisionRuntimeBenchmarkSummary,
} from "./types.js";
import { benchmarkDatasetSummary } from "./cases.js";
import { computeBenchmarkMetrics } from "./metrics.js";
import { benchmarkPricingFromEnv, estimateBenchmarkCost } from "./pricing.js";

export type BenchmarkProviderExecution = {
  provider: string;
  model: string | null;
  status: BenchmarkProviderSummary["status"];
  reason?: string;
  run?: BenchmarkProviderRun;
};

function metricsBySuite(run: BenchmarkProviderRun, env: Record<string, string | undefined>) {
  const pricingConfig = benchmarkPricingFromEnv(run.provider.name, env);
  const suites: Partial<Record<BenchmarkSuite, BenchmarkMetrics>> = {};
  for (const suite of ["next_action", "human_governance_gate", "automation_risk_score"] as const) {
    const results = run.results.filter((item) => item.suite === suite);
    if (!results.length) continue;
    const raw = computeBenchmarkMetrics(results);
    suites[suite] = {
      ...raw,
      usage: estimateBenchmarkCost({ inputTokens: raw.usage.inputTokens, outputTokens: raw.usage.outputTokens }, pricingConfig),
    };
  }
  return suites;
}

function providerSummary(execution: BenchmarkProviderExecution, env: Record<string, string | undefined>): BenchmarkProviderSummary {
  if (!execution.run) {
    return {
      provider: execution.provider,
      model: execution.model,
      status: execution.status,
      verified: false,
      warmupUsed: false,
      ...(execution.reason ? { reason: execution.reason } : {}),
      overall: null,
      suites: {},
    };
  }
  const overall = computeBenchmarkMetrics(execution.run.results);
  const pricingConfig = benchmarkPricingFromEnv(execution.provider, env);
  return {
    provider: execution.provider,
    model: execution.model,
    status: execution.status,
    verified: execution.status === "verified",
    warmupUsed: execution.run.warmupUsed,
    ...(execution.reason ? { reason: execution.reason } : {}),
    overall: {
      ...overall,
      usage: estimateBenchmarkCost({ inputTokens: overall.usage.inputTokens, outputTokens: overall.usage.outputTokens }, pricingConfig),
    },
    suites: metricsBySuite(execution.run, env),
  };
}

export function buildBenchmarkSummary(input: {
  executions: BenchmarkProviderExecution[];
  generatedAt: string;
  env?: Record<string, string | undefined>;
}): DecisionRuntimeBenchmarkSummary {
  const env = input.env ?? process.env;
  const openai = input.executions.find((item) => item.provider === "openai");
  const jev = input.executions.find((item) => item.provider === "jev");
  return {
    schemaVersion: "decision-runtime-benchmark/v1",
    generatedAt: input.generatedAt,
    dataset: benchmarkDatasetSummary(),
    providers: Object.fromEntries(input.executions.map((execution) => [execution.provider, providerSummary(execution, env)])),
    truthfulness: {
      DECISION_RUNTIME_IMPLEMENTED: true,
      PROVIDER_NEUTRAL_RUNTIME: true,
      DETERMINISTIC_PROVIDER_IMPLEMENTED: true,
      OPENAI_DECISION_PROVIDER_IMPLEMENTED: true,
      JEV_PROVIDER_IMPLEMENTED: true,
      SYNTHETIC_BENCHMARK_DATA: true,
      PRODUCTION_DECISION_ROUTING_CHANGED: false,
      POLICY_ENGINE_CHANGED: false,
      AI_EXECUTION_PERMISSION: false,
      REAL_OPENAI_BENCHMARK_VERIFIED: openai?.status === "verified",
      REAL_JEV_BENCHMARK_VERIFIED: jev?.status === "verified",
      JEV_STATUS: jev?.status ?? "not_configured",
    },
    productionIntegration: false,
  };
}

export function buildBenchmarkRawArtifact(input: {
  executions: BenchmarkProviderExecution[];
  generatedAt: string;
}): BenchmarkRawArtifact {
  return {
    schemaVersion: "decision-runtime-benchmark-raw/v1",
    generatedAt: input.generatedAt,
    providers: Object.fromEntries(input.executions.map((execution) => [execution.provider, {
      provider: execution.provider,
      model: execution.model,
      status: execution.status,
      ...(execution.reason ? { reason: execution.reason } : {}),
      warmupUsed: execution.run?.warmupUsed ?? false,
      cases: execution.run?.results ?? [],
    }])),
  };
}

export function writeBenchmarkArtifacts(input: {
  summary: DecisionRuntimeBenchmarkSummary;
  raw: BenchmarkRawArtifact;
  root?: string;
}) {
  const root = input.root ?? process.cwd();
  const rawPath = resolve(root, "data/runtime/decision-runtime/benchmark-raw.json");
  const summaryPath = resolve(root, "docs/competition/runtime/decision-runtime-benchmark-summary.json");
  mkdirSync(dirname(rawPath), { recursive: true });
  mkdirSync(dirname(summaryPath), { recursive: true });
  writeFileSync(rawPath, `${JSON.stringify(input.raw, null, 2)}\n`, "utf8");
  writeFileSync(summaryPath, `${JSON.stringify(input.summary, null, 2)}\n`, "utf8");
  return { rawPath, summaryPath };
}
