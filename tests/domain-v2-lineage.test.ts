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
  const dir = mkdtempSync(join(tmpdir(), "fep-v2-lineage-"));
  const db = new sqlite!.DatabaseSync(join(dir, "lineage.sqlite"));
  databases.push(db);
  return new V2SqliteStore(db);
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function seedBase(store: V2SqliteStore) {
  const context = createFulfillmentContext({
    id: "ctx-1",
    tenantId: "tenant-a",
    businessKey: "SO-1",
    contextType: "sales_order",
    status: "active",
    openedAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    metadata: {},
  });
  const sourceSystem = createSourceSystem({
    id: "erp-a",
    tenantId: "tenant-a",
    name: "ERP A",
    systemType: "erp",
    authorityLevel: "system_of_record",
    status: "active",
    metadata: {},
  });
  const entity = createBusinessEntity({
    id: "so-1",
    tenantId: "tenant-a",
    contextId: context.id,
    entityType: "sales_order",
    businessKey: "SO-1",
    attributes: { qty: 100 },
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  });
  const document = createSourceDocument({
    id: "doc-1",
    tenantId: "tenant-a",
    sourceSystemId: sourceSystem.id,
    contextId: context.id,
    entityId: entity.id,
    externalDocumentId: "SO-1",
    documentType: "sales_order",
    contentHash: "a".repeat(64),
    receivedAt: "2026-09-02T00:00:00.000Z",
    effectiveAt: "2026-09-01T00:00:00.000Z",
    version: "v1",
    metadata: {},
  });
  const event = createFulfillmentEvent({
    id: "event-1",
    tenantId: "tenant-a",
    contextId: context.id,
    entityId: entity.id,
    eventType: "ORDER_CREATED",
    occurredAt: "2026-09-01T00:00:00.000Z",
    recordedAt: "2026-09-02T00:00:00.000Z",
    sourceSystemId: sourceSystem.id,
    sourceDocumentId: document.id,
    payload: { qty: 100 },
    idempotencyKey: "SO-1:created:v1",
  });
  store.saveContext(context);
  store.saveSourceSystem(sourceSystem);
  store.saveBusinessEntity(entity);
  store.saveSourceDocument(document);
  store.appendEvent(event);
  return { context, sourceSystem, entity, document, event };
}

describe("V2 lineage integrity", () => {
  it("rejects divergent SourceDocument replay for the same identity and version", () => {
    const store = openStore();
    const { document } = seedBase(store);
    expect(store.saveSourceDocument(document)).toEqual(document);
    expect(() => store.saveSourceDocument({
      ...document,
      id: "doc-conflict",
      contentHash: "b".repeat(64),
    })).toThrow(/DOMAIN_SOURCE_DOCUMENT_IDEMPOTENCY_CONFLICT/);
    expect(() => store.saveSourceDocument({
      ...document,
      id: "doc-type-conflict",
      documentType: "quote",
    })).toThrow(/DOMAIN_SOURCE_DOCUMENT_IDEMPOTENCY_CONFLICT/);
  });

  it("rejects divergent FulfillmentEvent replay for the same idempotency key", () => {
    const store = openStore();
    const { event } = seedBase(store);
    expect(store.appendEvent({ ...event, id: "event-repeat", recordedAt: "2026-09-03T00:00:00.000Z" })).toEqual(event);
    for (const divergent of [
      { ...event, id: "event-type", eventType: "ORDER_CHANGED" as const },
      { ...event, id: "event-entity", entityId: "other-entity" },
      { ...event, id: "event-context", contextId: "other-context" },
      { ...event, id: "event-occurred", occurredAt: "2026-09-02T00:00:00.000Z" },
      { ...event, id: "event-payload", payload: { qty: 99 } },
      { ...event, id: "event-document", sourceDocumentId: "other-document" },
    ]) {
      expect(() => store.appendEvent(divergent)).toThrow(/DOMAIN_EVENT_IDEMPOTENCY_CONFLICT/);
    }
  });

  it("rejects Evidence whose document version or event lineage is inconsistent", () => {
    const store = openStore();
    const { context, sourceSystem, entity, document, event } = seedBase(store);
    const evidence = createEvidence({
      id: "evidence-1",
      tenantId: "tenant-a",
      contextId: context.id,
      sourceSystemId: sourceSystem.id,
      sourceDocumentId: document.id,
      sourceVersion: "v2",
      entityId: entity.id,
      eventId: event.id,
      field: "qty",
      value: 100,
      valueType: "number",
      locator: { fileName: "SO-1.csv", row: 2 },
      quote: "qty=100",
      confidence: 1,
      support: "supported",
      observedAt: event.occurredAt,
      createdAt: "2026-09-02T00:00:00.000Z",
      metadata: {},
    });

    expect(() => store.saveEvidence(evidence)).toThrow(/DOMAIN_EVIDENCE_DOCUMENT_VERSION_MISMATCH/);
    expect(() => store.saveEvidence({
      ...evidence,
      sourceVersion: document.version,
      eventId: "foreign-event",
    })).toThrow(/DOMAIN_EVENT_NOT_FOUND/);
  });

  it("rejects Evidence whose entity does not match the bound event entity", () => {
    const store = openStore();
    const { context, sourceSystem, entity, document, event } = seedBase(store);
    const anotherEntity = createBusinessEntity({
      id: "quote-1",
      tenantId: "tenant-a",
      contextId: context.id,
      entityType: "quote",
      businessKey: "QT-1",
      attributes: {},
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });
    store.saveBusinessEntity(anotherEntity);
    const evidence = createEvidence({
      id: "evidence-mismatch",
      tenantId: "tenant-a",
      contextId: context.id,
      sourceSystemId: sourceSystem.id,
      sourceDocumentId: document.id,
      sourceVersion: document.version,
      entityId: anotherEntity.id,
      eventId: event.id,
      field: "qty",
      value: 100,
      valueType: "number",
      locator: { fileName: "SO-1.csv", row: 2 },
      quote: "qty=100",
      confidence: 1,
      support: "supported",
      observedAt: event.occurredAt,
      createdAt: "2026-09-02T00:00:00.000Z",
      metadata: {},
    });

    expect(() => store.saveEvidence(evidence)).toThrow(/DOMAIN_EVIDENCE_EVENT_ENTITY_MISMATCH/);
  });
});
