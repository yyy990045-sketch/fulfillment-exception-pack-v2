import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildOutcomeAnalytics, evaluateOutcome, provisionDefaultManufacturingOutcomeDefinitions } from "../src/outcomes/index.js";
import { evaluateDecisionPolicy } from "../src/policy/index.js";
import { InternalAutomationExecutor, executePolicyAutomation } from "../src/automation/index.js";
import {
  V2SqliteStore,
  acceptExceptionForResolution,
  approveResolutionCase,
  closeResolutionCase,
  createEvidence,
  evaluateContextRules,
  executeResolutionCase,
  proposeResolutionCase,
  provisionV2ManufacturingDemoData,
  reviewResolution,
  submitResolutionCase,
} from "../src/domain/v2/index.js";
import { resolutionActor } from "./helpers/resolution-actors.js";

type DatabaseSyncLike = {
  exec(sql: string): void;
  prepare(sql: string): { all(...params: unknown[]): unknown[]; get(...params: unknown[]): unknown; run(...params: unknown[]): unknown };
  close(): void;
};
type DatabaseSyncConstructor = new (path: string) => DatabaseSyncLike;
const sqlite = process.getBuiltinModule("node:sqlite") as { DatabaseSync: DatabaseSyncConstructor } | undefined;
if (!sqlite?.DatabaseSync) throw new Error("sqlite_backend_requires_node_22_5_or_newer");
const databases: DatabaseSyncLike[] = [];

function openStore() {
  const dir = mkdtempSync(join(tmpdir(), "fep-outcome-analytics-"));
  const db = new sqlite!.DatabaseSync(join(dir, "analytics.sqlite"));
  databases.push(db);
  const store = new V2SqliteStore(db);
  provisionV2ManufacturingDemoData(store);
  evaluateContextRules(store, "demo-manufacturing", "ctx-so-mfg-001");
  provisionDefaultManufacturingOutcomeDefinitions(store, "demo-manufacturing");
  return store;
}

function saveEvidence(store: V2SqliteStore, id: string, field: string, value: number, observedAt: string) {
  return store.saveEvidence(createEvidence({
    id,
    tenantId: "demo-manufacturing",
    contextId: "ctx-so-mfg-001",
    sourceSystemId: "SERVICE-DEMO",
    sourceDocumentId: "doc-complaint-mfg-001-v1",
    sourceVersion: "v1",
    entityId: "entity-complaint-mfg-001",
    field,
    value,
    valueType: "number",
    locator: { fileName: "outcome.csv", row: 2 },
    quote: `${field}=${value}`,
    confidence: 1,
    support: "supported",
    observedAt,
    createdAt: observedAt,
    metadata: { synthetic: true },
  }));
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("Outcome Analytics", () => {
  it("reports status counts, coverage, observed target rate, associations, and closed-without-outcome", () => {
    const store = openStore();
    const customer = store.listExceptions("demo-manufacturing", "ctx-so-mfg-001").find((item) => item.code === "CUSTOMER_RECEIPT_CLAIM_MISMATCH")!;
    const payment = store.listExceptions("demo-manufacturing", "ctx-so-mfg-001").find((item) => item.code === "PAYMENT_BALANCE_OUTSTANDING")!;
    const customerDefinition = store.listOutcomeDefinitions("demo-manufacturing", customer.code, true)[0]!;
    const paymentDefinition = store.listOutcomeDefinitions("demo-manufacturing", payment.code, true)[0]!;
    const customerEvidence = saveEvidence(store, "outcome-analytics-customer", customerDefinition.currentEvidenceField, 0, "2026-10-12T00:00:00.000Z");
    const paymentEvidence = store.saveEvidence(createEvidence({
      ...customerEvidence,
      id: "outcome-analytics-payment",
      sourceSystemId: "FINANCE-DEMO",
      sourceDocumentId: "doc-payment-mfg-001-v1",
      entityId: "entity-payment-mfg-001",
      field: paymentDefinition.currentEvidenceField,
      value: 0,
      observedAt: "2026-10-12T00:00:00.000Z",
      createdAt: "2026-10-12T00:00:00.000Z",
    }));
    evaluateOutcome(store, "demo-manufacturing", "ctx-so-mfg-001", customer.id, { definitionId: customerDefinition.id, evidenceIds: [customerEvidence.id] }, "outcome-owner");
    evaluateOutcome(store, "demo-manufacturing", "ctx-so-mfg-001", payment.id, { definitionId: paymentDefinition.id, evidenceIds: [paymentEvidence.id] }, "outcome-owner");
    const policy = evaluateDecisionPolicy(store, "demo-manufacturing", "ctx-so-mfg-001", customer.id, { actionType: "create_task" }, "automation-owner");
    const automation = executePolicyAutomation(store, "demo-manufacturing", "ctx-so-mfg-001", customer.id, policy.id, "automation-owner", "human_request", {
      env: { AUTOMATION_ENABLED: "true", AUTOMATION_EXECUTOR: "internal" },
      executor: new InternalAutomationExecutor(),
    });
    evaluateOutcome(store, "demo-manufacturing", "ctx-so-mfg-001", customer.id, {
      definitionId: customerDefinition.id,
      evidenceIds: [customerEvidence.id],
      automationRunId: automation.run.id,
    }, "outcome-owner");

    let resolution = acceptExceptionForResolution(store, "demo-manufacturing", "ctx-so-mfg-001", customer.id, {
      ownerRole: "品质负责人",
      rationale: "进入处置",
      actor: resolutionActor("销售总监"),
    });
    resolution = reviewResolution(store, "demo-manufacturing", resolution.id, {
      decision: "confirm",
      rationale: "确认异常",
      actor: resolutionActor("品质负责人"),
    })!;
    resolution = proposeResolutionCase(store, "demo-manufacturing", resolution.id, {
      actor: resolutionActor("品质负责人"),
      actions: [{ type: "supplement_evidence", summary: "补充核验。" }],
    })!;
    resolution = submitResolutionCase(store, "demo-manufacturing", resolution.id, resolutionActor("品质负责人"))!;
    resolution = approveResolutionCase(store, "demo-manufacturing", resolution.id, resolutionActor("销售总监"))!;
    resolution = executeResolutionCase(store, "demo-manufacturing", resolution.id, resolutionActor("销售总监"), "outcome-analytics-close")!;
    closeResolutionCase(store, "demo-manufacturing", resolution.id, resolutionActor("销售总监"));

    const analytics = buildOutcomeAnalytics(store, "demo-manufacturing");
    expect(analytics.summary.measuredOutcomeCount).toBe(3);
    expect(analytics.summary.targetMetCount).toBe(3);
    expect(analytics.summary.outcomeMeasurementCoverage).toBe(2 / 4);
    expect(analytics.summary.observedTargetMetRate).toBe(1);
    expect(analytics.coverage).toEqual({ measured: 2, notMeasured: 2 });
    expect(analytics.resolutionAssociation.closedWithMeasuredOutcome).toBe(0);
    expect(analytics.resolutionAssociation.closedWithoutMeasuredOutcome).toBe(1);
    expect(analytics.actionAssociations).toContainEqual({
      actionType: "create_task",
      measured: 1,
      targetMet: 1,
      improved: 0,
      unchanged: 0,
      worsened: 0,
    });
    expect(analytics.truthfulness).toMatchObject({
      causalAttribution: false,
      actionEffectivenessMeasured: false,
      roiMeasured: false,
      realCustomerOutcomeData: false,
    });
  });
});
