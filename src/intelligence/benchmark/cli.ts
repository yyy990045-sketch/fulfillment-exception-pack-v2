import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  DecisionRuntimeError,
  deterministicBoolean,
  deterministicChoice,
  deterministicScore,
  resolveDecisionRuntimeProvider,
  type DeterministicResolver,
} from "../decision-runtime/index.js";
import {
  BENCHMARK_CASES,
  assertBenchmarkCaseIntegrity,
  benchmarkDeterministicReference,
} from "./cases.js";
import type { BenchmarkCase } from "./types.js";
import { runProviderBenchmark } from "./harness.js";
import {
  buildBenchmarkRawArtifact,
  buildBenchmarkSummary,
  writeBenchmarkArtifacts,
  type BenchmarkProviderExecution,
} from "./report.js";

export type DecisionBenchmarkProviderName = "deterministic" | "openai" | "jev";

function deterministicResolvers(cases: BenchmarkCase[]): Record<string, DeterministicResolver> {
  return Object.fromEntries(cases.map((caseItem) => [caseItem.id, ((_request, question) => {
    const reference = benchmarkDeterministicReference(caseItem);
    if (question.type === "boolean" && typeof reference === "boolean") {
      return deterministicBoolean(question.id, reference);
    }
    if (question.type === "choice" && typeof reference === "string") {
      return deterministicChoice(question.id, reference, question.criteria);
    }
    if (question.type === "score" && typeof reference === "number") {
      return deterministicScore(question.id, reference, question.criteria);
    }
    throw new DecisionRuntimeError(`DECISION_TASK_NOT_SUPPORTED:${caseItem.id}`, 422);
  }) as DeterministicResolver]));
}

function providerNames(env: Record<string, string | undefined>): DecisionBenchmarkProviderName[] {
  const raw = env.DECISION_BENCHMARK_PROVIDERS?.trim();
  if (!raw) return ["deterministic"];
  const names = raw.split(",").map((item) => item.trim()).filter(Boolean);
  return [...new Set(names)] as DecisionBenchmarkProviderName[];
}

function configuredProvider(name: string, env: Record<string, string | undefined>) {
  if (name === "deterministic") {
    return { provider: resolveDecisionRuntimeProvider({ provider: name, env, deterministicResolvers: deterministicResolvers(BENCHMARK_CASES) }), model: "deterministic-decision-v1" };
  }
  if (name === "openai") {
    const model = env.DECISION_RUNTIME_OPENAI_MODEL?.trim() || null;
    if (!env.OPENAI_API_KEY?.trim() || !model) {
      return { provider: null, model, reason: "DECISION_PROVIDER_NOT_CONFIGURED" };
    }
    return { provider: resolveDecisionRuntimeProvider({ provider: name, env }), model };
  }
  if (name === "jev") {
    const model = env.TYPESAFE_MODEL?.trim() || "jev-latest";
    if (!env.TYPESAFE_API_KEY?.trim()) {
      return { provider: null, model, reason: "DECISION_PROVIDER_NOT_CONFIGURED" };
    }
    return { provider: resolveDecisionRuntimeProvider({ provider: name, env }), model };
  }
  return { provider: null, model: null, reason: "DECISION_PROVIDER_NOT_CONFIGURED" };
}

function failureStatus(errorCode: string | undefined) {
  if (errorCode === "DECISION_PROVIDER_AUTH_FAILED" || errorCode === "DECISION_PROVIDER_ACCESS_BLOCKED") {
    return "access_blocked" as const;
  }
  return "failed" as const;
}

async function executeProvider(
  name: string,
  env: Record<string, string | undefined>,
): Promise<BenchmarkProviderExecution> {
  const configured = configuredProvider(name, env);
  if (!configured.provider) {
    return {
      provider: name,
      model: configured.model,
      status: "not_configured",
      reason: configured.reason,
    };
  }
  try {
    const run = await runProviderBenchmark(configured.provider, BENCHMARK_CASES, {
      warmup: name === "openai" || name === "jev",
    });
    const firstFailure = run.results.find((item) => item.status === "failed");
    if (run.results.every((item) => item.status === "failed")) {
      return {
        provider: name,
        model: configured.provider.model,
        status: failureStatus(firstFailure?.errorCode),
        reason: firstFailure?.errorCode ?? "DECISION_PROVIDER_FAILURE",
        run,
      };
    }
    return {
      provider: name,
      model: configured.provider.model,
      status: "verified",
      ...(firstFailure?.errorCode ? { reason: `PARTIAL_PROVIDER_FAILURE:${firstFailure.errorCode}` } : {}),
      run,
    };
  } catch (error) {
    const code = error instanceof DecisionRuntimeError ? error.code : "DECISION_PROVIDER_FAILURE";
    return {
      provider: name,
      model: configured.provider.model,
      status: failureStatus(code),
      reason: code,
    };
  }
}

export async function runDecisionBenchmark(options: {
  env?: Record<string, string | undefined>;
  writeArtifacts?: boolean;
  generatedAt?: string;
  root?: string;
} = {}) {
  const env = options.env ?? process.env;
  const names = providerNames(env);
  const executions: BenchmarkProviderExecution[] = [];
  for (const name of names) executions.push(await executeProvider(name, env));
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const summary = buildBenchmarkSummary({ executions, generatedAt, env });
  const raw = buildBenchmarkRawArtifact({ executions, generatedAt });
  const paths = options.writeArtifacts === false
    ? null
    : writeBenchmarkArtifacts({ summary, raw, ...(options.root ? { root: options.root } : {}) });
  return { summary, raw, paths };
}

export async function runDecisionProviderVerification(
  providerName: string,
  options: {
    env?: Record<string, string | undefined>;
    writeArtifacts?: boolean;
    generatedAt?: string;
    root?: string;
  } = {},
) {
  assertBenchmarkCaseIntegrity();
  const env = options.env ?? process.env;
  const verificationCase = BENCHMARK_CASES.find((item) => item.id === "governance.reject_overclaim.manufacturing");
  if (!verificationCase) throw new Error("verification_case_missing");
  const configured = configuredProvider(providerName, env);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  if (!configured.provider) {
    return {
      provider: providerName,
      model: configured.model,
      status: "not_configured" as const,
      verified: false,
      reason: configured.reason,
    };
  }
  try {
    const run = await runProviderBenchmark(configured.provider, [verificationCase], { warmup: providerName !== "deterministic" });
    const result = run.results[0]!;
    const verified = result.status === "succeeded";
    const status = verified ? "verified" as const : failureStatus(result.errorCode);
    const artifact = {
      schemaVersion: "decision-runtime-provider-verification/v1",
      generatedAt,
      provider: providerName,
      model: configured.provider.model,
      status,
      verified,
      caseId: verificationCase.id,
      result,
    };
    if (options.writeArtifacts !== false) {
      const root = options.root ?? process.cwd();
      const path = resolve(root, `data/runtime/decision-runtime/verify-${providerName}.json`);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    }
    return artifact;
  } catch (error) {
    const code = error instanceof DecisionRuntimeError ? error.code : "DECISION_PROVIDER_FAILURE";
    return {
      provider: providerName,
      model: configured.provider.model,
      status: failureStatus(code),
      verified: false,
      reason: code,
    };
  }
}

async function main() {
  const command = process.argv[2] ?? "benchmark";
  if (command === "benchmark") {
    const result = await runDecisionBenchmark();
    console.log(JSON.stringify(result.summary, null, 2));
    if (!Object.values(result.summary.providers).some((item) => item.verified)) process.exitCode = 1;
    return;
  }
  if (command === "verify-openai" || command === "verify-jev") {
    const provider = command === "verify-openai" ? "openai" : "jev";
    const result = await runDecisionProviderVerification(provider);
    console.log(JSON.stringify(result, null, 2));
    if (!("verified" in result) || !result.verified) process.exitCode = 1;
    return;
  }
  throw new Error(`unknown_decision_runtime_command:${command}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
