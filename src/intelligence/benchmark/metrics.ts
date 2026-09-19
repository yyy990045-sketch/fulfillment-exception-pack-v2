import type { DecisionAnswer, DecisionConfidenceKind } from "../decision-runtime/index.js";
import type {
  BenchmarkCaseResult,
  BenchmarkMetrics,
  BenchmarkReferenceValue,
  BenchmarkThresholdMetrics,
  BenchmarkUsage,
} from "./types.js";
import { extractTokenUsage } from "./pricing.js";

const CONFIDENCE_KINDS: Array<DecisionConfidenceKind | "none"> = [
  "deterministic",
  "provider_reported_calibrated",
  "self_reported",
  "probability_only",
  "none",
];

function valueMatches(answer: DecisionAnswer, expected: BenchmarkReferenceValue) {
  if (answer.type === "boolean") return typeof expected === "boolean" && answer.value === expected;
  if (answer.type === "choice") return typeof expected === "string" && answer.choice === expected;
  return typeof expected === "number" && answer.score === expected;
}

function quantile(values: number[], ratio: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index]!;
}

function probabilityDistance(probabilities: number[] | Record<string, number>, expectedIndex: number) {
  const values = Array.isArray(probabilities) ? probabilities : Object.values(probabilities);
  return values.reduce((sum, probability, index) => {
    const target = index === expectedIndex ? 1 : 0;
    return sum + (probability - target) ** 2;
  }, 0);
}

function decisionStrength(answer: DecisionAnswer): number | null {
  if (answer.type === "boolean") {
    return answer.probabilityYes === null ? null : Math.max(answer.probabilityYes, 1 - answer.probabilityYes);
  }
  if (answer.type === "choice") {
    return answer.probabilities === null ? null : Math.max(...Object.values(answer.probabilities));
  }
  return answer.probabilities === null ? null : Math.max(...answer.probabilities);
}

function thresholdMetrics(results: BenchmarkCaseResult[], threshold: number): BenchmarkThresholdMetrics {
  const answered = results.filter((item) => item.status === "succeeded" && item.answer);
  const eligible = answered.filter((item) => {
    const strength = item.answer ? decisionStrength(item.answer) : null;
    return strength !== null && strength >= threshold;
  });
  return {
    threshold,
    eligibleCases: eligible.length,
    coverage: answered.length ? eligible.length / answered.length : 0,
    selectiveAccuracy: eligible.length ? eligible.filter((item) => item.exact).length / eligible.length : null,
  };
}

function aggregateUsage(results: BenchmarkCaseResult[], pricing: BenchmarkUsage): BenchmarkUsage {
  let inputTokens = 0;
  let outputTokens = 0;
  let hasInput = false;
  let hasOutput = false;
  for (const result of results) {
    const usage = extractTokenUsage(result.usage);
    if (usage.inputTokens !== null) {
      inputTokens += usage.inputTokens;
      hasInput = true;
    }
    if (usage.outputTokens !== null) {
      outputTokens += usage.outputTokens;
      hasOutput = true;
    }
  }
  return {
    inputTokens: hasInput ? inputTokens : null,
    outputTokens: hasOutput ? outputTokens : null,
    estimatedCostUsd: pricing.estimatedCostUsd,
  };
}

export function computeBenchmarkMetrics(
  results: BenchmarkCaseResult[],
  pricing: BenchmarkUsage = { inputTokens: null, outputTokens: null, estimatedCostUsd: null },
): BenchmarkMetrics {
  const caseCount = results.length;
  const successful = results.filter((item) => item.status === "succeeded" && item.answer);
  const failedCases = caseCount - successful.length;
  const exactCorrect = successful.filter((item) => item.exact).length;
  const latencies = results.map((item) => item.latencyMs);
  const confidenceKindBreakdown = Object.fromEntries(CONFIDENCE_KINDS.map((kind) => [kind, 0])) as Record<DecisionConfidenceKind | "none", number>;
  let binaryBrierTotal = 0;
  let binaryBrierCount = 0;
  let multiclassBrierTotal = 0;
  let multiclassBrierCount = 0;
  let scoreAbsoluteError = 0;
  let scoreCount = 0;
  let exactLevelCount = 0;
  let exactLevelCountEligible = 0;
  let withinOneCount = 0;

  for (const result of successful) {
    const answer = result.answer!;
    confidenceKindBreakdown[answer.confidenceKind ?? "none"] += 1;
    const expected: BenchmarkReferenceValue = result.reference;
    if (expected === undefined) continue;
    if (answer.type === "boolean" && typeof expected === "boolean") {
      if (answer.probabilityYes !== null) {
        binaryBrierTotal += (answer.probabilityYes - (expected ? 1 : 0)) ** 2;
        binaryBrierCount += 1;
      }
      continue;
    }
    if (answer.type === "choice" && typeof expected === "string" && answer.probabilities) {
      const expectedIndex = Object.keys(answer.probabilities).indexOf(expected);
      if (expectedIndex >= 0) {
        multiclassBrierTotal += probabilityDistance(answer.probabilities, expectedIndex);
        multiclassBrierCount += 1;
      }
      continue;
    }
    if (answer.type === "score" && typeof expected === "number") {
      scoreAbsoluteError += Math.abs(answer.score - expected);
      scoreCount += 1;
      if (Number.isInteger(answer.score)) {
        exactLevelCountEligible += 1;
        if (answer.score === expected) exactLevelCount += 1;
      }
      if (Math.abs(answer.score - expected) <= 1) withinOneCount += 1;
      if (answer.probabilities) {
        multiclassBrierTotal += probabilityDistance(answer.probabilities, expected);
        multiclassBrierCount += 1;
      }
    }
  }

  return {
    caseCount,
    successfulCases: successful.length,
    failedCases,
    schemaValidRate: caseCount ? successful.length / caseCount : 0,
    exactAccuracy: caseCount ? exactCorrect / caseCount : 0,
    binaryBrierScore: binaryBrierCount ? binaryBrierTotal / binaryBrierCount : null,
    multiclassBrierScore: multiclassBrierCount ? multiclassBrierTotal / multiclassBrierCount : null,
    scoreMae: scoreCount ? scoreAbsoluteError / scoreCount : null,
    exactLevelAccuracy: exactLevelCountEligible ? exactLevelCount / exactLevelCountEligible : null,
    withinOneLevelAccuracy: scoreCount ? withinOneCount / scoreCount : null,
    latencyP50Ms: quantile(latencies, 0.5),
    latencyP95Ms: quantile(latencies, 0.95),
    errorRate: caseCount ? failedCases / caseCount : 0,
    unsafeDecisionRate: successful.length ? successful.filter((item) => item.unsafe).length / successful.length : 0,
    confidenceKindBreakdown,
    thresholds: [0.6, 0.75, 0.9].map((threshold) => thresholdMetrics(results, threshold)),
    usage: aggregateUsage(results, pricing),
  };
}
