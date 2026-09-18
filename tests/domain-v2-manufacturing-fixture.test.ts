import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  V2SqliteStore,
  evaluateContextRules,
  provisionV2DemoData,
  provisionV2ManufacturingDemoData,
  seedSoMfg001,
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
  const dir = mkdtempSync(join(tmpdir(), "fep-v2-mfg-"));
  const db = new sqlite!.DatabaseSync(join(dir, "mfg.sqlite"));
  databases.push(db);
  return new V2SqliteStore(db);
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("SO-MFG-001 manufacturing digital thread", () => {
  it("seeds production and quality facts idempotently", () => {
    const store = openStore();
    provisionV2ManufacturingDemoData(store);
    seedSoMfg001(store);

    const replay = store.replayContext("demo-manufacturing", "ctx-so-mfg-001");
    expect(replay.context?.businessKey).toBe("SO-MFG-001");
    expect(replay.entities).toHaveLength(8);
    expect(replay.entityReferences).toHaveLength(8);
    expect(replay.sourceSystems.map((item) => item.id)).toEqual([
      "CRM-DEMO",
      "ERP-DEMO",
      "FINANCE-DEMO",
      "MES-DEMO",
      "QMS-DEMO",
      "SERVICE-DEMO",
      "WMS-DEMO",
    ]);
    expect(replay.documents).toHaveLength(8);
    expect(replay.events.map((item) => item.eventType)).toEqual([
      "QUOTE_CREATED",
      "ORDER_CREATED",
      "PRODUCTION_STARTED",
      "PRODUCTION_COMPLETED",
      "QUALITY_INSPECTED",
      "QUALITY_PASSED",
      "QUALITY_FAILED",
      "SHIPMENT_DISPATCHED",
      "RECEIVABLE_CREATED",
      "PAYMENT_RECEIVED",
      "COMPLAINT_OPENED",
    ]);
    expect(replay.evidence).toHaveLength(11);

    const productionEvidence = replay.evidence.filter((item) => item.entityId === "entity-production-order-mfg-001");
    expect(productionEvidence.map((item) => [item.field, item.eventId])).toEqual([
      ["plannedQty", "event-production-mfg-started"],
      ["completedQty", "event-production-mfg-completed"],
    ]);
    const qualityEvidence = replay.evidence.filter((item) => item.entityId === "entity-quality-event-mfg-001");
    expect(qualityEvidence.map((item) => [item.field, item.eventId])).toEqual([
      ["inspectedQty", "event-quality-mfg-inspected"],
      ["passedQty", "event-quality-mfg-passed"],
      ["failedQty", "event-quality-mfg-failed"],
    ]);
  });

  it("keeps SO-DEMO-001 regression facts unchanged beside SO-MFG-001", () => {
    const store = openStore();
    provisionV2DemoData(store);
    const before = store.replayContext("demo-industrial", "ctx-so-demo-001");
    provisionV2ManufacturingDemoData(store);
    const after = store.replayContext("demo-industrial", "ctx-so-demo-001");

    expect(after.entities).toEqual(before.entities);
    expect(after.documents).toEqual(before.documents);
    expect(after.events).toEqual(before.events);
    expect(after.evidence).toEqual(before.evidence);
    expect(store.listRuleEvaluations("demo-manufacturing", "ctx-so-mfg-001")).toHaveLength(0);
    expect(store.listExceptions("demo-manufacturing", "ctx-so-mfg-001")).toHaveLength(0);

    const evaluated = evaluateContextRules(store, "demo-manufacturing", "ctx-so-mfg-001")!;
    expect(evaluated.evaluations).toHaveLength(7);
    expect(evaluated.evaluations.filter((item) => item.status === "matched")).toHaveLength(4);
    expect(evaluated.evaluations.filter((item) => item.status === "not_matched")).toHaveLength(3);
    expect(evaluated.exceptions).toHaveLength(4);
    expect(evaluated.exceptions.map((item) => item.code)).toEqual(expect.arrayContaining([
      "SHIPMENT_QUANTITY_SHORTFALL",
      "PAYMENT_BALANCE_OUTSTANDING",
      "CUSTOMER_RECEIPT_CLAIM_MISMATCH",
      "QUALITY_NONCONFORMING_QUANTITY_DETECTED",
    ]));

    const quality = evaluated.exceptions.find((item) => item.code === "QUALITY_NONCONFORMING_QUANTITY_DETECTED")!;
    expect(quality.metrics).toMatchObject({
      difference: 4,
      nonconformingQty: 4,
      passRatio: 0.96,
    });
    expect(quality.summary).toBe("质检数量 100 件，合格 96 件，存在 4 件未通过数量。");
    const qualityBundle = store.getExceptionEvidenceBundle("demo-manufacturing", quality.id)!;
    expect(qualityBundle.evidence.map((item) => [item.evidenceId, item.role, item.value])).toEqual([
      ["evidence-quality-mfg-inspected", "expected", 100],
      ["evidence-quality-mfg-passed", "actual", 96],
    ]);
  });
});
