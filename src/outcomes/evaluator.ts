import type { V2Evidence } from "../domain/v2/index.js";
import { compareOutcomeValues, directionStatus } from "./measurement.js";
import type { OutcomeBaseline, OutcomeCurrent, OutcomeStatus } from "./types.js";

export function evaluateOutcomeStatus(input: {
  baseline: OutcomeBaseline;
  current: OutcomeCurrent;
  comparison: "eq" | "lte" | "gte";
  targetValue: number | string;
  betterDirection: "lower" | "higher" | "toward_target";
}): OutcomeStatus {
  if (input.current.value === null) return "insufficient_evidence";
  if (compareOutcomeValues(input.comparison, input.current.value, input.targetValue)) return "target_met";
  return directionStatus(input.baseline.value, input.current.value, input.betterDirection, input.targetValue);
}

export function latestMatchingEvidence(
  evidence: V2Evidence[],
  field: string,
  requestedIds: string[],
) {
  if (!requestedIds.length) return undefined;
  const byId = new Map(evidence.map((item) => [item.id, item]));
  return requestedIds
    .flatMap((id) => {
      const item = byId.get(id);
      return item && item.field === field ? [item] : [];
    })
    .sort((left, right) => right.observedAt.localeCompare(left.observedAt) || right.id.localeCompare(left.id))[0];
}
