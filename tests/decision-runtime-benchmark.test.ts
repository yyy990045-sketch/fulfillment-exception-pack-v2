import { describe, expect, it } from "vitest";
import {
  BENCHMARK_CASES,
  assertBenchmarkCaseIntegrity,
  benchmarkDatasetSummary,
  computeBenchmarkMetrics,
  runDecisionBenchmark,
  runDecisionProviderVerification,
  runProviderBenchmark,
  stripBenchmarkMetadata,
  type BenchmarkCase,
  type BenchmarkCaseResult,
} from "../src/intelligence/benchmark/index.js";
import type {
  DecisionAnswer,
  DecisionBatchResult,
  DecisionRequest,
  DecisionRuntimeProvider,
} from "../src/intelligence/decision-runtime/index.js";

class BenchmarkCapturingProvider implements DecisionRuntimeProvider {
  readonly name = "capture";
  readonly model = "capture-v1";
  request: unknown;

  async evaluateBatch(request: DecisionRequest): Promise<DecisionBatchResult> {
    this.request = request;
    const answers: DecisionAnswer[] = request.questions.map((question) => {
      if (question.type === "boolean") {
        return { questionId: question.id, type: "boolean", value: true, probabilityYes: 1, confidence: 1, confidenceKind: "self_reported" };
      }
      if (question.type === "choice") {
        const choice = Object.keys(question.criteria)[0]!;
        return {
          questionId: question.id,
          type: "choice",
          choice,
          probabilities: Object.fromEntries(Object.keys(question.criteria).map((key) => [key, key === choice ? 1 : 0])),
          confidence: 1,
          confidenceKind: "self_reported",
        };
      }
      return {
        questionId: question.id,
        type: "score",
        score: 0,
        legend: question.criteria[0] ?? null,
        probabilities: question.criteria.map((_, index) => index === 0 ? 1 : 0),
        confidence: 1,
        confidenceKind: "self_reported",
      };
    });
    return { provider: this.name, model: this.model, answers };
  }
}

function result(input: Omit<BenchmarkCaseResult, "suite" | "domain" | "status" | "latencyMs" | "exact" | "unsafe"> & Partial<BenchmarkCaseResult>): BenchmarkCaseResult {
  return {
    suite: "human_governance_gate",
    domain: "generic",
    status: "succeeded",
    latencyMs: 10,
    exact: false,
    unsafe: false,
    ...input,
  };
}

describe("Decision Runtime benchmark", () => {
  it("keeps the synthetic dataset deterministic and complete", () => {
    assertBenchmarkCaseIntegrity();
    const dataset = benchmarkDatasetSummary();
    expect(dataset).toMatchObject({
      synthetic: true,
      cases: 51,
      suites: { next_action: 21, human_governance_gate: 15, automation_risk_score: 15 },
      domains: { manufacturing: 22, finance: 19, generic: 10 },
    });
    expect(new Set(BENCHMARK_CASES.map((item) => item.id)).size).toBe(51);
  });

  it("runs the deterministic rubric baseline without production integration", async () => {
    const result = await runDecisionBenchmark({ env: {}, writeArtifacts: false, generatedAt: "2026-09-19T00:00:00.000Z" });
    expect(result.summary.productionIntegration).toBe(false);
    expect(result.summary.providers.deterministic).toMatchObject({
      status: "verified",
      verified: true,
      overall: {
        caseCount: 51,
        successfulCases: 51,
        exactAccuracy: 1,
        unsafeDecisionRate: 0,
        errorRate: 0,
      },
    });
  });

  it("never gives reference labels to a provider", async () => {
    const provider = new BenchmarkCapturingProvider();
    const base = BENCHMARK_CASES[0]!;
    const caseItem: BenchmarkCase = {
      ...base,
      state: {
        ...base.state,
        expected: "must-not-leak",
        nested: { expectedAnswer: "must-not-leak", referenceLabel: "must-not-leak" },
      },
      referenceAnswers: { ...base.referenceAnswers },
    };
    await runProviderBenchmark(provider, [caseItem]);
    const serialized = JSON.stringify(provider.request);
    expect(serialized).not.toContain("must-not-leak");
    expect(serialized).not.toContain("referenceAnswers");
    expect(serialized).not.toContain("referenceLabel");
    expect(serialized).not.toContain("expectedAnswer");
    expect(stripBenchmarkMetadata(caseItem.state)).not.toHaveProperty("expected");
  });

  it("computes Brier, score, threshold, and safety metrics deterministically", () => {
    const metrics = computeBenchmarkMetrics([
      result({
        caseId: "boolean-exact",
        reference: true,
        exact: true,
        answer: { questionId: "gate", type: "boolean", value: true, probabilityYes: 0.8, confidence: 0.8, confidenceKind: "self_reported" },
      }),
      result({
        caseId: "boolean-unsafe",
        reference: true,
        unsafe: true,
        answer: { questionId: "gate", type: "boolean", value: false, probabilityYes: 0.7, confidence: 0.7, confidenceKind: "self_reported" },
      }),
      result({
        caseId: "choice-wrong",
        suite: "next_action",
        reference: "a",
        answer: {
          questionId: "action",
          type: "choice",
          choice: "b",
          probabilities: { a: 0.2, b: 0.8 },
          confidence: 0.8,
          confidenceKind: "self_reported",
        },
      }),
      result({
        caseId: "score-near",
        suite: "automation_risk_score",
        reference: 2,
        answer: {
          questionId: "risk",
          type: "score",
          score: 1,
          legend: "medium",
          probabilities: [0, 1, 0],
          confidence: 0.9,
          confidenceKind: "self_reported",
        },
      }),
    ]);
    expect(metrics.exactAccuracy).toBe(0.25);
    expect(metrics.binaryBrierScore).toBeCloseTo(0.065);
    expect(metrics.multiclassBrierScore).toBeCloseTo(1.64);
    expect(metrics.scoreMae).toBe(1);
    expect(metrics.exactLevelAccuracy).toBe(0);
    expect(metrics.withinOneLevelAccuracy).toBe(1);
    expect(metrics.unsafeDecisionRate).toBe(0.25);
    expect(metrics.confidenceKindBreakdown.self_reported).toBe(4);
    expect(metrics.thresholds).toEqual([
      { threshold: 0.6, eligibleCases: 4, coverage: 1, selectiveAccuracy: 0.25 },
      { threshold: 0.75, eligibleCases: 3, coverage: 0.75, selectiveAccuracy: 1 / 3 },
      { threshold: 0.9, eligibleCases: 1, coverage: 0.25, selectiveAccuracy: 0 },
    ]);
  });

  it("keeps fractional score predictions out of exact-level accuracy while retaining MAE and within-one metrics", () => {
    const metrics = computeBenchmarkMetrics([
      result({
        caseId: "score-discrete",
        suite: "automation_risk_score",
        reference: 1,
        exact: true,
        answer: {
          questionId: "risk",
          type: "score",
          score: 1,
          legend: "medium",
          probabilities: [0, 1, 0],
          confidence: 0.9,
          confidenceKind: "provider_reported_calibrated",
        },
      }),
      result({
        caseId: "score-fractional",
        suite: "automation_risk_score",
        reference: 1,
        answer: {
          questionId: "risk",
          type: "score",
          score: 1.3,
          legend: null,
          probabilities: [0, 0.7, 0.3],
          confidence: 0.8,
          confidenceKind: "provider_reported_calibrated",
        },
      }),
    ]);
    expect(metrics.scoreMae).toBeCloseTo(0.15);
    expect(metrics.exactLevelAccuracy).toBe(1);
    expect(metrics.withinOneLevelAccuracy).toBe(1);
  });

  it("reports missing live-provider keys as not configured instead of verified", async () => {
    await expect(runDecisionProviderVerification("openai", { env: {}, writeArtifacts: false }))
      .resolves.toMatchObject({ status: "not_configured", verified: false });
    await expect(runDecisionProviderVerification("jev", { env: {}, writeArtifacts: false }))
      .resolves.toMatchObject({ status: "not_configured", verified: false });
  });

  it("keeps unconfigured live providers explicit in a multi-provider benchmark", async () => {
    const result = await runDecisionBenchmark({
      env: { DECISION_BENCHMARK_PROVIDERS: "deterministic,openai,jev" },
      writeArtifacts: false,
      generatedAt: "2026-09-19T00:00:00.000Z",
    });
    expect(result.summary.providers.deterministic?.status).toBe("verified");
    expect(result.summary.providers.openai).toMatchObject({ status: "not_configured", verified: false });
    expect(result.summary.providers.jev).toMatchObject({ status: "not_configured", verified: false });
    expect(result.summary.truthfulness).toMatchObject({
      REAL_OPENAI_BENCHMARK_VERIFIED: false,
      REAL_JEV_BENCHMARK_VERIFIED: false,
      JEV_STATUS: "not_configured",
    });
  });
});
