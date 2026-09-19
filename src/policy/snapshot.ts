import { createHash } from "node:crypto";
import type { PolicyDefinitionRecord } from "../domain/v2/policy-types.js";
import type { PolicyActionMetadata, PolicyContextFacts } from "./types.js";

export type PolicySnapshotPayload = {
  exceptionId: string;
  latestRuleEvaluationId: string;
  actionMetadata: PolicyActionMetadata;
  facts: PolicyContextFacts;
  policyDefinitions: PolicyDefinitionRecord[];
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function policySnapshotHash(input: PolicySnapshotPayload) {
  return createHash("sha256").update(stableJson({
    schemaVersion: "decision-policy/v1",
    exceptionId: input.exceptionId,
    latestRuleEvaluationId: input.latestRuleEvaluationId,
    actionMetadata: input.actionMetadata,
    facts: input.facts,
    policyDefinitions: input.policyDefinitions
      .map((policy) => ({ id: policy.id, version: policy.version, contentHash: policy.contentHash, enabled: policy.enabled }))
      .sort((left, right) => `${left.id}:${left.version}`.localeCompare(`${right.id}:${right.version}`)),
  })).digest("hex");
}
