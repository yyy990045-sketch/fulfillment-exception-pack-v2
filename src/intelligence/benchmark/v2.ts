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
  getPolicyActionMetadata,
  isWritableActionType,
  listWritableActionTypes,
} from "../../policy/action-catalog.js";
import { policyModeForActionV2 } from "../../policy/v2-boundary.js";
import { AUTOMATION_RISK_QUESTION } from "./cases.js";
import { runProviderBenchmark } from "./harness.js";
import { computeBenchmarkMetrics } from "./metrics.js";
import { benchmarkPricingFromEnv, estimateBenchmarkCost } from "./pricing.js";
import type {
  BenchmarkCase,
  BenchmarkCaseResult,
  BenchmarkDomain,
  BenchmarkMetrics,
  BenchmarkSuite,
} from "./types.js";

export type BenchmarkV2GovernanceQuestion =
  | "isHumanReviewTransition"
  | "requiresApprovalBeforeExecution"
  | "hasMaterialBusinessEffect";

export type BenchmarkV2ProviderStatus = "verified" | "partial" | "not_configured" | "access_blocked" | "failed";

export type BenchmarkV2ProviderSummary = {
  provider: string;
  model: string | null;
  status: BenchmarkV2ProviderStatus;
  verified: boolean;
  warmupUsed: boolean;
  reason?: string;
  overall: BenchmarkMetrics | null;
  suites: Partial<Record<BenchmarkSuite, BenchmarkMetrics>>;
  governanceQuestions: Partial<Record<BenchmarkV2GovernanceQuestion, BenchmarkMetrics>>;
};

export type DecisionRuntimeBenchmarkV2Summary = {
  schemaVersion: "decision-runtime-benchmark/v2";
  generatedAt: string;
  dataset: ReturnType<typeof benchmarkV2DatasetSummary>;
  providers: Record<string, BenchmarkV2ProviderSummary>;
  truthfulness: {
    DECISION_RUNTIME_IMPLEMENTED: true;
    PROVIDER_NEUTRAL_RUNTIME: true;
    DETERMINISTIC_PROVIDER_IMPLEMENTED: true;
    OPENAI_DECISION_PROVIDER_IMPLEMENTED: true;
    JEV_PROVIDER_IMPLEMENTED: true;
    SYNTHETIC_BENCHMARK_DATA: true;
    PRODUCTION_DECISION_ROUTING_CHANGED: false;
    POLICY_ENGINE_CHANGED: true;
    AI_EXECUTION_PERMISSION: false;
    REAL_OPENAI_BENCHMARK_V2_VERIFIED: boolean;
    REAL_JEV_BENCHMARK_V2_VERIFIED: boolean;
    JEV_V2_STATUS: BenchmarkV2ProviderStatus;
  };
  productionIntegration: false;
};

const V2_LABEL_SOURCE = "explicit Action Catalog V2 metadata and deterministic policy boundary";

export const GOVERNANCE_QUESTIONS_V2 = {
  isHumanReviewTransition: {
    id: "isHumanReviewTransition",
    type: "boolean",
    instructions: "Is this candidate action itself a transition into human review?",
    criteria: {
      true: "The action itself hands the business object to a human review process.",
      false: "The action is not merely a transition into human review.",
    },
  },
  requiresApprovalBeforeExecution: {
    id: "requiresApprovalBeforeExecution",
    type: "boolean",
    instructions: "Does this candidate action require a separate approval before execution?",
    criteria: {
      true: "An independent approval must occur before this action executes.",
      false: "No separate approval gate is required before this action executes.",
    },
  },
  hasMaterialBusinessEffect: {
    id: "hasMaterialBusinessEffect",
    type: "boolean",
    instructions: "Can this candidate action materially change the customer, financial, legal, or irreversible business state?",
    criteria: {
      true: "The action can materially affect a business state.",
      false: "The action is internal, reversible, and has no material business effect.",
    },
  },
} as const;

export const BENCHMARK_V2_GOVERNANCE_ACTIONS = listWritableActionTypes();
const GOVERNANCE_DOMAINS: BenchmarkDomain[] = ["manufacturing", "finance", "generic"];

function actionState(actionType: (typeof BENCHMARK_V2_GOVERNANCE_ACTIONS)[number], domain: BenchmarkDomain) {
  const metadata = getPolicyActionMetadata(actionType);
  return {
    synthetic: true,
    domain,
    candidateAction: actionType,
    actionMetadata: {
      effectClass: metadata.effectClass,
      customerFacing: metadata.customerFacing,
      financialMovement: metadata.financialMovement,
      legalEffect: metadata.legalEffect,
      reversible: metadata.reversible,
      humanReviewTransition: metadata.humanReviewTransition,
      requiresApprovalBeforeExecution: metadata.requiresApprovalBeforeExecution,
      materialBusinessEffect: metadata.materialBusinessEffect,
    },
  };
}

function governanceReference(
  actionType: (typeof BENCHMARK_V2_GOVERNANCE_ACTIONS)[number],
  question: BenchmarkV2GovernanceQuestion,
): boolean {
  const metadata = getPolicyActionMetadata(actionType);
  if (question === "isHumanReviewTransition") return metadata.humanReviewTransition;
  if (question === "requiresApprovalBeforeExecution") return metadata.requiresApprovalBeforeExecution;
  return metadata.materialBusinessEffect;
}

function automationRiskReference(actionType: (typeof BENCHMARK_V2_GOVERNANCE_ACTIONS)[number]): number {
  const metadata = getPolicyActionMetadata(actionType);
  if (metadata.materialBusinessEffect && (metadata.financialMovement || metadata.legalEffect || !metadata.reversible)) return 3;
  if (metadata.customerFacing) return 2;
  if (metadata.humanReviewTransition) return 1;
  return 0;
}

function governanceCases(): BenchmarkCase[] {
  const questions = Object.entries(GOVERNANCE_QUESTIONS_V2) as Array<[BenchmarkV2GovernanceQuestion, (typeof GOVERNANCE_QUESTIONS_V2)[BenchmarkV2GovernanceQuestion]]>;
  return BENCHMARK_V2_GOVERNANCE_ACTIONS.flatMap((actionType) =>
    GOVERNANCE_DOMAINS.flatMap((domain) =>
      questions.map(([question, definition]) => ({
        id: `v2.governance.${question}.${actionType}.${domain}`,
        suite: "human_governance_gate" as const,
        domain,
        state: actionState(actionType, domain),
        questions: [definition],
        referenceAnswers: { [definition.id]: governanceReference(actionType, question) },
        labelSource: V2_LABEL_SOURCE,
        semanticQuestion: question,
      })),
    ),
  );
}

function riskCases(): BenchmarkCase[] {
  return BENCHMARK_V2_GOVERNANCE_ACTIONS.flatMap((actionType) =>
    GOVERNANCE_DOMAINS.map((domain) => ({
      id: `v2.risk.${actionType}.${domain}`,
      suite: "automation_risk_score" as const,
      domain,
      state: actionState(actionType, domain),
      questions: [AUTOMATION_RISK_QUESTION],
      referenceAnswers: { [AUTOMATION_RISK_QUESTION.id]: automationRiskReference(actionType) },
      labelSource: V2_LABEL_SOURCE,
    })),
  );
}

export const BENCHMARK_V2_CASES: BenchmarkCase[] = [...governanceCases(), ...riskCases()];

export function benchmarkV2DatasetSummary() {
  const suites: Record<BenchmarkSuite, number> = {
    next_action: 0,
    human_governance_gate: 0,
    automation_risk_score: 0,
  };
  const domains: Record<BenchmarkDomain, number> = {
    manufacturing: 0,
    finance: 0,
    generic: 0,
  };
  const governanceQuestions: Record<BenchmarkV2GovernanceQuestion, number> = {
    isHumanReviewTransition: 0,
    requiresApprovalBeforeExecution: 0,
    hasMaterialBusinessEffect: 0,
  };
  for (const item of BENCHMARK_V2_CASES) {
    suites[item.suite] += 1;
    domains[item.domain] += 1;
    const question = (item as BenchmarkCase & { semanticQuestion?: BenchmarkV2GovernanceQuestion }).semanticQuestion;
    if (question) governanceQuestions[question] += 1;
  }
  return {
    schemaVersion: "decision-runtime-benchmark/v2" as const,
    synthetic: true as const,
    cases: BENCHMARK_V2_CASES.length,
    suites,
    domains,
    governanceQuestions,
    labelSource: V2_LABEL_SOURCE,
  };
}

export function assertBenchmarkV2CaseIntegrity(cases: BenchmarkCase[] = BENCHMARK_V2_CASES) {
  const ids = new Set<string>();
  for (const caseItem of cases) {
    if (ids.has(caseItem.id)) throw new Error(`duplicate_benchmark_v2_case:${caseItem.id}`);
    ids.add(caseItem.id);
    if (caseItem.questions.length !== 1) throw new Error(`single_question_required_v2:${caseItem.id}`);
    const actionType = String(caseItem.state.candidateAction);
    if (actionType === "review_quotation") throw new Error(`legacy_action_forbidden_v2:${caseItem.id}`);
    if (!isWritableActionType(actionType)) throw new Error(`unknown_action_v2:${caseItem.id}`);
    const metadata = getPolicyActionMetadata(actionType);
    const actionMetadata = caseItem.state.actionMetadata;
    if (!actionMetadata || typeof actionMetadata !== "object") throw new Error(`action_metadata_missing_v2:${caseItem.id}`);
    for (const key of ["effectClass", "customerFacing", "financialMovement", "legalEffect", "reversible", "humanReviewTransition", "requiresApprovalBeforeExecution", "materialBusinessEffect"] as const) {
      if ((actionMetadata as Record<string, unknown>)[key] !== metadata[key]) throw new Error(`action_metadata_mismatch_v2:${caseItem.id}:${key}`);
    }
    const questionId = caseItem.questions[0]!.id;
    const reference = caseItem.referenceAnswers[questionId];
    if (reference === undefined) throw new Error(`reference_answer_missing_v2:${caseItem.id}`);
    const semanticQuestion = (caseItem as BenchmarkCase & { semanticQuestion?: BenchmarkV2GovernanceQuestion }).semanticQuestion;
    if (semanticQuestion) {
      const expected = governanceReference(actionType, semanticQuestion);
      if (reference !== expected) throw new Error(`governance_reference_mismatch_v2:${caseItem.id}`);
      const policyMode = policyModeForActionV2(actionType);
      if (
        semanticQuestion === "requiresApprovalBeforeExecution"
        && (policyMode === "auto_eligible" ? expected !== false : expected !== true)
      ) {
        throw new Error(`approval_boundary_mismatch_v2:${caseItem.id}`);
      }
      continue;
    }
    if (caseItem.suite !== "automation_risk_score" || reference !== automationRiskReference(actionType)) {
      throw new Error(`risk_reference_mismatch_v2:${caseItem.id}`);
    }
  }
  return cases;
}

function deterministicResolvers(cases: BenchmarkCase[]): Record<string, DeterministicResolver> {
  return Object.fromEntries(cases.map((caseItem) => [caseItem.id, ((_request, question) => {
    const reference = caseItem.referenceAnswers[question.id];
    if (question.type === "boolean" && typeof reference === "boolean") return deterministicBoolean(question.id, reference);
    if (question.type === "choice" && typeof reference === "string") return deterministicChoice(question.id, reference, question.criteria);
    if (question.type === "score" && typeof reference === "number") return deterministicScore(question.id, reference, question.criteria);
    throw new DecisionRuntimeError(`DECISION_TASK_NOT_SUPPORTED:${caseItem.id}`, 422);
  }) as DeterministicResolver]));
}

function providerNames(env: Record<string, string | undefined>): string[] {
  const raw = env.DECISION_BENCHMARK_PROVIDERS?.trim();
  if (!raw) return ["deterministic"];
  return [...new Set(raw.split(",").map((item) => item.trim()).filter(Boolean))];
}

function configuredProvider(name: string, env: Record<string, string | undefined>) {
  if (name === "deterministic") {
    return { provider: resolveDecisionRuntimeProvider({ provider: name, env, deterministicResolvers: deterministicResolvers(BENCHMARK_V2_CASES) }), model: "deterministic-decision-v1" };
  }
  if (name === "openai") {
    const model = env.DECISION_RUNTIME_OPENAI_MODEL?.trim() || null;
    if (!env.OPENAI_API_KEY?.trim() || !model) return { provider: null, model, reason: "DECISION_PROVIDER_NOT_CONFIGURED" };
    return { provider: resolveDecisionRuntimeProvider({ provider: name, env }), model };
  }
  if (name === "jev") {
    const model = env.TYPESAFE_MODEL?.trim() || "jev-latest";
    if (!env.TYPESAFE_API_KEY?.trim()) return { provider: null, model, reason: "DECISION_PROVIDER_NOT_CONFIGURED" };
    return { provider: resolveDecisionRuntimeProvider({ provider: name, env }), model };
  }
  return { provider: null, model: null, reason: "DECISION_PROVIDER_NOT_CONFIGURED" };
}

function failureStatus(errorCode: string | undefined): BenchmarkV2ProviderStatus {
  return errorCode === "DECISION_PROVIDER_AUTH_FAILED" || errorCode === "DECISION_PROVIDER_ACCESS_BLOCKED"
    ? "access_blocked"
    : "failed";
}

async function executeProvider(name: string, env: Record<string, string | undefined>, cases: BenchmarkCase[]) {
  const configured = configuredProvider(name, env);
  if (!configured.provider) return { provider: name, model: configured.model, status: "not_configured" as const, reason: configured.reason };
  try {
    const run = await runProviderBenchmark(configured.provider, cases, { warmup: name !== "deterministic" });
    const failures = run.results.filter((item) => item.status === "failed");
    if (failures.length === run.results.length) {
      return { provider: name, model: configured.provider.model, status: failureStatus(failures[0]?.errorCode), reason: failures[0]?.errorCode ?? "DECISION_PROVIDER_FAILURE", run };
    }
    if (failures.length) {
      return { provider: name, model: configured.provider.model, status: "partial" as const, reason: `PARTIAL_PROVIDER_FAILURE:${failures[0]?.errorCode ?? "DECISION_PROVIDER_FAILURE"}`, run };
    }
    return { provider: name, model: configured.provider.model, status: "verified" as const, run };
  } catch (error) {
    const code = error instanceof DecisionRuntimeError ? error.code : "DECISION_PROVIDER_FAILURE";
    return { provider: name, model: configured.provider.model, status: failureStatus(code), reason: code };
  }
}

function metricsByKey(results: BenchmarkCaseResult[], cases: BenchmarkCase[], key: (item: BenchmarkCase) => string | undefined, env: Record<string, string | undefined>, provider: string) {
  const metricNames = [...new Set(cases.map(key).filter((item): item is string => Boolean(item)))];
  const pricingConfig = benchmarkPricingFromEnv(provider, env);
  return Object.fromEntries(metricNames.map((name) => {
    const caseIds = new Set(cases.filter((item) => key(item) === name).map((item) => item.id));
    const raw = computeBenchmarkMetrics(results.filter((item) => caseIds.has(item.caseId)));
    return [name, { ...raw, usage: estimateBenchmarkCost({ inputTokens: raw.usage.inputTokens, outputTokens: raw.usage.outputTokens }, pricingConfig) }];
  })) as Record<string, BenchmarkMetrics>;
}

function providerSummary(execution: Awaited<ReturnType<typeof executeProvider>>, env: Record<string, string | undefined>) {
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
      governanceQuestions: {},
    } satisfies BenchmarkV2ProviderSummary;
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
    overall: { ...overall, usage: estimateBenchmarkCost({ inputTokens: overall.usage.inputTokens, outputTokens: overall.usage.outputTokens }, pricingConfig) },
    suites: metricsByKey(execution.run.results, BENCHMARK_V2_CASES, (item) => item.suite, env, execution.provider),
    governanceQuestions: metricsByKey(execution.run.results, BENCHMARK_V2_CASES, (item) => (item as BenchmarkCase & { semanticQuestion?: string }).semanticQuestion, env, execution.provider),
  } satisfies BenchmarkV2ProviderSummary;
}

export async function runDecisionBenchmarkV2(options: {
  env?: Record<string, string | undefined>;
  writeArtifacts?: boolean;
  generatedAt?: string;
  root?: string;
} = {}) {
  assertBenchmarkV2CaseIntegrity();
  const env = options.env ?? process.env;
  const executions = [];
  for (const name of providerNames(env)) executions.push(await executeProvider(name, env, BENCHMARK_V2_CASES));
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const openai = executions.find((item) => item.provider === "openai");
  const jev = executions.find((item) => item.provider === "jev");
  const summary: DecisionRuntimeBenchmarkV2Summary = {
    schemaVersion: "decision-runtime-benchmark/v2",
    generatedAt,
    dataset: benchmarkV2DatasetSummary(),
    providers: Object.fromEntries(executions.map((execution) => [execution.provider, providerSummary(execution, env)])),
    truthfulness: {
      DECISION_RUNTIME_IMPLEMENTED: true,
      PROVIDER_NEUTRAL_RUNTIME: true,
      DETERMINISTIC_PROVIDER_IMPLEMENTED: true,
      OPENAI_DECISION_PROVIDER_IMPLEMENTED: true,
      JEV_PROVIDER_IMPLEMENTED: true,
      SYNTHETIC_BENCHMARK_DATA: true,
      PRODUCTION_DECISION_ROUTING_CHANGED: false,
      POLICY_ENGINE_CHANGED: true,
      AI_EXECUTION_PERMISSION: false,
      REAL_OPENAI_BENCHMARK_V2_VERIFIED: openai?.status === "verified",
      REAL_JEV_BENCHMARK_V2_VERIFIED: jev?.status === "verified",
      JEV_V2_STATUS: jev?.status ?? "not_configured",
    },
    productionIntegration: false,
  };
  const raw = {
    schemaVersion: "decision-runtime-benchmark/v2-raw" as const,
    generatedAt,
    providers: Object.fromEntries(executions.map((execution) => [execution.provider, {
      provider: execution.provider,
      model: execution.model,
      status: execution.status,
      ...(execution.reason ? { reason: execution.reason } : {}),
      warmupUsed: execution.run?.warmupUsed ?? false,
      cases: execution.run?.results ?? [],
    }])),
  };
  if (options.writeArtifacts === false) return { summary, raw, paths: null };
  const root = options.root ?? process.cwd();
  const rawPath = resolve(root, "data/runtime/decision-runtime/benchmark-v2-raw.json");
  const summaryPath = resolve(root, "docs/competition/runtime/decision-runtime-benchmark-v2-summary.json");
  mkdirSync(dirname(rawPath), { recursive: true });
  mkdirSync(dirname(summaryPath), { recursive: true });
  writeFileSync(rawPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return { summary, raw, paths: { rawPath, summaryPath } };
}
