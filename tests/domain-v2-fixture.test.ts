import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { V2SqliteStore, createSourceSystem, seedSoDemo001 } from "../src/domain/v2/index.js";

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
  const dir = mkdtempSync(join(tmpdir(), "fep-v2-fixture-"));
  const db = new sqlite!.DatabaseSync(join(dir, "fixture.sqlite"));
  databases.push(db);
  return new V2SqliteStore(db);
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("SO-DEMO-001 V2 fixture", () => {
  it("persists and replays a cross-system order fulfillment chain", () => {
    const store = openStore();
    seedSoDemo001(store);
    store.saveSourceSystem(createSourceSystem({
      id: "UNUSED-DEMO",
      tenantId: "demo-industrial",
      name: "Unused Demo",
      systemType: "demo",
      authorityLevel: "reference",
      status: "active",
      metadata: {},
    }));
    seedSoDemo001(store);

    const replay = store.replayContext("demo-industrial", "ctx-so-demo-001");
    expect(replay.context).toMatchObject({
      id: "ctx-so-demo-001",
      tenantId: "demo-industrial",
      businessKey: "SO-DEMO-001",
      contextType: "sales_order",
      status: "active",
    });
    expect(replay.entities.map((entity) => entity.entityType)).toEqual([
      "complaint",
      "quote",
      "receivable",
      "sales_order",
      "shipment",
    ]);
    expect(replay.sourceSystems.map((system) => system.id)).toEqual([
      "CRM-DEMO",
      "ERP-DEMO",
      "FINANCE-DEMO",
      "SERVICE-DEMO",
      "WMS-DEMO",
    ]);
    expect(replay.sourceSystems.some((system) => system.id === "UNUSED-DEMO")).toBe(false);
    expect(replay.entityReferences).toHaveLength(5);
    expect(replay.documents).toHaveLength(5);
    expect(replay.events.map((event) => event.eventType)).toEqual([
      "QUOTE_CREATED",
      "ORDER_CREATED",
      "SHIPMENT_CREATED",
      "RECEIVABLE_CREATED",
      "COMPLAINT_OPENED",
    ]);
    expect(replay.evidence).toHaveLength(6);
    expect(replay.evidence.map((item) => [item.field, item.value])).toEqual(expect.arrayContaining([
      ["qty", 100],
      ["qty", 96],
      ["amount", 100000],
      ["receivedAmount", 80000],
      ["claimedReceivedQty", 80],
    ]));
  });
});
