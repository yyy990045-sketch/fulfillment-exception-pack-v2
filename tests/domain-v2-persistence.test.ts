import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  V2SqliteStore,
  createBusinessEntity,
  createEvidence,
  createFulfillmentContext,
  createFulfillmentEvent,
  createSourceDocument,
  createSourceSystem,
  V2_MIGRATIONS,
  runV2Migrations,
} from "../src/domain/v2/index.js";

type DatabaseSyncLike = {
  exec(sql: string): void;
  prepare(sql: string): { all(...params: unknown[]): unknown[]; get(...params: unknown[]): unknown; run(...params: unknown[]): unknown };
  close(): void;
};

type DatabaseSyncConstructor = new (path: string) => DatabaseSyncLike;

const sqlite = process.getBuiltinModule("node:sqlite") as { DatabaseSync: DatabaseSyncConstructor } | undefined;
if (!sqlite?.DatabaseSync) throw new Error("sqlite_backend_requires_node_22_5_or_newer");
const DatabaseSync = sqlite.DatabaseSync;
const databases: DatabaseSyncLike[] = [];

function openDatabase() {
  const dir = mkdtempSync(join(tmpdir(), "fep-v2-"));
  const db = new DatabaseSync(join(dir, "v2.sqlite"));
  db.exec("PRAGMA foreign_keys = ON");
  databases.push(db);
  return db;
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("V2 SQLite persistence", () => {
  it("applies migrations once and creates the V2 core tables", () => {
    const db = openDatabase();
    const first = runV2Migrations(db);
    const second = runV2Migrations(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>;

    expect(first).toEqual(["001_v2_core", "002_rule_engine", "003_rule_engine_seal", "004_resolution_bridge", "005_resolution_execution", "006_grounded_ai_explanations", "007_decision_recommendations", "008_root_cause_hypotheses", "009_decision_policy"]);
    expect(second).toEqual([]);
    expect(tables.map((row) => row.name)).toEqual(expect.arrayContaining([
      "business_entities",
      "entity_references",
      "fulfillment_contexts",
      "fulfillment_events",
      "source_documents",
      "source_systems",
      "v2_evidence",
      "v2_schema_migrations",
      "grounded_ai_explanations",
      "decision_recommendations",
      "decision_recommendation_dispositions",
      "root_cause_analyses",
      "root_cause_hypothesis_reviews",
      "policy_definitions",
      "policy_evaluations",
    ]));
  });

  it("rolls back a failed migration and does not mark it as applied", () => {
    const db = openDatabase();
    expect(() => runV2Migrations(db, [{
      version: "999_bad",
      sql: "CREATE TABLE rollback_probe (id TEXT); INVALID SQL;",
    }])).toThrow();

    const probe = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rollback_probe'").get();
    const applied = db.prepare("SELECT version FROM v2_schema_migrations WHERE version = '999_bad'").get();
    expect(probe).toBeUndefined();
    expect(applied).toBeUndefined();
  });

  it("upgrades an existing migration 006 database through decision, root cause, and policy tables", () => {
    const db = openDatabase();
    const preLatest = V2_MIGRATIONS.filter((migration) => !["007_decision_recommendations", "008_root_cause_hypotheses", "009_decision_policy"].includes(migration.version));
    expect(runV2Migrations(db, preLatest)).not.toContain("007_decision_recommendations");
    expect(runV2Migrations(db)).toEqual(["007_decision_recommendations", "008_root_cause_hypotheses", "009_decision_policy"]);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND (name LIKE 'decision_recommendation%' OR name LIKE 'root_cause_%' OR name LIKE 'policy_%') ORDER BY name").all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual([
      "decision_recommendation_dispositions",
      "decision_recommendations",
      "policy_definitions",
      "policy_evaluations",
      "root_cause_analyses",
      "root_cause_hypothesis_reviews",
    ]);
  });

  it("preserves V1 cases and capability receipts while adding V2 tables", () => {
    const db = openDatabase();
    db.exec(`
      CREATE TABLE cases (tenant_id TEXT NOT NULL, case_id TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (tenant_id, case_id));
      CREATE TABLE capability_receipts (tenant_id TEXT NOT NULL, case_id TEXT NOT NULL, action_id TEXT NOT NULL, operation_key TEXT NOT NULL, external_request_id TEXT NOT NULL, receipt TEXT NOT NULL, receipt_source TEXT NOT NULL, status TEXT NOT NULL, payload_hash TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (tenant_id, operation_key, action_id));
    `);
    db.prepare("INSERT INTO cases VALUES (?, ?, ?, ?)").run("tenant-a", "FX-001", "{}", "2026-09-18T00:00:00.000Z");
    db.prepare("INSERT INTO capability_receipts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      "tenant-a", "FX-001", "FX-001-act-1", "op-1", "req-1", "local-ledger:req-1", "local-ledger", "succeeded", "a".repeat(64), "2026-09-18T00:00:00.000Z",
    );

    runV2Migrations(db);

    expect(db.prepare("SELECT case_id FROM cases WHERE tenant_id = ?").get("tenant-a")).toMatchObject({ case_id: "FX-001" });
    expect(db.prepare("SELECT receipt FROM capability_receipts WHERE tenant_id = ?").get("tenant-a")).toMatchObject({ receipt: "local-ledger:req-1" });
  });

  it("persists, queries, and replays an order context without using Case JSON", () => {
    const db = openDatabase();
    const store = new V2SqliteStore(db);
    const context = createFulfillmentContext({
      id: "ctx-1",
      tenantId: "tenant-a",
      businessKey: "SO-2026-0001",
      contextType: "sales_order",
      status: "active",
      openedAt: "2026-09-18T00:00:00.000Z",
      updatedAt: "2026-09-18T00:00:00.000Z",
      metadata: {},
    });
    const sourceSystem = createSourceSystem({
      id: "system-erp",
      tenantId: "tenant-a",
      name: "ERP",
      systemType: "erp",
      authorityLevel: "system_of_record",
      status: "active",
      metadata: {},
    });
    const entity = createBusinessEntity({
      id: "entity-sales-order",
      tenantId: "tenant-a",
      contextId: context.id,
      entityType: "sales_order",
      businessKey: "SO-2026-0001",
      attributes: { currency: "CNY" },
      createdAt: "2026-09-18T00:00:00.000Z",
      updatedAt: "2026-09-18T00:00:00.000Z",
    });
    const document = createSourceDocument({
      id: "doc-1",
      tenantId: "tenant-a",
      sourceSystemId: sourceSystem.id,
      contextId: context.id,
      entityId: entity.id,
      externalDocumentId: "ERP-SO-001",
      documentType: "sales_order",
      contentHash: "a".repeat(64),
      receivedAt: "2026-09-18T00:00:00.000Z",
      effectiveAt: "2026-09-16T08:00:00.000Z",
      version: "v1",
      metadata: {},
    });
    const event = createFulfillmentEvent({
      id: "event-1",
      tenantId: "tenant-a",
      contextId: context.id,
      entityId: entity.id,
      eventType: "ORDER_CREATED",
      occurredAt: "2026-09-16T08:00:00.000Z",
      recordedAt: "2026-09-18T00:00:00.000Z",
      sourceSystemId: sourceSystem.id,
      sourceDocumentId: document.id,
      payload: { orderId: "ERP-SO-001" },
      idempotencyKey: "ERP-SO-001:created:v1",
    });
    const evidence = createEvidence({
      id: "evidence-1",
      tenantId: "tenant-a",
      contextId: context.id,
      sourceSystemId: sourceSystem.id,
      sourceDocumentId: document.id,
      sourceVersion: document.version,
      entityId: entity.id,
      eventId: event.id,
      field: "qty",
      value: 80,
      valueType: "number",
      locator: { fileName: "ERP-SO-001.csv", row: 2, cell: "F2" },
      quote: "数量=80",
      confidence: 1,
      support: "supported",
      observedAt: event.occurredAt,
      createdAt: "2026-09-18T00:00:00.000Z",
      metadata: {},
    });

    store.saveContext(context);
    store.saveSourceSystem(sourceSystem);
    store.saveBusinessEntity(entity);
    expect(store.saveSourceDocument(document)).toEqual(document);
    expect(store.saveSourceDocument({ ...document, id: "doc-duplicate" })).toEqual(document);
    expect(store.appendEvent(event)).toEqual(event);
    expect(store.appendEvent({ ...event, id: "event-duplicate" })).toEqual(event);
    store.saveEvidence(evidence);

    const replay = store.replayContext("tenant-a", context.id);
    expect(replay.context).toEqual(context);
    expect(replay.entities).toEqual([entity]);
    expect(replay.documents).toEqual([document]);
    expect(replay.events).toEqual([event]);
    expect(replay.evidence).toEqual([evidence]);
    expect(store.listEvents("tenant-a", context.id)).toHaveLength(1);
    expect(store.listEvidence("tenant-a", context.id)).toHaveLength(1);
  });
});
