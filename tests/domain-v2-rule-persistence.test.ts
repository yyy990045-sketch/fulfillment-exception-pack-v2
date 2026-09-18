import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEMO_RULE_DEFINITIONS,
  DEMO_RULE_VERSIONS,
  V2SqliteStore,
  evaluateActiveRules,
  provisionV2DemoData,
  ruleVersionContentHash,
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
  const dir = mkdtempSync(join(tmpdir(), "fep-v2-rule-store-"));
  const db = new sqlite!.DatabaseSync(join(dir, "rule-store.sqlite"));
  databases.push(db);
  return new V2SqliteStore(db);
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("V2 rule persistence", () => {
  it("provisions immutable rule versions idempotently", () => {
    const store = openStore();
    provisionV2DemoData(store);
    for (const definition of DEMO_RULE_DEFINITIONS) store.saveRuleDefinition(definition);
    for (const version of DEMO_RULE_VERSIONS) store.saveRuleVersion(version);
    for (const version of DEMO_RULE_VERSIONS) expect(store.saveRuleVersion(version)).toEqual(version);

    const changedConfig = {
      ...DEMO_RULE_VERSIONS[0]!.config,
      condition: { operator: "neq" as const },
    };
    expect(() => store.saveRuleVersion({
      ...DEMO_RULE_VERSIONS[0]!,
      contentHash: ruleVersionContentHash(changedConfig),
      config: changedConfig,
    })).toThrow(/DOMAIN_RULE_VERSION_IMMUTABILITY_CONFLICT/);
  });

  it("persists evaluations, exceptions, and exception evidence bundles", () => {
    const store = openStore();
    provisionV2DemoData(store);
    for (const definition of DEMO_RULE_DEFINITIONS) store.saveRuleDefinition(definition);
    for (const version of DEMO_RULE_VERSIONS) store.saveRuleVersion(version);

    const replay = store.replayContext("demo-industrial", "ctx-so-demo-001");
    const results = evaluateActiveRules(replay, DEMO_RULE_DEFINITIONS, DEMO_RULE_VERSIONS);
    for (const result of results) store.recordRuleExecution(result);
    for (const result of results) store.recordRuleExecution(result);

    const evaluations = store.listRuleEvaluations("demo-industrial", "ctx-so-demo-001");
    const exceptions = store.listExceptions("demo-industrial", "ctx-so-demo-001");
    expect(evaluations).toHaveLength(3);
    expect(exceptions).toHaveLength(3);
    expect(exceptions.map((item) => item.code)).toEqual([
      "SHIPMENT_QUANTITY_SHORTFALL",
      "PAYMENT_BALANCE_OUTSTANDING",
      "CUSTOMER_RECEIPT_CLAIM_MISMATCH",
    ]);

    const bundle = store.getExceptionEvidenceBundle("demo-industrial", exceptions[0]!.id);
    expect(bundle?.evidence.map((item) => item.id)).toEqual(expect.arrayContaining(["evidence-order-qty", "evidence-shipment-qty"]));
    expect(bundle?.sourceDocuments.length).toBeGreaterThanOrEqual(2);
    expect(bundle?.sourceSystems.length).toBeGreaterThanOrEqual(2);
  });
});
