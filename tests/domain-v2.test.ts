import { describe, expect, it } from "vitest";
import {
  assertContextEntityRelation,
  assertEntityDocumentRelation,
  assertEntityReferenceSourceRelation,
  assertEvidenceEventRelation,
  assertUniqueEvents,
  assertUniqueEntityReferences,
  assertUniqueSourceDocuments,
  createBusinessEntity,
  createEntityReference,
  createEvidence,
  createFulfillmentContext,
  createFulfillmentEvent,
  createSourceDocument,
  createSourceSystem,
  type FulfillmentContext,
} from "../src/domain/v2/index.js";

const timestamps = {
  openedAt: "2026-09-18T00:00:00.000Z",
  updatedAt: "2026-09-18T00:00:00.000Z",
};

describe("V2 industrial domain foundation", () => {
  it("models a tenant-scoped fulfillment context without requiring a resolution case", () => {
    const context = createFulfillmentContext({
      id: "ctx-1",
      tenantId: "tenant-a",
      businessKey: "SO-2026-0001",
      contextType: "sales_order",
      status: "active",
      ...timestamps,
      metadata: { source: "fixture" },
    });

    expect(context).toMatchObject({ businessKey: "SO-2026-0001", contextType: "sales_order" });
    expect("caseId" in context).toBe(false);
  });

  it("models a generic business entity and cross-system references", () => {
    const context: FulfillmentContext = createFulfillmentContext({
      id: "ctx-1",
      tenantId: "tenant-a",
      businessKey: "SO-2026-0001",
      contextType: "sales_order",
      status: "active",
      ...timestamps,
      metadata: {},
    });
    const entity = createBusinessEntity({
      id: "entity-sales-order",
      tenantId: "tenant-a",
      contextId: context.id,
      entityType: "sales_order",
      businessKey: "SO-2026-0001",
      attributes: { currency: "CNY" },
      createdAt: timestamps.openedAt,
      updatedAt: timestamps.updatedAt,
    });
    const reference = createEntityReference({
      id: "ref-erp",
      tenantId: "tenant-a",
      entityId: entity.id,
      sourceSystemId: "system-erp",
      externalId: "ERP-SO-001",
      externalType: "sales_order",
      createdAt: timestamps.openedAt,
    });

    expect(entity.entityType).toBe("sales_order");
    expect(reference).toMatchObject({ entityId: entity.id, sourceSystemId: "system-erp", externalId: "ERP-SO-001" });
    expect(() => assertUniqueEntityReferences([
      reference,
      { ...reference, id: "ref-finance", sourceSystemId: "system-finance" },
    ])).not.toThrow();
    expect(() => assertUniqueEntityReferences([
      reference,
      { ...reference, id: "ref-duplicate" },
    ])).toThrow(/DOMAIN_ENTITY_REFERENCE_CONFLICT/);
  });

  it("models source systems and source documents separately from Case JSON", () => {
    const sourceSystem = createSourceSystem({
      id: "system-erp",
      tenantId: "tenant-a",
      name: "ERP",
      systemType: "erp",
      authorityLevel: "system_of_record",
      status: "active",
      metadata: {},
    });
    const document = createSourceDocument({
      id: "doc-1",
      tenantId: "tenant-a",
      sourceSystemId: sourceSystem.id,
      contextId: "ctx-1",
      entityId: "entity-sales-order",
      externalDocumentId: "ERP-SO-001",
      documentType: "sales_order",
      contentHash: "a".repeat(64),
      receivedAt: timestamps.openedAt,
      effectiveAt: "2026-09-17T00:00:00.000Z",
      version: "v1",
      metadata: {},
    });

    expect(document).toMatchObject({
      sourceSystemId: sourceSystem.id,
      externalDocumentId: "ERP-SO-001",
      documentType: "sales_order",
      version: "v1",
      receivedAt: timestamps.openedAt,
      effectiveAt: "2026-09-17T00:00:00.000Z",
    });
    expect(document.receivedAt).not.toBe(document.effectiveAt);
    expect(() => assertUniqueSourceDocuments([
      document,
      { ...document, id: "doc-duplicate" },
    ])).toThrow(/DOMAIN_SOURCE_DOCUMENT_CONFLICT/);
  });

  it("models replayable fulfillment events with distinct occurredAt and recordedAt", () => {
    const event = createFulfillmentEvent({
      id: "event-1",
      tenantId: "tenant-a",
      contextId: "ctx-1",
      entityId: "entity-sales-order",
      eventType: "ORDER_CREATED",
      occurredAt: "2026-09-16T08:00:00.000Z",
      recordedAt: "2026-09-18T00:00:00.000Z",
      sourceSystemId: "system-erp",
      sourceDocumentId: "doc-1",
      payload: { orderId: "ERP-SO-001" },
      idempotencyKey: "ERP-SO-001:created:v1",
    });

    expect(event.occurredAt).toBe("2026-09-16T08:00:00.000Z");
    expect(event.recordedAt).toBe("2026-09-18T00:00:00.000Z");
    expect(event.occurredAt).not.toBe(event.recordedAt);
    expect(() => assertUniqueEvents([
      event,
      { ...event, id: "event-duplicate" },
    ])).toThrow(/DOMAIN_EVENT_IDEMPOTENCY_CONFLICT/);
  });

  it("binds V2 evidence to context, document, entity, event, locator, and version", () => {
    const evidence = createEvidence({
      id: "evidence-1",
      tenantId: "tenant-a",
      contextId: "ctx-1",
      sourceSystemId: "system-erp",
      sourceDocumentId: "doc-1",
      sourceVersion: "v1",
      entityId: "entity-sales-order",
      eventId: "event-1",
      field: "qty",
      value: 80,
      valueType: "number",
      locator: { fileName: "ERP-SO-001.csv", row: 2, cell: "F2" },
      quote: "数量=80",
      confidence: 1,
      support: "supported",
      observedAt: "2026-09-16T08:00:00.000Z",
      createdAt: "2026-09-18T00:00:00.000Z",
      metadata: {},
    });

    expect(evidence).toMatchObject({
      contextId: "ctx-1",
      sourceSystemId: "system-erp",
      sourceDocumentId: "doc-1",
      sourceVersion: "v1",
      entityId: "entity-sales-order",
      eventId: "event-1",
      valueType: "number",
      support: "supported",
    });
  });

  it("fails closed on cross-tenant relationships", () => {
    const context = createFulfillmentContext({
      id: "ctx-a",
      tenantId: "tenant-a",
      businessKey: "SO-A",
      contextType: "sales_order",
      status: "active",
      ...timestamps,
      metadata: {},
    });
    const foreignEntity = createBusinessEntity({
      id: "entity-b",
      tenantId: "tenant-b",
      contextId: context.id,
      entityType: "sales_order",
      businessKey: "SO-B",
      attributes: {},
      createdAt: timestamps.openedAt,
      updatedAt: timestamps.updatedAt,
    });
    const localEntity = createBusinessEntity({
      ...foreignEntity,
      id: "entity-a",
      tenantId: "tenant-a",
      businessKey: "SO-A",
    });
    const foreignDocument = createSourceDocument({
      id: "doc-b",
      tenantId: "tenant-b",
      sourceSystemId: "system-b",
      contextId: context.id,
      entityId: localEntity.id,
      externalDocumentId: "DOC-B",
      documentType: "sales_order",
      contentHash: "b".repeat(64),
      receivedAt: timestamps.openedAt,
      effectiveAt: null,
      version: "v1",
      metadata: {},
    });
    const foreignSourceSystem = createSourceSystem({
      id: "system-b",
      tenantId: "tenant-b",
      name: "ERP B",
      systemType: "erp",
      authorityLevel: "authoritative",
      status: "active",
      metadata: {},
    });
    const localReference = createEntityReference({
      id: "ref-a",
      tenantId: "tenant-a",
      entityId: localEntity.id,
      sourceSystemId: foreignSourceSystem.id,
      externalId: "ERP-SO-A",
      externalType: "sales_order",
      createdAt: timestamps.openedAt,
    });
    const foreignEvent = createFulfillmentEvent({
      id: "event-b",
      tenantId: "tenant-b",
      contextId: context.id,
      entityId: localEntity.id,
      eventType: "ORDER_CREATED",
      occurredAt: timestamps.openedAt,
      recordedAt: timestamps.updatedAt,
      sourceSystemId: foreignSourceSystem.id,
      sourceDocumentId: foreignDocument.id,
      payload: {},
      idempotencyKey: "tenant-b-event",
    });
    const localEvidence = createEvidence({
      id: "evidence-a",
      tenantId: "tenant-a",
      contextId: context.id,
      sourceSystemId: "system-a",
      sourceDocumentId: "doc-a",
      sourceVersion: "v1",
      entityId: localEntity.id,
      eventId: foreignEvent.id,
      field: "qty",
      value: 1,
      valueType: "number",
      locator: { fileName: "doc-a.csv", row: 2 },
      quote: "数量=1",
      confidence: 1,
      support: "supported",
      observedAt: timestamps.openedAt,
      createdAt: timestamps.updatedAt,
      metadata: {},
    });

    expect(() => assertContextEntityRelation(context, foreignEntity)).toThrow(/DOMAIN_CONTEXT_ENTITY_TENANT_MISMATCH/);
    expect(() => assertEntityDocumentRelation(localEntity, foreignDocument)).toThrow(/DOMAIN_ENTITY_DOCUMENT_TENANT_MISMATCH/);
    expect(() => assertEntityReferenceSourceRelation(localReference, foreignSourceSystem)).toThrow(/DOMAIN_ENTITY_REFERENCE_SOURCE_TENANT_MISMATCH/);
    expect(() => assertEvidenceEventRelation(localEvidence, foreignEvent)).toThrow(/DOMAIN_EVIDENCE_EVENT_TENANT_MISMATCH/);
  });

  it("rejects malformed identity fields instead of silently creating invalid domain objects", () => {
    expect(() => createFulfillmentContext({
      id: "",
      tenantId: "tenant-a",
      businessKey: "SO-1",
      contextType: "sales_order",
      status: "active",
      ...timestamps,
      metadata: {},
    })).toThrow(/DOMAIN_ID_REQUIRED/);

    expect(() => createEntityReference({
      id: "ref-1",
      tenantId: "tenant-a",
      entityId: "entity-1",
      sourceSystemId: "system-erp",
      externalId: "",
      externalType: "sales_order",
      createdAt: timestamps.openedAt,
    })).toThrow(/DOMAIN_EXTERNAL_ID_REQUIRED/);
  });
});
