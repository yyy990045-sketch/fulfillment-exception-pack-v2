import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  V2SqliteStore,
  evaluateFulfillmentExceptions,
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

function openStore() {
  const dir = mkdtempSync(join(tmpdir(), "fep-v2-exceptions-"));
  const db = new sqlite!.DatabaseSync(join(dir, "exceptions.sqlite"));
  databases.push(db);
  return new V2SqliteStore(db);
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("V2 deterministic exception candidates", () => {
  it("maps SO-DEMO-001 facts to three exception candidates without judging quote/order equality", () => {
    const store = openStore();
    seedSoDemo001(store);
    const replay = store.replayContext("demo-industrial", "ctx-so-demo-001");
    const exceptions = evaluateFulfillmentExceptions(replay);

    expect(exceptions.map((item) => item.code)).toEqual([
      "SHIPMENT_QUANTITY_SHORTFALL",
      "PAYMENT_BALANCE_OUTSTANDING",
      "CUSTOMER_RECEIPT_CLAIM_MISMATCH",
    ]);
    expect(exceptions.map((item) => item.difference)).toEqual([4, 20000, 16]);
    expect(exceptions.some((item) => item.code.includes("QUOTE") || item.code.includes("ORDER"))).toBe(false);
    for (const exception of exceptions) {
      expect(exception.tenantId).toBe("demo-industrial");
      expect(exception.contextId).toBe("ctx-so-demo-001");
      expect(exception.entityIds.length).toBe(2);
      expect(exception.evidenceIds.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("returns no exception when the facts are aligned", () => {
    const store = openStore();
    seedSoDemo001(store);
    const replay = store.replayContext("demo-industrial", "ctx-so-demo-001");
    const aligned = {
      ...replay,
      evidence: replay.evidence.map((item) => {
        if (item.entityId === "entity-shipment-demo-001" && item.field === "qty") return { ...item, value: 100 };
        if (item.entityId === "entity-payment-demo-001" && item.field === "amount") return { ...item, value: 100000 };
        if (item.entityId === "entity-complaint-demo-001" && item.field === "claimedReceivedQty") return { ...item, value: 100 };
        return item;
      }),
    };

    expect(evaluateFulfillmentExceptions(aligned)).toEqual([]);
  });
});
