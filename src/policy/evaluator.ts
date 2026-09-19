import type { PolicyDefinitionRecord } from "../domain/v2/policy-types.js";
import { parsePolicyDecision } from "./definitions.js";
import type {
  PolicyActionMetadata,
  PolicyCondition,
  PolicyContextFacts,
  PolicyEvaluationDecision,
} from "./types.js";

function parseCondition(value: unknown): PolicyCondition {
  if (!value || typeof value !== "object") throw new Error("POLICY_CONDITION_INVALID");
  const record = value as Record<string, unknown>;
  const op = String(record.op);
  if (op === "actionTypeIn" || op === "exceptionCodeIn" || op === "severityIn" || op === "candidateSourceIn") {
    if (!Array.isArray(record.values) || record.values.length === 0) throw new Error("POLICY_CONDITION_INVALID");
  } else if (["hasClaimEvidence", "customerFacing", "financialMovement", "legalEffect"].includes(op)) {
    if (typeof record.value !== "boolean") throw new Error("POLICY_CONDITION_INVALID");
  } else {
    throw new Error("POLICY_CONDITION_INVALID");
  }
  return value as PolicyCondition;
}

function conditionMatches(condition: PolicyCondition, facts: PolicyContextFacts, metadata: PolicyActionMetadata) {
  switch (condition.op) {
    case "actionTypeIn": return condition.values.includes(facts.actionType);
    case "exceptionCodeIn": return condition.values.includes(facts.exceptionCode);
    case "severityIn": return condition.values.includes(facts.severity);
    case "candidateSourceIn": return condition.values.includes(facts.candidateSource);
    case "hasClaimEvidence": return condition.value === facts.hasClaimEvidence;
    case "customerFacing": return condition.value === metadata.customerFacing;
    case "financialMovement": return condition.value === metadata.financialMovement;
    case "legalEffect": return condition.value === metadata.legalEffect;
  }
}

function rolesFor(mode: PolicyEvaluationDecision["mode"]) {
  if (mode === "human_only") return ["人工负责人"];
  if (mode === "approval_required") return ["独立审批人"];
  return [];
}

export function evaluatePolicyDefinitions(
  definitions: PolicyDefinitionRecord[],
  facts: PolicyContextFacts,
  actionMetadata: PolicyActionMetadata,
  policySnapshotHash: string,
): PolicyEvaluationDecision {
  const matches = definitions
    .filter((policy) => policy.enabled)
    .sort((left, right) => left.priority - right.priority)
    .flatMap((policy) => {
      const conditions = Array.isArray(policy.conditions)
        ? policy.conditions.map(parseCondition)
        : [];
      if (!conditions.every((condition) => conditionMatches(condition, facts, actionMetadata))) return [];
      return [{ policy, decision: parsePolicyDecision(policy.decision) }];
    });
  const selected = matches[0]?.decision ?? { mode: "human_only" as const, reason: "default_deny" };
  const reasons = [...new Set(matches.map((item) => item.decision.reason))];
  return {
    mode: selected.mode,
    matchedPolicyIds: matches.map((item) => item.policy.id),
    reasons: reasons.length ? reasons : [selected.reason],
    requiredRoles: rolesFor(selected.mode),
    actionMetadata,
    facts,
    policySnapshotHash,
    automationAvailable: false,
    executionPerformed: false,
  };
}
