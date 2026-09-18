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

    expect(observation).toMatchObject({ status: "missing", value: null, evidenceIds: [] });
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

    expect(results.map((result) => result.evaluation.status)).toEqual(["matched", "matched", "matched", "not_matched"]);
    expect(results.flatMap((result) => result.exception ? [result.exception.code] : [])).toEqual([
      "SHIPMENT_QUANTITY_SHORTFALL",
      "PAYMENT_BALANCE_OUTSTANDING",
      "CUSTOMER_RECEIPT_CLAIM_MISMATCH",
    ]);
    expect(results.slice(0, 3).map((result) => result.evaluation.metrics.difference)).toEqual([4, 20000, 16]);
    expect(results[0]?.exception).toMatchObject({
      severity: "medium",
      title: "发货数量低于订单数量",
      summary: "订单数量 100，累计发货数量 96，差异 4。",
      metrics: { expected: 100, actual: 96, difference: 4, shortfall: 4, shortfallRatio: 0.04 },
    });
    expect(results[1]?.exception).toMatchObject({
      severity: "medium",
      summary: "应收金额 100000，已记录回款 80000，尚有 20000 未覆盖。",
      metrics: { outstandingAmount: 20000, paymentRatio: 0.8 },
    });
    expect(results[2]?.exception).toMatchObject({
      severity: "high",
      summary: "系统发货记录为 96 件，客户主张收到 80 件，存在 16 件差异，需进一步核验。",
    });
    expect(results[3]?.evaluation.status).toBe("not_matched");
    for (const result of results.slice(0, 3)) {
      expect(result.evidenceBundle?.evidenceIds.length).toBeGreaterThanOrEqual(2);
      expect(result.evidenceBundle?.sourceDocuments.length).toBeGreaterThanOrEqual(2);
      expect(result.evidenceBundle?.sourceSystems.length).toBeGreaterThanOrEqual(1);
    }
    expect(results[0]?.evidenceBundle?.evidence.map((item) => [item.id, item.role])).toEqual([
      ["evidence-order-qty", "expected"],
      ["evidence-shipment-qty", "actual"],
    ]);
    expect(results[1]?.evidenceBundle?.evidence.map((item) => [item.id, item.role])).toEqual([
      ["evidence-receivable-amount", "expected"],
      ["evidence-payment-amount", "actual"],
    ]);
    expect(results[2]?.evidenceBundle?.evidence.map((item) => [item.id, item.role])).toEqual([
      ["evidence-shipment-qty", "actual"],
      ["evidence-complaint-claimed-received", "claim"],
    ]);
    expect(results.some((result) => result.exception?.code.includes("QUOTE") || result.exception?.code.includes("ORDER"))).toBe(false);
  });
});
