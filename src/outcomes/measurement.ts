import type { OutcomeBaseline, OutcomeCurrent } from "./types.js";

export function compareOutcomeValues(
  comparison: "eq" | "lte" | "gte",
  current: number | string,
  target: number | string,
) {
  if (comparison === "eq") return current === target;
  if (typeof current !== "number" || typeof target !== "number") return false;
  if (comparison === "lte") return current <= target;
  return current >= target;
}

export function directionStatus(
  baseline: number | string,
  current: number | string,
  betterDirection: "lower" | "higher" | "toward_target",
  target: number | string,
) {
  if (typeof baseline !== "number" || typeof current !== "number") {
    if (baseline === current) return "unchanged" as const;
    return "improved" as const;
  }
  if (current === baseline) return "unchanged" as const;
  if (betterDirection === "lower") return current < baseline ? "improved" as const : "worsened" as const;
  if (betterDirection === "higher") return current > baseline ? "improved" as const : "worsened" as const;
  if (typeof target !== "number") return "unchanged" as const;
  const baselineDistance = Math.abs(baseline - target);
  const currentDistance = Math.abs(current - target);
  if (currentDistance < baselineDistance) return "improved" as const;
  if (currentDistance > baselineDistance) return "worsened" as const;
  return "unchanged" as const;
}

export function baselineFromMetrics(
  metricKey: string,
  exceptionMetrics: Record<string, number>,
  evaluationMetrics: Record<string, number>,
): OutcomeBaseline | undefined {
  if (typeof exceptionMetrics[metricKey] === "number") {
    return { metricKey, value: exceptionMetrics[metricKey], source: "exception_metrics" };
  }
  if (typeof evaluationMetrics[metricKey] === "number") {
    return { metricKey, value: evaluationMetrics[metricKey], source: "rule_evaluation_metrics" };
  }
  return undefined;
}

export function emptyCurrent(field: string, evidenceIds: string[] = []): OutcomeCurrent {
  return { field, value: null, evidenceIds };
}
