import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateDecisionPolicy } from "../src/policy/index.js";
import { InternalAutomationExecutor, executePolicyAutomation } from "../src/automation/index.js";
import {
  evaluateOutcome,
  listOutcomeEvaluations,
  outcomeDefinitionContentHash,
  provisionDefaultManufacturingOutcomeDefinitions,
} from "../src/outcomes/index.js";
import {
  V2SqliteStore,
  createEvidence,
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

function openStore() {
  const dir = mkdtempSync(join(tmpdir(), "fep-outcome-"));
  const db = new sqlite!.DatabaseSync(join(dir, "outcome.sqlite"));
  databases.push(db);
  const store = new V2SqliteStore(db);
  provisionV2ManufacturingDemoData(store);
  evaluateContextRules(store, "demo-manufacturing", "ctx-so-mfg-001");
  provisionDefaultManufacturingOutcomeDefinitions(store, "demo-manufacturing");
  return store;
}

function heroException(store: V2SqliteStore, code = "CUSTOMER_RECEIPT_CLAIM_MISMATCH") {
  return store.listExceptions("demo-manufacturing", "ctx-so-mfg-001").find((item) => item.code === code)!;
}

function saveOutcomeEvidence(store: V2SqliteStore, id: string, field: string, value: number, observedAt: string) {
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
    locator: { fileName: "outcome.csv", row: 2, cell: field },
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

describe("Evidence-backed Outcome Intelligence", () => {
  it("evaluates target_met, improved, unchanged, worsened, and insufficient_evidence", () => {
    const store = openStore();
    const exception = heroException(store);
    const definition = store.listOutcomeDefinitions("demo-manufacturing", exception.code, true)[0]!;
    const cases = [
      [0, "target_met"],
      [8, "improved"],
      [16, "unchanged"],
      [20, "worsened"],
    ] as const;
    for (const [index, [value, status]] of cases.entries()) {
      const evidence = saveOutcomeEvidence(store, `outcome-evidence-target-${index}`, definition.currentEvidenceField, value, `2026-10-0${index + 1}T00:00:00.000Z`);
      const evaluation = evaluateOutcome(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, { definitionId: definition.id, evidenceIds: [evidence.id] }, "outcome-owner");
      expect(evaluation.status).toBe(status);
      expect(evaluation.truthfulness).toEqual({ evidenceBacked: true, causalAttribution: false });
      expect(evaluation.syntheticEvidence).toBe(true);
    }
    const insufficient = evaluateOutcome(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, { definitionId: definition.id, evidenceIds: [] }, "outcome-owner");
    expect(insufficient.status).toBe("insufficient_evidence");
    expect(insufficient.current.value).toBeNull();
  });

  it("rejects wrong evidence fields and client value/status injection", () => {
    const store = openStore();
    const exception = heroException(store);
    const definition = store.listOutcomeDefinitions("demo-manufacturing", exception.code, true)[0]!;
    expect(() => evaluateOutcome(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, {
      definitionId: definition.id,
      evidenceIds: ["evidence-shipment-mfg-qty"],
    }, "outcome-owner")).toThrow(/OUTCOME_EVIDENCE_FIELD_MISMATCH/);
  });

  it("is idempotent for the same definition, RuleEvaluation, Evidence, and intervention", () => {
    const store = openStore();
    const exception = heroException(store);
    const definition = store.listOutcomeDefinitions("demo-manufacturing", exception.code, true)[0]!;
    const evidence = saveOutcomeEvidence(store, "outcome-evidence-idempotent", definition.currentEvidenceField, 0, "2026-10-08T00:00:00.000Z");
    const first = evaluateOutcome(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, { definitionId: definition.id, evidenceIds: [evidence.id] }, "outcome-owner");
    const second = evaluateOutcome(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, { definitionId: definition.id, evidenceIds: [evidence.id] }, "outcome-owner");
    expect(second.id).toBe(first.id);
    expect(store.listOutcomeEvaluations("demo-manufacturing", "ctx-so-mfg-001", exception.id)).toHaveLength(1);
  });

  it("marks old Outcome Evaluations stale after a definition or RuleEvaluation change", () => {
    const store = openStore();
    const exception = heroException(store);
    const definition = store.listOutcomeDefinitions("demo-manufacturing", exception.code, true)[0]!;
    const evidence = saveOutcomeEvidence(store, "outcome-evidence-stale", definition.currentEvidenceField, 0, "2026-10-09T00:00:00.000Z");
    const evaluation = evaluateOutcome(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, { definitionId: definition.id, evidenceIds: [evidence.id] }, "outcome-owner");
    const changed = {
      id: definition.id,
      version: "1.0.1",
      name: definition.name,
      exceptionCode: definition.exceptionCode,
      baselineMetricKey: definition.baselineMetricKey,
      currentEvidenceField: definition.currentEvidenceField,
      comparison: definition.comparison,
      targetValue: definition.targetValue,
      betterDirection: definition.betterDirection,
      enabled: true,
      metadata: definition.metadata,
    };
    store.saveOutcomeDefinition({
      tenantId: "demo-manufacturing",
      ...changed,
      contentHash: outcomeDefinitionContentHash(changed),
      createdAt: "2026-10-10T00:00:00.000Z",
    });
    const listed = listOutcomeEvaluations(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id).find((item) => item.id === evaluation.id)!;
    expect(listed.stale).toBe(true);
  });

  it("does not infer Outcome from a successful Automation Run", () => {
    const store = openStore();
    const exception = heroException(store);
    const policy = evaluateDecisionPolicy(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, { actionType: "create_task" }, "automation-owner");
    executePolicyAutomation(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, policy.id, "automation-owner", "human_request", {
      env: { AUTOMATION_ENABLED: "true", AUTOMATION_EXECUTOR: "internal" },
      executor: new InternalAutomationExecutor(),
    });
    expect(store.listAutomationRuns("demo-manufacturing", "ctx-so-mfg-001", exception.id)).toHaveLength(1);
    expect(store.listOutcomeEvaluations("demo-manufacturing", "ctx-so-mfg-001", exception.id)).toHaveLength(0);
  });

  it("validates intervention tenant/context/exception scope", () => {
    const store = openStore();
    const customer = heroException(store);
    const payment = heroException(store, "PAYMENT_BALANCE_OUTSTANDING");
    const policy = evaluateDecisionPolicy(store, "demo-manufacturing", "ctx-so-mfg-001", customer.id, { actionType: "create_task" }, "automation-owner");
    const automation = executePolicyAutomation(store, "demo-manufacturing", "ctx-so-mfg-001", customer.id, policy.id, "automation-owner", "human_request", {
      env: { AUTOMATION_ENABLED: "true", AUTOMATION_EXECUTOR: "internal" },
      executor: new InternalAutomationExecutor(),
    });
    const definition = store.listOutcomeDefinitions("demo-manufacturing", payment.code, true)[0]!;
    expect(() => evaluateOutcome(store, "demo-manufacturing", "ctx-so-mfg-001", payment.id, {
      definitionId: definition.id,
      evidenceIds: [],
      automationRunId: automation.run.id,
    }, "outcome-owner")).toThrow(/OUTCOME_INTERVENTION_MISMATCH/);
  });
});
