import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEMO_RULE_DEFINITIONS,
  DEMO_RULE_VERSIONS,
  V2SqliteStore,
  evaluateActiveRules,
  resolveFactObservation,
  seedSoDemo001,
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

function replayFixture() {
  const dir = mkdtempSync(join(tmpdir(), "fep-v2-rules-"));
  const db = new sqlite!.DatabaseSync(join(dir, "rules.sqlite"));
  databases.push(db);
  const store = new V2SqliteStore(db);
  seedSoDemo001(store);
  return store.replayContext("demo-industrial", "ctx-so-demo-001");
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("V2 constrained numeric rule engine", () => {
  it("resolves supported Evidence observations with lineage", () => {
    const replay = replayFixture();
    const shipmentQty = resolveFactObservation(replay, {
      key: "shipmentQty",
      entityType: "shipment",
      field: "qty",
      valueType: "number",
      aggregation: "sum_latest_per_entity",
    });

    expect(shipmentQty).toMatchObject({
      selectorKey: "shipmentQty",
      status: "resolved",
      value: 96,
      entityIds: ["entity-shipment-demo-001"],
      evidenceIds: ["evidence-shipment-qty"],
      sourceSystemIds: ["WMS-DEMO"],
    });
  });

  it("does not fall back to Entity.attributes or unsupported Evidence", () => {
    const replay = replayFixture();
    const withoutEvidence = {
      ...replay,
      evidence: replay.evidence.map((item) => item.field === "qty" && item.entityId === "entity-shipment-demo-001"
        ? { ...item, support: "unsupported" as const }
        : item),
    };
    const observation = resolveFactObservation(withoutEvidence, {
      key: "shipmentQty",
      entityType: "shipment",
      field: "qty",
      valueType: "number",
      aggregation: "sum_latest_per_entity",
    });

    expect(observation).toMatchObject({ status: "invalid", value: null, evidenceIds: [] });
  });

  it("returns AMBIGUOUS_EVIDENCE when single_latest spans multiple entities", () => {
    const replay = replayFixture();
    const ambiguous = {
      ...replay,
      entities: [...replay.entities, {
        ...replay.entities.find((entity) => entity.entityType === "sales_order")!,
        id: "entity-sales-order-demo-002",
        businessKey: "SO-DEMO-002",
      }],
      evidence: [...replay.evidence, {
        ...replay.evidence.find((item) => item.id === "evidence-order-qty")!,
        id: "evidence-order-qty-2",
        entityId: "entity-sales-order-demo-002",
        value: 101,
      }],
    };
    const observation = resolveFactObservation(ambiguous, {
      key: "orderQty",
      entityType: "sales_order",
      field: "qty",
      valueType: "number",
      aggregation: "single_latest",
    });

    expect(observation.status).toBe("ambiguous");
    expect(observation.value).toBeNull();
  });

  it("evaluates demo rules from RuleVersion config and emits exception bundles", () => {
    const replay = replayFixture();
    const results = evaluateActiveRules(replay, DEMO_RULE_DEFINITIONS, DEMO_RULE_VERSIONS);

    expect(results.map((result) => result.evaluation.status)).toEqual(["matched", "matched", "matched"]);
    expect(results.map((result) => result.exception?.code)).toEqual([
      "SHIPMENT_QUANTITY_SHORTFALL",
      "PAYMENT_BALANCE_OUTSTANDING",
      "CUSTOMER_RECEIPT_CLAIM_MISMATCH",
    ]);
    expect(results.map((result) => result.evaluation.metrics.difference)).toEqual([4, 20000, 16]);
    for (const result of results) {
      expect(result.evidenceBundle?.evidenceIds.length).toBeGreaterThanOrEqual(2);
      expect(result.evidenceBundle?.sourceDocuments.length).toBeGreaterThanOrEqual(2);
      expect(result.evidenceBundle?.sourceSystems.length).toBeGreaterThanOrEqual(1);
    }
    expect(results.some((result) => result.exception?.code.includes("QUOTE") || result.exception?.code.includes("ORDER"))).toBe(false);
  });
});
