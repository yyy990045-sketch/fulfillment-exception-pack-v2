import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  InternalAutomationExecutor,
  buildAutomationReadiness,
  executePolicyAutomation,
  resolveAutomationExecutor,
} from "../src/automation/index.js";
import { DeterministicDecisionRecommendationProvider, generateDecisionRecommendation } from "../src/ai/decision/index.js";
import {
  evaluateDecisionPolicy,
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
const enabledEnv = { AUTOMATION_ENABLED: "true", AUTOMATION_EXECUTOR: "internal" };
const internalExecutor = new InternalAutomationExecutor();

function openStore() {
  const dir = mkdtempSync(join(tmpdir(), "fep-automation-"));
  const db = new sqlite!.DatabaseSync(join(dir, "automation.sqlite"));
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

describe("policy-bounded automation", () => {
  it("creates one persisted task Work Item, Run, and Receipt", () => {
    const store = openStore();
    const exception = heroException(store);
    const evaluation = evaluateDecisionPolicy(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, { actionType: "create_task" }, "quality-owner");
    const beforeResolutions = store.listResolutionCases("demo-manufacturing", "ctx-so-mfg-001").length;
    const beforeException = structuredClone(exception);
    const result = executePolicyAutomation(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, evaluation.id, "quality-owner", "human_request", { env: enabledEnv, executor: internalExecutor });
    expect(result.run.status).toBe("succeeded");
    expect(result.workItem).toMatchObject({ kind: "task", status: "open", source: "policy_automation" });
    expect(result.receipt).toMatchObject({ status: "succeeded", receiptSource: "internal-work-item" });
    expect(store.listResolutionCases("demo-manufacturing", "ctx-so-mfg-001")).toHaveLength(beforeResolutions);
    expect(heroException(store)).toMatchObject({ id: beforeException.id, status: beforeException.status, latestRuleEvaluationId: beforeException.latestRuleEvaluationId });
  });

  it("creates an evidence request Work Item", () => {
    const store = openStore();
    const exception = heroException(store);
    const evaluation = evaluateDecisionPolicy(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, { actionType: "supplement_evidence" }, "quality-owner");
    const result = executePolicyAutomation(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, evaluation.id, "quality-owner", "human_request", { env: enabledEnv, executor: internalExecutor });
    expect(result.workItem?.kind).toBe("evidence_request");
  });

  it("does not execute approval-required or human-only policy modes", () => {
    for (const actionType of ["urge_follow_up", "approve_or_change_quotation_terms", "reject_overclaim"] as const) {
      const store = openStore();
      const exception = heroException(store);
      const evaluation = evaluateDecisionPolicy(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, { actionType }, "quality-owner");
      expect(() => executePolicyAutomation(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, evaluation.id, "quality-owner", "human_request", { env: enabledEnv, executor: internalExecutor }))
        .toThrow(/AUTOMATION_POLICY_NOT_ELIGIBLE/);
      expect(store.listAutomationRuns("demo-manufacturing", "ctx-so-mfg-001", exception.id)).toHaveLength(0);
      expect(store.listInternalWorkItems("demo-manufacturing")).toHaveLength(0);
    }
  });

  it("blocks a malicious auto-eligible policy for a risky action", () => {
    const store = openStore();
    const exception = heroException(store);
    provisionDefaultDecisionPolicies(store, "demo-manufacturing");
    const definition = {
      id: "policy-malicious-reject-auto",
      version: "1.0.0",
      name: "Malicious auto reject",
      priority: 1,
      enabled: true,
      conditions: [{ op: "actionTypeIn", values: ["reject_overclaim"] as const }],
      decision: { mode: "auto_eligible" as const, reason: "misconfigured" },
    };
    store.savePolicyDefinition({
      tenantId: "demo-manufacturing",
      ...definition,
      conditions: definition.conditions,
      contentHash: policyDefinitionContentHash(definition as any),
      createdAt: "2026-09-23T00:00:00.000Z",
    });
    const evaluation = evaluateDecisionPolicy(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, { actionType: "reject_overclaim" }, "quality-owner");
    expect(evaluation.decision.mode).toBe("auto_eligible");
    expect(() => executePolicyAutomation(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, evaluation.id, "quality-owner", "human_request", { env: enabledEnv, executor: internalExecutor }))
      .toThrow(/AUTOMATION_EFFECT_NOT_ALLOWED/);
    expect(store.listAutomationRuns("demo-manufacturing", "ctx-so-mfg-001", exception.id)).toHaveLength(0);
  });

  it("fails closed when disabled, unknown, stale policy, or stale recommendation", async () => {
    const store = openStore();
    const exception = heroException(store);
    const evaluation = evaluateDecisionPolicy(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, { actionType: "create_task" }, "quality-owner");
    expect(() => resolveAutomationExecutor({ env: {} })).toThrow(/AUTOMATION_DISABLED/);
    expect(() => resolveAutomationExecutor({ env: { AUTOMATION_ENABLED: "true", AUTOMATION_EXECUTOR: "unknown" } })).toThrow(/AUTOMATION_EXECUTOR_NOT_CONFIGURED/);

    provisionDefaultDecisionPolicies(store, "demo-manufacturing");
    const changed = {
      id: "policy-create-task-auto-eligible",
      version: "1.0.1",
      name: "Changed task policy",
      priority: 60,
      enabled: true,
      conditions: [{ op: "actionTypeIn", values: ["create_task"] as const }],
      decision: { mode: "auto_eligible" as const, reason: "changed" },
    };
    store.savePolicyDefinition({
      tenantId: "demo-manufacturing",
      ...changed,
      conditions: changed.conditions,
      contentHash: policyDefinitionContentHash(changed as any),
      createdAt: "2026-09-24T00:00:00.000Z",
    });
    expect(() => executePolicyAutomation(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, evaluation.id, "quality-owner", "human_request", { env: enabledEnv, executor: internalExecutor }))
      .toThrow(/AUTOMATION_POLICY_STALE/);

    const recommendationStore = openStore();
    const recommendationException = heroException(recommendationStore);
    const recommendation = await generateDecisionRecommendation(recommendationStore, new DeterministicDecisionRecommendationProvider(), "demo-manufacturing", "ctx-so-mfg-001", recommendationException.id, "quality-owner");
    const option = recommendation.output.options[0]!;
    const aiEvaluation = evaluateDecisionPolicy(recommendationStore, "demo-manufacturing", "ctx-so-mfg-001", recommendationException.id, { recommendationId: recommendation.id, optionId: option.id }, "quality-owner");
    const evidence = recommendationStore.replayContext("demo-manufacturing", "ctx-so-mfg-001").evidence.find((item) => item.id === "evidence-complaint-mfg-claimed")!;
    recommendationStore.saveEvidence({ ...evidence, id: "evidence-complaint-mfg-automation-v2", value: 82, observedAt: "2026-09-25T00:00:00.000Z", createdAt: "2026-09-25T00:00:00.000Z" });
    evaluateContextRules(recommendationStore, "demo-manufacturing", "ctx-so-mfg-001");
    expect(() => executePolicyAutomation(recommendationStore, "demo-manufacturing", "ctx-so-mfg-001", recommendationException.id, aiEvaluation.id, "quality-owner", "human_request", { env: enabledEnv, executor: internalExecutor }))
      .toThrow(/AUTOMATION_POLICY_STALE/);
  });

  it("is idempotent and produces no duplicate records", () => {
    const store = openStore();
    const exception = heroException(store);
    const evaluation = evaluateDecisionPolicy(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, { actionType: "create_task" }, "quality-owner");
    const first = executePolicyAutomation(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, evaluation.id, "quality-owner", "human_request", { env: enabledEnv, executor: internalExecutor });
    const second = executePolicyAutomation(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, evaluation.id, "quality-owner", "human_request", { env: enabledEnv, executor: internalExecutor });
    expect(second.run.id).toBe(first.run.id);
    expect(second.workItem?.id).toBe(first.workItem?.id);
    expect(second.receipt?.id).toBe(first.receipt?.id);
    expect(store.listAutomationRuns("demo-manufacturing", "ctx-so-mfg-001", exception.id)).toHaveLength(1);
    expect(store.listInternalWorkItems("demo-manufacturing")).toHaveLength(1);
    expect(store.listAutomationReceipts("demo-manufacturing", "ctx-so-mfg-001", exception.id)).toHaveLength(1);
  });

  it("records executor failure without a successful Work Item or Receipt", () => {
    const store = openStore();
    const exception = heroException(store);
    const evaluation = evaluateDecisionPolicy(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, { actionType: "create_task" }, "quality-owner");
    const failingExecutor = {
      name: "internal",
      version: "internal-work-item-v1",
      supports: () => true,
      execute: () => { throw new Error("effect failure"); },
    };
    const result = executePolicyAutomation(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, evaluation.id, "quality-owner", "human_request", { env: enabledEnv, executor: failingExecutor });
    expect(result.run.status).toBe("failed");
    expect(result.workItem).toBeUndefined();
    expect(result.receipt).toBeUndefined();
    expect(store.listInternalWorkItems("demo-manufacturing")).toHaveLength(0);
    expect(store.listAutomationReceipts("demo-manufacturing", "ctx-so-mfg-001", exception.id)).toHaveLength(0);
  });

  it("keeps readiness and work-item queries side-effect free", () => {
    const store = openStore();
    const exception = heroException(store);
    const evaluation = evaluateDecisionPolicy(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, { actionType: "create_task" }, "quality-owner");
    const before = store.listAutomationRuns("demo-manufacturing", "ctx-so-mfg-001", exception.id).length;
    const readiness = buildAutomationReadiness(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, evaluation.id, { env: enabledEnv, executor: internalExecutor });
    expect(readiness.executable).toBe(true);
    expect(store.listAutomationRuns("demo-manufacturing", "ctx-so-mfg-001", exception.id)).toHaveLength(before);
  });
});
