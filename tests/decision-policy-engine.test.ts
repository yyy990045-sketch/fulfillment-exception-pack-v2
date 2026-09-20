import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DeterministicDecisionRecommendationProvider, generateDecisionRecommendation } from "../src/ai/decision/index.js";
import {
  evaluateDecisionPolicy,
  evaluatePolicyDefinitions,
  getPolicyActionMetadata,
  listPolicyEvaluations,
  policyDefinitionContentHash,
  provisionDefaultDecisionPolicies,
} from "../src/policy/index.js";
import {
  V2SqliteStore,
  evaluateContextRules,
  provisionV2ManufacturingDemoData,
} from "../src/domain/v2/index.js";

type DatabaseSyncLike = {
  exec(sql: string): void;
  prepare(sql: string): { all(...params: unknown[]): unknown[]; get(...params: unknown[]): unknown; run(...params: unknown[]): unknown };
  close(): void;
};
type DatabaseSyncConstructor = new (path: string) => DatabaseSyncLike;
const sqlite = process.getBuiltinModule("node:sqlite") as { DatabaseSync: DatabaseSyncConstructor } | undefined;
if (!sqlite?.DatabaseSync) throw new Error("sqlite_backend_requires_node_22_5_or_newer");
const databases: DatabaseSyncLike[] = [];
const deterministicDecision = new DeterministicDecisionRecommendationProvider();

function openStore() {
  const dir = mkdtempSync(join(tmpdir(), "fep-policy-"));
  const db = new sqlite!.DatabaseSync(join(dir, "policy.sqlite"));
  databases.push(db);
  const store = new V2SqliteStore(db);
  provisionV2ManufacturingDemoData(store);
  evaluateContextRules(store, "demo-manufacturing", "ctx-so-mfg-001");
  return store;
}

function heroException(store: V2SqliteStore, code = "CUSTOMER_RECEIPT_CLAIM_MISMATCH") {
  return store.listExceptions("demo-manufacturing", "ctx-so-mfg-001").find((item) => item.code === code)!;
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("Decision Policy Engine", () => {
  it("requires explicit default policy provisioning", () => {
    const store = openStore();
    expect(store.listPolicyDefinitions("demo-manufacturing")).toHaveLength(0);
    expect(provisionDefaultDecisionPolicies(store, "demo-manufacturing")).toHaveLength(8);
    expect(store.listPolicyDefinitions("demo-manufacturing")).toHaveLength(8);
  });

  it("maps internal actions to auto_eligible and customer-facing actions to approval", () => {
    const store = openStore();
    const exception = heroException(store);
    const cases = [
      ["create_task", "auto_eligible"],
      ["supplement_evidence", "auto_eligible"],
      ["urge_follow_up", "approval_required"],
      ["route_quotation_to_review", "auto_eligible"],
      ["approve_or_change_quotation_terms", "human_only"],
      ["reject_overclaim", "human_only"],
    ] as const;
    for (const [actionType, mode] of cases) {
      const result = evaluateDecisionPolicy(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, { actionType }, "quality-owner");
      expect(result.decision.mode).toBe(mode);
      expect(result.decision.automationAvailable).toBe(false);
      expect(result.decision.executionPerformed).toBe(false);
    }
  });

  it("keeps legal and financial effects human-only", () => {
    const store = openStore();
    const exception = heroException(store);
    provisionDefaultDecisionPolicies(store, "demo-manufacturing");
    const result = evaluateDecisionPolicy(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, { actionType: "reject_overclaim" }, "quality-owner");
    expect(result.decision.mode).toBe("human_only");
    expect(result.decision.matchedPolicyIds).toContain("policy-legal-effect-human-only");
    expect(result.decision.matchedPolicyIds).toContain("policy-financial-movement-human-only");
    expect(result.decision.actionMetadata.legalEffect).toBe(true);
    expect(result.decision.actionMetadata.financialMovement).toBe(true);

    const definitions = store.listPolicyDefinitions("demo-manufacturing", true);
    const facts = {
      exceptionCode: "CUSTOMER_RECEIPT_CLAIM_MISMATCH" as const,
      severity: "high" as const,
      actionType: "create_task" as const,
      evidenceCount: 2,
      sourceSystemCount: 2,
      hasClaimEvidence: true,
      allEvidenceSupported: true,
      candidateSource: "human" as const,
    };
    const legal = evaluatePolicyDefinitions(definitions, facts, { ...getPolicyActionMetadata("create_task"), legalEffect: true }, "a".repeat(64));
    const financial = evaluatePolicyDefinitions(definitions, facts, { ...getPolicyActionMetadata("create_task"), financialMovement: true }, "b".repeat(64));
    expect(legal.mode).toBe("human_only");
    expect(financial.mode).toBe("human_only");
  });

  it("defaults to human_only when no policy matches", () => {
    const metadata = getPolicyActionMetadata("create_task");
    const result = evaluatePolicyDefinitions([], {
      exceptionCode: "CUSTOMER_RECEIPT_CLAIM_MISMATCH",
      severity: "high",
      actionType: "create_task",
      evidenceCount: 2,
      sourceSystemCount: 2,
      hasClaimEvidence: true,
      allEvidenceSupported: true,
      candidateSource: "human",
    }, metadata, "a".repeat(64));
    expect(result.mode).toBe("human_only");
    expect(result.reasons).toEqual(["default_deny"]);
  });

  it("fails closed for an unknown action type", () => {
    const store = openStore();
    const exception = heroException(store);
    expect(() => evaluateDecisionPolicy(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, { actionType: "unknown_action" as any }, "quality-owner"))
      .toThrow(/POLICY_ACTION_INVALID/);
  });

  it("evaluates an AI Recommendation option without allowing AI to override policy", async () => {
    const store = openStore();
    const exception = heroException(store);
    const recommendation = await generateDecisionRecommendation(store, deterministicDecision, "demo-manufacturing", "ctx-so-mfg-001", exception.id, "quality-owner");
    const option = recommendation.output.options.find((item) => item.actionType === "urge_follow_up")
      ?? recommendation.output.options.find((item) => item.actionType === "create_task")!;
    const result = evaluateDecisionPolicy(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, {
      recommendationId: recommendation.id,
      optionId: option.id,
    }, "quality-owner");
    expect(result.candidateSource).toBe("ai_recommendation");
    expect(result.decision.mode).toBe(option.actionType === "create_task" ? "auto_eligible" : "approval_required");
  });

  it("rejects stale recommendations and unknown options", async () => {
    const store = openStore();
    const exception = heroException(store);
    const recommendation = await generateDecisionRecommendation(store, deterministicDecision, "demo-manufacturing", "ctx-so-mfg-001", exception.id, "quality-owner");
    expect(() => evaluateDecisionPolicy(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, {
      recommendationId: recommendation.id,
      optionId: "missing-option",
    }, "quality-owner")).toThrow(/POLICY_RECOMMENDATION_OPTION_NOT_FOUND/);

    const evidence = store.replayContext("demo-manufacturing", "ctx-so-mfg-001").evidence.find((item) => item.id === "evidence-complaint-mfg-claimed")!;
    store.saveEvidence({ ...evidence, id: "evidence-complaint-mfg-claimed-policy-v2", value: 82, observedAt: "2026-09-21T00:00:00.000Z", createdAt: "2026-09-21T00:00:00.000Z" });
    evaluateContextRules(store, "demo-manufacturing", "ctx-so-mfg-001");
    expect(() => evaluateDecisionPolicy(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, {
      recommendationId: recommendation.id,
      optionId: recommendation.output.options[0]!.id,
    }, "quality-owner")).toThrow(/POLICY_RECOMMENDATION_STALE/);
  });

  it("is idempotent for the same policy snapshot", () => {
    const store = openStore();
    const exception = heroException(store);
    const first = evaluateDecisionPolicy(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, { actionType: "create_task" }, "quality-owner");
    const second = evaluateDecisionPolicy(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, { actionType: "create_task" }, "quality-owner");
    expect(second.id).toBe(first.id);
    expect(listPolicyEvaluations(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id)).toHaveLength(1);
  });

  it("marks an evaluation stale when the policy version changes", () => {
    const store = openStore();
    const exception = heroException(store);
    const first = evaluateDecisionPolicy(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, { actionType: "create_task" }, "quality-owner");
    const replacement = {
      id: "policy-human-review-all",
      version: "1.0.0",
      name: "Human review all actions",
      priority: 1,
      enabled: true,
      conditions: [{ op: "actionTypeIn", values: ["create_task"] as const }],
      decision: { mode: "approval_required" as const, reason: "local_test_change" },
    };
    store.savePolicyDefinition({
      tenantId: "demo-manufacturing",
      ...replacement,
      conditions: replacement.conditions,
      contentHash: policyDefinitionContentHash(replacement as any),
      createdAt: "2026-09-22T00:00:00.000Z",
    });
    const stale = listPolicyEvaluations(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id).find((item) => item.id === first.id)!;
    expect(stale.stale).toBe(true);
  });

  it("isolates policy evaluations by tenant and does not mutate Resolution state", () => {
    const store = openStore();
    const exception = heroException(store);
    const before = store.listResolutionCases("demo-manufacturing", "ctx-so-mfg-001").length;
    const evaluation = evaluateDecisionPolicy(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, { actionType: "create_task" }, "quality-owner");
    expect(store.getPolicyEvaluation("other-tenant", evaluation.id)).toBeUndefined();
    expect(store.listResolutionCases("demo-manufacturing", "ctx-so-mfg-001")).toHaveLength(before);
    expect(listPolicyEvaluations(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id)).toHaveLength(1);
  });
});
