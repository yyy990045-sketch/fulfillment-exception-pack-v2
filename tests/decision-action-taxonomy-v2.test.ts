import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acceptExceptionCase,
  proposeResolution,
  reviewResolutionCase,
} from "../src/domain/v2/resolution/runtime.js";
import type { ResolutionActorContext } from "../src/domain/v2/resolution/authorization.js";
import type { ResolutionActionInput } from "../src/domain/v2/resolution/types.js";
import {
  V2SqliteStore,
  evaluateContextRules,
  provisionV2ManufacturingDemoData,
} from "../src/domain/v2/index.js";
import {
  BENCHMARK_CASES,
  BENCHMARK_V2_CASES,
  assertBenchmarkCaseIntegrity,
  assertBenchmarkV2CaseIntegrity,
  benchmarkDatasetSummary,
  benchmarkV2DatasetSummary,
  referenceHumanGovernance,
  runDecisionBenchmarkV2,
} from "../src/intelligence/benchmark/index.js";
import {
  evaluateDecisionPolicy,
  getPolicyActionMetadata,
  isWritableActionType,
  listWritableActionTypes,
} from "../src/policy/index.js";
import { buildAutomationReadiness } from "../src/automation/readiness.js";
import { policyModeForActionV2 } from "../src/policy/v2-boundary.js";

type DatabaseSyncLike = {
  exec(sql: string): void;
  prepare(sql: string): { all(...params: unknown[]): unknown[]; get(...params: unknown[]): unknown; run(...params: unknown[]): unknown };
  close(): void;
};
type DatabaseSyncConstructor = new (path: string) => DatabaseSyncLike;
const sqlite = process.getBuiltinModule("node:sqlite") as { DatabaseSync: DatabaseSyncConstructor } | undefined;
if (!sqlite?.DatabaseSync) throw new Error("sqlite_backend_requires_node_22_5_or_newer");
const databases: DatabaseSyncLike[] = [];

const actor: ResolutionActorContext = {
  subjectId: "taxonomy-owner",
  displayName: "品质负责人",
  roles: ["品质负责人"],
};

function openStore() {
  const dir = mkdtempSync(join(tmpdir(), "fep-taxonomy-v2-"));
  const db = new sqlite!.DatabaseSync(join(dir, "runtime.sqlite"));
  databases.push(db);
  const store = new V2SqliteStore(db);
  provisionV2ManufacturingDemoData(store);
  evaluateContextRules(store, "demo-manufacturing", "ctx-so-mfg-001");
  return store;
}

function heroException(store: V2SqliteStore) {
  return store.listExceptions("demo-manufacturing", "ctx-so-mfg-001")[0]!;
}

function confirmedResolution(store: V2SqliteStore) {
  const exception = heroException(store);
  const bundle = store.getExceptionEvidenceBundle("demo-manufacturing", exception.id)!;
  const accepted = acceptExceptionCase({
    exception,
    bundle,
    ownerRole: "品质负责人",
    rationale: "进入 taxonomy v2 测试",
    actor,
  });
  return reviewResolutionCase(accepted, {
    decision: "confirm",
    rationale: "确认异常",
    actor,
  });
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("Decision Action Taxonomy V2", () => {
  it("keeps legacy review_quotation readable but blocks new writes", () => {
    const store = openStore();
    const accepted = confirmedResolution(store);
    const legacy = {
      ...accepted,
      runtime: {
        ...accepted.runtime,
        actions: [{
          id: "legacy-action",
          type: "review_quotation",
          summary: "历史复核动作",
          status: "draft",
          idempotencyKey: "legacy-action-key",
          requiresApproval: true,
        }],
      },
    } as typeof accepted;
    store.saveResolutionCase(legacy);

    expect(store.getResolutionCase("demo-manufacturing", legacy.id)?.runtime.actions[0]?.type).toBe("review_quotation");
    expect(isWritableActionType("review_quotation")).toBe(false);
    expect(getPolicyActionMetadata("review_quotation").label).toContain("历史");

    const legacyInput = {
      actions: [{ type: "review_quotation", summary: "旧动作不能新写入" }],
      actor,
    } as unknown as { actions: ResolutionActionInput[]; actor: ResolutionActorContext };
    expect(() => proposeResolution(accepted, legacyInput)).toThrow("invalid_action_type");
  });

  it("keeps route and commercial-term actions semantically separate", () => {
    const route = getPolicyActionMetadata("route_quotation_to_review");
    const commercial = getPolicyActionMetadata("approve_or_change_quotation_terms");

    expect(route).toMatchObject({
      humanReviewTransition: true,
      requiresApprovalBeforeExecution: false,
      materialBusinessEffect: false,
      customerFacing: false,
      financialMovement: false,
      legalEffect: false,
      reversible: true,
    });
    expect(commercial).toMatchObject({
      humanReviewTransition: false,
      requiresApprovalBeforeExecution: true,
      materialBusinessEffect: true,
      customerFacing: true,
      financialMovement: true,
      reversible: false,
    });
  });

  it("does not create circular approval for the review transition", () => {
    const store = openStore();
    const exception = heroException(store);
    const route = evaluateDecisionPolicy(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, { actionType: "route_quotation_to_review" }, "taxonomy-owner");
    const commercial = evaluateDecisionPolicy(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, { actionType: "approve_or_change_quotation_terms" }, "taxonomy-owner");

    expect(route.decision.mode).toBe("auto_eligible");
    expect(route.decision.matchedPolicyIds).toContain("policy-route-quotation-review-auto-eligible");
    expect(route.decision.reasons).toEqual(["human_review_transition"]);
    expect(buildAutomationReadiness(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, route.id, {
      env: { AUTOMATION_ENABLED: "true", AUTOMATION_EXECUTOR: "internal" },
    })).toMatchObject({
      executable: false,
      reasons: expect.arrayContaining(["AUTOMATION_ACTION_NOT_SUPPORTED"]),
    });
    expect(commercial.decision.mode).toBe("human_only");
    expect(commercial.decision.matchedPolicyIds).toContain("policy-approve-quotation-terms-human-only");
    expect(commercial.decision.executionPerformed).toBe(false);
  });

  it("keeps V1 benchmark unchanged", () => {
    assertBenchmarkCaseIntegrity();
    expect(benchmarkDatasetSummary()).toMatchObject({ cases: 51 });
    expect(BENCHMARK_CASES.filter((item) => item.suite === "human_governance_gate" && item.id.includes("review_quotation"))).toHaveLength(3);
    expect(referenceHumanGovernance("review_quotation")).toBe(true);
  });

  it("builds a catalog-derived V2 benchmark without legacy actions", () => {
    assertBenchmarkV2CaseIntegrity();
    const store = openStore();
    const exception = heroException(store);
    const dataset = benchmarkV2DatasetSummary();
    expect(dataset).toMatchObject({
      schemaVersion: "decision-runtime-benchmark/v2",
      cases: 72,
      suites: { next_action: 0, human_governance_gate: 54, automation_risk_score: 18 },
      governanceQuestions: {
        isHumanReviewTransition: 18,
        requiresApprovalBeforeExecution: 18,
        hasMaterialBusinessEffect: 18,
      },
    });
    expect(BENCHMARK_V2_CASES.some((item) => item.state.candidateAction === "review_quotation")).toBe(false);
    for (const actionType of listWritableActionTypes()) {
      const expectedMode = policyModeForActionV2(actionType);
      expect(expectedMode).toMatch(
        actionType === "route_quotation_to_review" || actionType === "create_task" || actionType === "supplement_evidence"
          ? "auto_eligible"
          : actionType === "urge_follow_up"
            ? "approval_required"
            : "human_only",
      );
      expect(evaluateDecisionPolicy(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, { actionType }, "taxonomy-owner").decision.mode).toBe(expectedMode);
    }
  });

  it("runs the V2 deterministic integrity baseline", async () => {
    const result = await runDecisionBenchmarkV2({ env: {}, writeArtifacts: false });
    expect(result.summary.providers.deterministic).toMatchObject({
      status: "verified",
      verified: true,
      overall: { caseCount: 72, successfulCases: 72, exactAccuracy: 1, unsafeDecisionRate: 0 },
    });
    expect(result.summary.truthfulness).toMatchObject({
      POLICY_ENGINE_CHANGED: true,
      AI_EXECUTION_PERMISSION: false,
      REAL_JEV_BENCHMARK_V2_VERIFIED: false,
    });
  });
});
