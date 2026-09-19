import type {
  DecisionAnswer,
  DecisionConfidenceKind,
  DecisionQuestion,
  DecisionRuntimeProvider,
} from "../decision-runtime/index.js";

export type BenchmarkSuite = "next_action" | "human_governance_gate" | "automation_risk_score";
export type BenchmarkDomain = "manufacturing" | "finance" | "generic";
export type BenchmarkReferenceValue = boolean | string | number;

export type BenchmarkCase = {
  id: string;
  suite: BenchmarkSuite;
  domain: BenchmarkDomain;
  state: Record<string, unknown>;
  questions: DecisionQuestion[];
  referenceAnswers: Record<string, BenchmarkReferenceValue>;
  labelSource: string;
  unsafeAnswers?: BenchmarkReferenceValue[];
};

export type BenchmarkCaseResult = {
  caseId: string;
  suite: BenchmarkSuite;
  domain: BenchmarkDomain;
  status: "succeeded" | "failed";
  latencyMs: number;
  answer?: DecisionAnswer;
  reference: BenchmarkReferenceValue;
  usage?: Record<string, unknown>;
  exact: boolean;
  unsafe: boolean;
  errorCode?: string;
};

export type BenchmarkProviderRun = {
  provider: DecisionRuntimeProvider;
  warmupUsed: boolean;
  results: BenchmarkCaseResult[];
};

export type BenchmarkThresholdMetrics = {
  threshold: number;
  eligibleCases: number;
  coverage: number;
  selectiveAccuracy: number | null;
};

export type BenchmarkUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
};

export type BenchmarkMetrics = {
  caseCount: number;
  successfulCases: number;
  failedCases: number;
  schemaValidRate: number;
  exactAccuracy: number;
  binaryBrierScore: number | null;
  multiclassBrierScore: number | null;
  scoreMae: number | null;
  exactLevelAccuracy: number | null;
  withinOneLevelAccuracy: number | null;
  latencyP50Ms: number;
  latencyP95Ms: number;
  errorRate: number;
  unsafeDecisionRate: number;
  confidenceKindBreakdown: Record<DecisionConfidenceKind | "none", number>;
  thresholds: BenchmarkThresholdMetrics[];
  usage: BenchmarkUsage;
};

export type BenchmarkProviderSummary = {
  provider: string;
  model: string | null;
  status: "verified" | "not_configured" | "access_blocked" | "failed";
  verified: boolean;
  warmupUsed: boolean;
  reason?: string;
  overall: BenchmarkMetrics | null;
  suites: Partial<Record<BenchmarkSuite, BenchmarkMetrics>>;
};

export type BenchmarkDatasetSummary = {
  synthetic: true;
  cases: number;
  suites: Record<BenchmarkSuite, number>;
  domains: Record<BenchmarkDomain, number>;
  labelSource: string;
};

export type DecisionRuntimeBenchmarkSummary = {
  schemaVersion: "decision-runtime-benchmark/v1";
  generatedAt: string;
  dataset: BenchmarkDatasetSummary;
  providers: Record<string, BenchmarkProviderSummary>;
  truthfulness: {
    DECISION_RUNTIME_IMPLEMENTED: true;
    PROVIDER_NEUTRAL_RUNTIME: true;
    DETERMINISTIC_PROVIDER_IMPLEMENTED: true;
    OPENAI_DECISION_PROVIDER_IMPLEMENTED: true;
    JEV_PROVIDER_IMPLEMENTED: true;
    SYNTHETIC_BENCHMARK_DATA: true;
    PRODUCTION_DECISION_ROUTING_CHANGED: false;
    POLICY_ENGINE_CHANGED: false;
    AI_EXECUTION_PERMISSION: false;
    REAL_OPENAI_BENCHMARK_VERIFIED: boolean;
    REAL_JEV_BENCHMARK_VERIFIED: boolean;
    JEV_STATUS: BenchmarkProviderSummary["status"];
  };
  productionIntegration: false;
};

export type BenchmarkRawArtifact = {
  schemaVersion: "decision-runtime-benchmark-raw/v1";
  generatedAt: string;
  providers: Record<string, {
    provider: string;
    model: string | null;
    status: BenchmarkProviderSummary["status"];
    reason?: string;
    warmupUsed: boolean;
    cases: BenchmarkCaseResult[];
  }>;
};
