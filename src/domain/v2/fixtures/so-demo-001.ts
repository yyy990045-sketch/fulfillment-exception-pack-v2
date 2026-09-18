import type {
  BusinessEntity,
  EntityReference,
  FulfillmentContext,
  FulfillmentEvent,
  SourceDocument,
  SourceSystem,
  V2Evidence,
} from "../types.js";
import type { V2SqliteStore } from "../sqlite-store.js";

const tenantId = "demo-industrial";
const contextId = "ctx-so-demo-001";
const recordedAt = "2026-09-18T00:00:00.000Z";

export const SO_DEMO_001_CONTEXT: FulfillmentContext = {
  id: contextId,
  tenantId,
  businessKey: "SO-DEMO-001",
  contextType: "sales_order",
  status: "active",
  openedAt: "2026-09-01T00:00:00.000Z",
  updatedAt: recordedAt,
  metadata: { fixture: "SO-DEMO-001" },
};

export const SO_DEMO_001_SOURCE_SYSTEMS: SourceSystem[] = [
  { id: "CRM-DEMO", tenantId, name: "CRM Demo", systemType: "crm", authorityLevel: "authoritative", status: "active", metadata: {} },
  { id: "ERP-DEMO", tenantId, name: "ERP Demo", systemType: "erp", authorityLevel: "system_of_record", status: "active", metadata: {} },
  { id: "WMS-DEMO", tenantId, name: "WMS Demo", systemType: "wms", authorityLevel: "authoritative", status: "active", metadata: {} },
  { id: "FINANCE-DEMO", tenantId, name: "Finance Demo", systemType: "finance", authorityLevel: "system_of_record", status: "active", metadata: {} },
  { id: "SERVICE-DEMO", tenantId, name: "Service Demo", systemType: "manual", authorityLevel: "contributing", status: "active", metadata: {} },
];

export const SO_DEMO_001_ENTITIES: BusinessEntity[] = [
  {
    id: "entity-quote-demo-001",
    tenantId,
    contextId,
    entityType: "quote",
    businessKey: "QT-DEMO-001",
    attributes: { qty: 100 },
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: recordedAt,
  },
  {
    id: "entity-sales-order-demo-001",
    tenantId,
    contextId,
    entityType: "sales_order",
    businessKey: "SO-DEMO-001",
    attributes: { qty: 100 },
    createdAt: "2026-09-02T00:00:00.000Z",
    updatedAt: recordedAt,
  },
  {
    id: "entity-shipment-demo-001",
    tenantId,
    contextId,
    entityType: "shipment",
    businessKey: "SH-DEMO-001",
    attributes: { qty: 96 },
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: recordedAt,
  },
  {
    id: "entity-receivable-demo-001",
    tenantId,
    contextId,
    entityType: "receivable",
    businessKey: "AR-DEMO-001",
    attributes: { amount: 100000, receivedAmount: 80000 },
    createdAt: "2026-09-11T00:00:00.000Z",
    updatedAt: recordedAt,
  },
  {
    id: "entity-complaint-demo-001",
    tenantId,
    contextId,
    entityType: "complaint",
    businessKey: "CP-DEMO-001",
    attributes: { claimedReceivedQty: 80 },
    createdAt: "2026-09-15T00:00:00.000Z",
    updatedAt: recordedAt,
  },
];

export const SO_DEMO_001_ENTITY_REFERENCES: EntityReference[] = [
  { id: "ref-quote-crm", tenantId, entityId: "entity-quote-demo-001", sourceSystemId: "CRM-DEMO", externalId: "QT-DEMO-001", externalType: "quote", createdAt: "2026-09-01T00:00:00.000Z" },
  { id: "ref-order-erp", tenantId, entityId: "entity-sales-order-demo-001", sourceSystemId: "ERP-DEMO", externalId: "SO-DEMO-001", externalType: "sales_order", createdAt: "2026-09-02T00:00:00.000Z" },
  { id: "ref-shipment-wms", tenantId, entityId: "entity-shipment-demo-001", sourceSystemId: "WMS-DEMO", externalId: "SH-DEMO-001", externalType: "shipment", createdAt: "2026-09-10T00:00:00.000Z" },
  { id: "ref-receivable-finance", tenantId, entityId: "entity-receivable-demo-001", sourceSystemId: "FINANCE-DEMO", externalId: "AR-DEMO-001", externalType: "receivable", createdAt: "2026-09-11T00:00:00.000Z" },
  { id: "ref-complaint-service", tenantId, entityId: "entity-complaint-demo-001", sourceSystemId: "SERVICE-DEMO", externalId: "CP-DEMO-001", externalType: "complaint", createdAt: "2026-09-15T00:00:00.000Z" },
];

export const SO_DEMO_001_DOCUMENTS: SourceDocument[] = [
  { id: "doc-quote-demo-001-v1", tenantId, sourceSystemId: "CRM-DEMO", contextId, entityId: "entity-quote-demo-001", externalDocumentId: "QT-DEMO-001", documentType: "quote", contentHash: "1".repeat(64), receivedAt: recordedAt, effectiveAt: "2026-09-01T00:00:00.000Z", version: "v1", fileName: "QT-DEMO-001.csv", mimeType: "text/csv", metadata: {} },
  { id: "doc-order-demo-001-v1", tenantId, sourceSystemId: "ERP-DEMO", contextId, entityId: "entity-sales-order-demo-001", externalDocumentId: "SO-DEMO-001", documentType: "sales_order", contentHash: "2".repeat(64), receivedAt: recordedAt, effectiveAt: "2026-09-02T00:00:00.000Z", version: "v1", fileName: "SO-DEMO-001.csv", mimeType: "text/csv", metadata: {} },
  { id: "doc-shipment-demo-001-v1", tenantId, sourceSystemId: "WMS-DEMO", contextId, entityId: "entity-shipment-demo-001", externalDocumentId: "SH-DEMO-001", documentType: "shipment", contentHash: "3".repeat(64), receivedAt: recordedAt, effectiveAt: "2026-09-10T00:00:00.000Z", version: "v1", fileName: "SH-DEMO-001.csv", mimeType: "text/csv", metadata: {} },
  { id: "doc-receivable-demo-001-v1", tenantId, sourceSystemId: "FINANCE-DEMO", contextId, entityId: "entity-receivable-demo-001", externalDocumentId: "AR-DEMO-001", documentType: "receivable", contentHash: "4".repeat(64), receivedAt: recordedAt, effectiveAt: "2026-09-11T00:00:00.000Z", version: "v1", fileName: "AR-DEMO-001.csv", mimeType: "text/csv", metadata: {} },
  { id: "doc-complaint-demo-001-v1", tenantId, sourceSystemId: "SERVICE-DEMO", contextId, entityId: "entity-complaint-demo-001", externalDocumentId: "CP-DEMO-001", documentType: "complaint", contentHash: "5".repeat(64), receivedAt: recordedAt, effectiveAt: "2026-09-15T00:00:00.000Z", version: "v1", fileName: "CP-DEMO-001.csv", mimeType: "text/csv", metadata: {} },
];

export const SO_DEMO_001_EVENTS: FulfillmentEvent[] = [
  { id: "event-quote-created", tenantId, contextId, entityId: "entity-quote-demo-001", eventType: "QUOTE_CREATED", occurredAt: "2026-09-01T00:00:00.000Z", recordedAt, sourceSystemId: "CRM-DEMO", sourceDocumentId: "doc-quote-demo-001-v1", payload: { qty: 100 }, idempotencyKey: "QT-DEMO-001:v1:created" },
  { id: "event-order-created", tenantId, contextId, entityId: "entity-sales-order-demo-001", eventType: "ORDER_CREATED", occurredAt: "2026-09-02T00:00:00.000Z", recordedAt, sourceSystemId: "ERP-DEMO", sourceDocumentId: "doc-order-demo-001-v1", payload: { qty: 100 }, idempotencyKey: "SO-DEMO-001:v1:created" },
  { id: "event-shipment-created", tenantId, contextId, entityId: "entity-shipment-demo-001", eventType: "SHIPMENT_CREATED", occurredAt: "2026-09-10T00:00:00.000Z", recordedAt, sourceSystemId: "WMS-DEMO", sourceDocumentId: "doc-shipment-demo-001-v1", payload: { qty: 96 }, idempotencyKey: "SH-DEMO-001:v1:created" },
  { id: "event-receivable-created", tenantId, contextId, entityId: "entity-receivable-demo-001", eventType: "RECEIVABLE_CREATED", occurredAt: "2026-09-11T00:00:00.000Z", recordedAt, sourceSystemId: "FINANCE-DEMO", sourceDocumentId: "doc-receivable-demo-001-v1", payload: { amount: 100000, receivedAmount: 80000 }, idempotencyKey: "AR-DEMO-001:v1:created" },
  { id: "event-complaint-opened", tenantId, contextId, entityId: "entity-complaint-demo-001", eventType: "COMPLAINT_OPENED", occurredAt: "2026-09-15T00:00:00.000Z", recordedAt, sourceSystemId: "SERVICE-DEMO", sourceDocumentId: "doc-complaint-demo-001-v1", payload: { claimedReceivedQty: 80 }, idempotencyKey: "CP-DEMO-001:v1:opened" },
];

export const SO_DEMO_001_EVIDENCE: V2Evidence[] = [
  { id: "evidence-quote-qty", tenantId, contextId, sourceSystemId: "CRM-DEMO", sourceDocumentId: "doc-quote-demo-001-v1", sourceVersion: "v1", entityId: "entity-quote-demo-001", eventId: "event-quote-created", field: "qty", value: 100, valueType: "number", locator: { fileName: "QT-DEMO-001.csv", row: 2 }, quote: "qty=100", confidence: 1, support: "supported", observedAt: "2026-09-01T00:00:00.000Z", createdAt: recordedAt, metadata: {} },
  { id: "evidence-order-qty", tenantId, contextId, sourceSystemId: "ERP-DEMO", sourceDocumentId: "doc-order-demo-001-v1", sourceVersion: "v1", entityId: "entity-sales-order-demo-001", eventId: "event-order-created", field: "qty", value: 100, valueType: "number", locator: { fileName: "SO-DEMO-001.csv", row: 2 }, quote: "qty=100", confidence: 1, support: "supported", observedAt: "2026-09-02T00:00:00.000Z", createdAt: recordedAt, metadata: {} },
  { id: "evidence-shipment-qty", tenantId, contextId, sourceSystemId: "WMS-DEMO", sourceDocumentId: "doc-shipment-demo-001-v1", sourceVersion: "v1", entityId: "entity-shipment-demo-001", eventId: "event-shipment-created", field: "qty", value: 96, valueType: "number", locator: { fileName: "SH-DEMO-001.csv", row: 2 }, quote: "qty=96", confidence: 1, support: "supported", observedAt: "2026-09-10T00:00:00.000Z", createdAt: recordedAt, metadata: {} },
  { id: "evidence-receivable-amount", tenantId, contextId, sourceSystemId: "FINANCE-DEMO", sourceDocumentId: "doc-receivable-demo-001-v1", sourceVersion: "v1", entityId: "entity-receivable-demo-001", eventId: "event-receivable-created", field: "amount", value: 100000, valueType: "currency", locator: { fileName: "AR-DEMO-001.csv", row: 2 }, quote: "amount=100000", confidence: 1, support: "supported", observedAt: "2026-09-11T00:00:00.000Z", createdAt: recordedAt, metadata: {} },
  { id: "evidence-receivable-received", tenantId, contextId, sourceSystemId: "FINANCE-DEMO", sourceDocumentId: "doc-receivable-demo-001-v1", sourceVersion: "v1", entityId: "entity-receivable-demo-001", eventId: "event-receivable-created", field: "receivedAmount", value: 80000, valueType: "currency", locator: { fileName: "AR-DEMO-001.csv", row: 2 }, quote: "receivedAmount=80000", confidence: 1, support: "supported", observedAt: "2026-09-11T00:00:00.000Z", createdAt: recordedAt, metadata: {} },
  { id: "evidence-complaint-claimed-received", tenantId, contextId, sourceSystemId: "SERVICE-DEMO", sourceDocumentId: "doc-complaint-demo-001-v1", sourceVersion: "v1", entityId: "entity-complaint-demo-001", eventId: "event-complaint-opened", field: "claimedReceivedQty", value: 80, valueType: "number", locator: { fileName: "CP-DEMO-001.csv", row: 2 }, quote: "claimedReceivedQty=80", confidence: 1, support: "supported", observedAt: "2026-09-15T00:00:00.000Z", createdAt: recordedAt, metadata: {} },
];

export function seedSoDemo001(store: V2SqliteStore) {
  store.saveContext(SO_DEMO_001_CONTEXT);
  for (const sourceSystem of SO_DEMO_001_SOURCE_SYSTEMS) store.saveSourceSystem(sourceSystem);
  for (const entity of SO_DEMO_001_ENTITIES) store.saveBusinessEntity(entity);
  for (const reference of SO_DEMO_001_ENTITY_REFERENCES) store.saveEntityReference(reference);
  for (const document of SO_DEMO_001_DOCUMENTS) store.saveSourceDocument(document);
  for (const event of SO_DEMO_001_EVENTS) store.appendEvent(event);
  for (const evidence of SO_DEMO_001_EVIDENCE) store.saveEvidence(evidence);
}
