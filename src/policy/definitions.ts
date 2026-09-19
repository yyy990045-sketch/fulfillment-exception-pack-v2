import { createHash } from "node:crypto";
import type { V2SqliteStore } from "../domain/v2/index.js";
import type { PolicyDecisionDefinition, PolicyDefinitionInput } from "./types.js";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function policyDefinitionContentHash(input: Pick<PolicyDefinitionInput, "id" | "version" | "priority" | "enabled" | "conditions" | "decision">) {
  return createHash("sha256").update(stableJson(input)).digest("hex");
}

export const DEFAULT_DECISION_POLICIES: PolicyDefinitionInput[] = [
  {
    id: "policy-reject-overclaim-human-only",
    version: "1.0.0",
    name: "Reject overclaim requires human decision",
    priority: 10,
    enabled: true,
    conditions: [{ op: "actionTypeIn", values: ["reject_overclaim"] }],
    decision: { mode: "human_only", reason: "customer_or_legal_consequence" },
  },
  {
    id: "policy-legal-effect-human-only",
    version: "1.0.0",
    name: "Legal effects always require human decision",
    priority: 20,
    enabled: true,
    conditions: [{ op: "legalEffect", value: true }],
    decision: { mode: "human_only", reason: "legal_effect_requires_human_decision" },
  },
  {
    id: "policy-financial-movement-human-only",
    version: "1.0.0",
    name: "Financial movement always requires human decision",
    priority: 30,
    enabled: true,
    conditions: [{ op: "financialMovement", value: true }],
    decision: { mode: "human_only", reason: "financial_movement_requires_human_decision" },
  },
  {
    id: "policy-urge-follow-up-approval",
    version: "1.0.0",
    name: "External follow-up requires approval",
    priority: 40,
    enabled: true,
    conditions: [{ op: "actionTypeIn", values: ["urge_follow_up"] }],
    decision: { mode: "approval_required", reason: "external_customer_communication" },
  },
  {
    id: "policy-review-quotation-approval",
    version: "1.0.0",
    name: "Quotation review requires approval",
    priority: 50,
    enabled: true,
    conditions: [{ op: "actionTypeIn", values: ["review_quotation"] }],
    decision: { mode: "approval_required", reason: "business_review_required" },
  },
  {
    id: "policy-create-task-auto-eligible",
    version: "1.0.0",
    name: "Internal task is an automation candidate",
    priority: 60,
    enabled: true,
    conditions: [
      { op: "actionTypeIn", values: ["create_task"] },
      { op: "customerFacing", value: false },
      { op: "financialMovement", value: false },
      { op: "legalEffect", value: false },
    ],
    decision: { mode: "auto_eligible", reason: "internal_reversible_action" },
  },
  {
    id: "policy-supplement-evidence-auto-eligible",
    version: "1.0.0",
    name: "Internal evidence request is an automation candidate",
    priority: 70,
    enabled: true,
    conditions: [
      { op: "actionTypeIn", values: ["supplement_evidence"] },
      { op: "customerFacing", value: false },
      { op: "financialMovement", value: false },
      { op: "legalEffect", value: false },
    ],
    decision: { mode: "auto_eligible", reason: "internal_reversible_action" },
  },
];

export function provisionDefaultDecisionPolicies(store: V2SqliteStore, tenantId = "demo-manufacturing") {
  const createdAt = "2026-09-01T00:00:00.000Z";
  return DEFAULT_DECISION_POLICIES.map((definition) => store.savePolicyDefinition({
    tenantId,
    ...definition,
    contentHash: policyDefinitionContentHash(definition),
    createdAt,
  }));
}

export function parsePolicyDecision(value: unknown): PolicyDecisionDefinition {
  if (!value || typeof value !== "object") throw new Error("POLICY_DECISION_INVALID");
  const record = value as Record<string, unknown>;
  if (!["human_only", "approval_required", "auto_eligible"].includes(String(record.mode))) throw new Error("POLICY_DECISION_INVALID");
  if (typeof record.reason !== "string" || !record.reason.trim()) throw new Error("POLICY_DECISION_INVALID");
  return { mode: record.mode as PolicyDecisionDefinition["mode"], reason: record.reason };
}
