import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildV2WorkbenchView } from "../src/application/v2-workbench.js";
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

function openPreparedStore() {
  const dir = mkdtempSync(join(tmpdir(), "fep-v2-workbench-"));
  const db = new sqlite!.DatabaseSync(join(dir, "workbench.sqlite"));
  databases.push(db);
  const store = new V2SqliteStore(db);
  provisionV2ManufacturingDemoData(store);
  evaluateContextRules(store, "demo-manufacturing", "ctx-so-mfg-001");
  return store;
}

function openProvisionedStore() {
  const dir = mkdtempSync(join(tmpdir(), "fep-v2-workbench-"));
  const db = new sqlite!.DatabaseSync(join(dir, "workbench.sqlite"));
  databases.push(db);
  const store = new V2SqliteStore(db);
  provisionV2ManufacturingDemoData(store);
  return store;
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("V2 manufacturing workbench DTO", () => {
  it("builds the fixed eight-stage manufacturing thread from domain facts", () => {
    const view = buildV2WorkbenchView(openPreparedStore(), "demo-manufacturing", "ctx-so-mfg-001")!;
    expect(view.context).toMatchObject({ businessKey: "SO-MFG-001", contextType: "sales_order" });
    expect(view.thread.map((stage) => stage.key)).toEqual([
      "quote",
      "sales_order",
      "production_order",
      "quality_event",
      "shipment",
      "receivable",
      "payment",
      "complaint",
    ]);
    const values = Object.fromEntries(view.thread.flatMap((stage) => stage.facts.map((fact) => [`${stage.key}.${fact.key}`, fact.value])));
    expect(values).toMatchObject({
      "quote.qty": 100,
      "sales_order.qty": 100,
      "production_order.plannedQty": 100,
      "production_order.completedQty": 100,
      "quality_event.inspectedQty": 100,
      "quality_event.passedQty": 96,
      "quality_event.failedQty": 4,
      "shipment.qty": 96,
      "receivable.amount": 100000,
      "payment.amount": 80000,
      "complaint.claimedReceivedQty": 80,
    });
    expect(view.thread.every((stage) => stage.entityId && stage.businessKey && stage.sourceSystem)).toBe(true);
  });

  it("overlays seven deterministic rules and preserves matched and not-matched evidence", () => {
    const view = buildV2WorkbenchView(openPreparedStore(), "demo-manufacturing", "ctx-so-mfg-001")!;
    expect(view.stats).toMatchObject({
      sourceSystems: 7,
      entities: 8,
      documents: 8,
      events: 11,
      evidence: 11,
      ruleEvaluations: 7,
      matchedRules: 4,
      notMatchedRules: 3,
      exceptions: 4,
      resolutionCases: 0,
    });
    expect(view.rules).toHaveLength(7);
    expect(view.rules.filter((rule) => rule.matched).map((rule) => rule.code)).toEqual(expect.arrayContaining([
      "FULFILLMENT.SHIPMENT_QUANTITY_SHORTFALL",
      "FULFILLMENT.PAYMENT_BALANCE_OUTSTANDING",
      "FULFILLMENT.CUSTOMER_RECEIPT_CLAIM_MISMATCH",
      "MANUFACTURING.QUALITY_NONCONFORMING_QUANTITY_DETECTED",
    ]));
    expect(view.rules.filter((rule) => rule.status === "not_matched").map((rule) => rule.code)).toEqual(expect.arrayContaining([
      "FULFILLMENT.QUOTE_ORDER_QUANTITY_MISMATCH",
      "MANUFACTURING.ORDER_PRODUCTION_COMPLETION_SHORTFALL",
      "MANUFACTURING.QUALITY_SHIPMENT_QUANTITY_MISMATCH",
    ]));
    expect(view.rules.filter((rule) => rule.status === "not_matched").map((rule) => rule.label).sort()).toEqual([
      "报价与订单数量一致",
      "订单与生产完成数量一致",
      "质检合格数量与发货数量一致",
    ].sort());
    expect(view.rules.filter((rule) => rule.status === "not_matched").every((rule) => rule.statusLabel === "未命中")).toBe(true);
    expect(view.defaultExceptionId).toBe(view.exceptions.find((item) => item.code === "CUSTOMER_RECEIPT_CLAIM_MISMATCH")?.id);
  });

  it("does not evaluate rules while building the view", () => {
    const store = openProvisionedStore();
    const view = buildV2WorkbenchView(store, "demo-manufacturing", "ctx-so-mfg-001")!;
    expect(view.stats.ruleEvaluations).toBe(0);
    expect(view.stats.exceptions).toBe(0);
    expect(view.rules).toEqual([]);
    expect(view.exceptions).toEqual([]);
    expect(store.listRuleEvaluations("demo-manufacturing", "ctx-so-mfg-001")).toHaveLength(0);
    expect(store.listExceptions("demo-manufacturing", "ctx-so-mfg-001")).toHaveLength(0);
  });

  it("does not put causal or hardcoded business values in the presentation source", () => {
    const source = readFileSync(new URL("../src/workbench/manufacturing/app.js", import.meta.url), "utf8");
    expect(source).not.toContain("质检导致少发");
    expect(source).not.toContain("4件不合格导致4件少发");
    expect(source).not.toContain("仓库少发");
    expect(source).not.toContain("客户实际收到80件");
    expect(source).not.toContain("100000");
    expect(source).not.toContain("80000");
    expect(source).not.toContain("generateAction");
    expect(source).not.toContain("aiRecommendation");
    expect(source).not.toContain("rootCause");
    expect(source).not.toContain("autoResolve");
  });
});
