import { createHash } from "node:crypto";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function outcomeSnapshotHash(input: {
  definitionContentHash: string;
  ruleEvaluationId: string;
  evidence: Array<{ id: string; sourceVersion: string; value: unknown }>;
  resolutionCaseId?: string;
  automationRunId?: string;
}) {
  return createHash("sha256").update(stableJson({
    schemaVersion: "outcome-intelligence/v1",
    definitionContentHash: input.definitionContentHash,
    ruleEvaluationId: input.ruleEvaluationId,
    evidence: [...input.evidence].sort((left, right) => left.id.localeCompare(right.id)),
    intervention: input.resolutionCaseId ?? input.automationRunId ?? null,
  })).digest("hex");
}
