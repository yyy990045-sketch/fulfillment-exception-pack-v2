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

const tenantId = "demo-manufacturing";
const contextId = "ctx-so-mfg-001";
const receivedAt = "2026-09-18T00:00:00.000Z";

export const SO_MFG_001_CONTEXT: FulfillmentContext = {
  id: contextId,
  tenantId,
  businessKey: "SO-MFG-001",
  contextType: "sales_order",
  status: "active",
  openedAt: "2026-09-01T00:00:00.000Z",
  updatedAt: receivedAt,
  metadata: { fixture: "SO-MFG-001", purpose: "manufacturing_competition_demo" },
};

export const SO_MFG_001_SOURCE_SYSTEMS: SourceSystem[] = [
  { id: "CRM-DEMO", tenantId, name: "CRM Demo", systemType: "crm", authorityLevel: "authoritative", status: "active", metadata: {} },
  { id: "ERP-DEMO", tenantId, name: "ERP Demo", systemType: "erp", authorityLevel: "system_of_record", status: "active", metadata: {} },
  { id: "MES-DEMO", tenantId, name: "MES Demo", systemType: "mes", authorityLevel: "system_of_record", status: "active", metadata: {} },
  { id: "QMS-DEMO", tenantId, name: "QMS Demo", systemType: "qms", authorityLevel: "system_of_record", status: "active", metadata: {} },
  { id: "WMS-DEMO", tenantId, name: "WMS Demo", systemType: "wms", authorityLevel: "authoritative", status: "active", metadata: {} },
  { id: "FINANCE-DEMO", tenantId, name: "Finance Demo", systemType: "finance", authorityLevel: "system_of_record", status: "active", metadata: {} },
  { id: "SERVICE-DEMO", tenantId, name: "Service Demo", systemType: "manual", authorityLevel: "contributing", status: "active", metadata: {} },
];

export const SO_MFG_001_ENTITIES: BusinessEntity[] = [
  { id: "entity-quote-mfg-001", tenantId, contextId, entityType: "quote", businessKey: "QT-MFG-001", attributes: { qty: 100 }, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: receivedAt },
  { id: "entity-sales-order-mfg-001", tenantId, contextId, entityType: "sales_order", businessKey: "SO-MFG-001", attributes: { qty: 100 }, createdAt: "2026-09-02T00:00:00.000Z", updatedAt: receivedAt },
  { id: "entity-production-order-mfg-001", tenantId, contextId, entityType: "production_order", businessKey: "MO-MFG-001", attributes: { plannedQty: 100, completedQty: 100 }, createdAt: "2026-09-04T00:00:00.000Z", updatedAt: receivedAt },
  { id: "entity-quality-event-mfg-001", tenantId, contextId, entityType: "quality_event", businessKey: "QC-MFG-001", attributes: { inspectedQty: 100, passedQty: 96, failedQty: 4 }, createdAt: "2026-09-09T09:00:00.000Z", updatedAt: receivedAt },
  { id: "entity-shipment-mfg-001", tenantId, contextId, entityType: "shipment", businessKey: "SH-MFG-001", attributes: { qty: 96 }, createdAt: "2026-09-10T00:00:00.000Z", updatedAt: receivedAt },
  { id: "entity-receivable-mfg-001", tenantId, contextId, entityType: "receivable", businessKey: "AR-MFG-001", attributes: { amount: 100000 }, createdAt: "2026-09-11T00:00:00.000Z", updatedAt: receivedAt },
  { id: "entity-payment-mfg-001", tenantId, contextId, entityType: "payment", businessKey: "PAY-MFG-001", attributes: { amount: 80000 }, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: receivedAt },
  { id: "entity-complaint-mfg-001", tenantId, contextId, entityType: "complaint", businessKey: "CP-MFG-001", attributes: { claimedReceivedQty: 80 }, createdAt: "2026-09-15T00:00:00.000Z", updatedAt: receivedAt },
];

export const SO_MFG_001_ENTITY_REFERENCES: EntityReference[] = [
  { id: "ref-quote-mfg-crm", tenantId, entityId: "entity-quote-mfg-001", sourceSystemId: "CRM-DEMO", externalId: "QT-MFG-001", externalType: "quote", createdAt: "2026-09-01T00:00:00.000Z" },
  { id: "ref-order-mfg-erp", tenantId, entityId: "entity-sales-order-mfg-001", sourceSystemId: "ERP-DEMO", externalId: "SO-MFG-001", externalType: "sales_order", createdAt: "2026-09-02T00:00:00.000Z" },
  { id: "ref-production-mfg-mes", tenantId, entityId: "entity-production-order-mfg-001", sourceSystemId: "MES-DEMO", externalId: "MO-MFG-001", externalType: "production_order", createdAt: "2026-09-04T00:00:00.000Z" },
  { id: "ref-quality-mfg-qms", tenantId, entityId: "entity-quality-event-mfg-001", sourceSystemId: "QMS-DEMO", externalId: "QC-MFG-001", externalType: "quality_inspection", createdAt: "2026-09-09T09:00:00.000Z" },
  { id: "ref-shipment-mfg-wms", tenantId, entityId: "entity-shipment-mfg-001", sourceSystemId: "WMS-DEMO", externalId: "SH-MFG-001", externalType: "shipment", createdAt: "2026-09-10T00:00:00.000Z" },
  { id: "ref-receivable-mfg-finance", tenantId, entityId: "entity-receivable-mfg-001", sourceSystemId: "FINANCE-DEMO", externalId: "AR-MFG-001", externalType: "receivable", createdAt: "2026-09-11T00:00:00.000Z" },
  { id: "ref-payment-mfg-finance", tenantId, entityId: "entity-payment-mfg-001", sourceSystemId: "FINANCE-DEMO", externalId: "PAY-MFG-001", externalType: "payment", createdAt: "2026-09-12T00:00:00.000Z" },
  { id: "ref-complaint-mfg-service", tenantId, entityId: "entity-complaint-mfg-001", sourceSystemId: "SERVICE-DEMO", externalId: "CP-MFG-001", externalType: "complaint", createdAt: "2026-09-15T00:00:00.000Z" },
];

function document(input: {
  id: string;
  sourceSystemId: string;
  entityId: string;
  externalDocumentId: string;
  documentType: string;
  effectiveAt: string;
  hashDigit: string;
}): SourceDocument {
  return {
    id: input.id,
    tenantId,
    sourceSystemId: input.sourceSystemId,
    contextId,
    entityId: input.entityId,
    externalDocumentId: input.externalDocumentId,
    documentType: input.documentType,
    contentHash: input.hashDigit.repeat(64),
    receivedAt,
    effectiveAt: input.effectiveAt,
    version: "v1",
    fileName: `${input.externalDocumentId}.csv`,
    mimeType: "text/csv",
    metadata: {},
  };
}

export const SO_MFG_001_DOCUMENTS: SourceDocument[] = [
  document({ id: "doc-quote-mfg-001-v1", sourceSystemId: "CRM-DEMO", entityId: "entity-quote-mfg-001", externalDocumentId: "QT-MFG-001", documentType: "quote", effectiveAt: "2026-09-01T00:00:00.000Z", hashDigit: "1" }),
  document({ id: "doc-order-mfg-001-v1", sourceSystemId: "ERP-DEMO", entityId: "entity-sales-order-mfg-001", externalDocumentId: "SO-MFG-001", documentType: "sales_order", effectiveAt: "2026-09-02T00:00:00.000Z", hashDigit: "2" }),
  document({ id: "doc-production-mfg-001-v1", sourceSystemId: "MES-DEMO", entityId: "entity-production-order-mfg-001", externalDocumentId: "MO-MFG-001", documentType: "production_order", effectiveAt: "2026-09-04T00:00:00.000Z", hashDigit: "3" }),
  document({ id: "doc-quality-mfg-001-v1", sourceSystemId: "QMS-DEMO", entityId: "entity-quality-event-mfg-001", externalDocumentId: "QC-MFG-001", documentType: "quality_inspection", effectiveAt: "2026-09-09T09:00:00.000Z", hashDigit: "4" }),
  document({ id: "doc-shipment-mfg-001-v1", sourceSystemId: "WMS-DEMO", entityId: "entity-shipment-mfg-001", externalDocumentId: "SH-MFG-001", documentType: "shipment", effectiveAt: "2026-09-10T00:00:00.000Z", hashDigit: "5" }),
  document({ id: "doc-receivable-mfg-001-v1", sourceSystemId: "FINANCE-DEMO", entityId: "entity-receivable-mfg-001", externalDocumentId: "AR-MFG-001", documentType: "receivable", effectiveAt: "2026-09-11T00:00:00.000Z", hashDigit: "6" }),
  document({ id: "doc-payment-mfg-001-v1", sourceSystemId: "FINANCE-DEMO", entityId: "entity-payment-mfg-001", externalDocumentId: "PAY-MFG-001", documentType: "payment", effectiveAt: "2026-09-12T00:00:00.000Z", hashDigit: "7" }),
  document({ id: "doc-complaint-mfg-001-v1", sourceSystemId: "SERVICE-DEMO", entityId: "entity-complaint-mfg-001", externalDocumentId: "CP-MFG-001", documentType: "complaint", effectiveAt: "2026-09-15T00:00:00.000Z", hashDigit: "8" }),
];

function event(input: {
  id: string;
  entityId: string;
  eventType: FulfillmentEvent["eventType"];
  occurredAt: string;
  sourceSystemId: string;
  sourceDocumentId: string;
  payload: Record<string, unknown>;
}): FulfillmentEvent {
  return {
    ...input,
    tenantId,
    contextId,
    recordedAt: receivedAt,
    idempotencyKey: `${input.sourceDocumentId}:${input.eventType}`,
  };
}

export const SO_MFG_001_EVENTS: FulfillmentEvent[] = [
  event({ id: "event-quote-mfg-created", entityId: "entity-quote-mfg-001", eventType: "QUOTE_CREATED", occurredAt: "2026-09-01T00:00:00.000Z", sourceSystemId: "CRM-DEMO", sourceDocumentId: "doc-quote-mfg-001-v1", payload: { qty: 100 } }),
  event({ id: "event-order-mfg-created", entityId: "entity-sales-order-mfg-001", eventType: "ORDER_CREATED", occurredAt: "2026-09-02T00:00:00.000Z", sourceSystemId: "ERP-DEMO", sourceDocumentId: "doc-order-mfg-001-v1", payload: { qty: 100 } }),
  event({ id: "event-production-mfg-started", entityId: "entity-production-order-mfg-001", eventType: "PRODUCTION_STARTED", occurredAt: "2026-09-04T00:00:00.000Z", sourceSystemId: "MES-DEMO", sourceDocumentId: "doc-production-mfg-001-v1", payload: { plannedQty: 100 } }),
  event({ id: "event-production-mfg-completed", entityId: "entity-production-order-mfg-001", eventType: "PRODUCTION_COMPLETED", occurredAt: "2026-09-08T00:00:00.000Z", sourceSystemId: "MES-DEMO", sourceDocumentId: "doc-production-mfg-001-v1", payload: { completedQty: 100 } }),
  event({ id: "event-quality-mfg-inspected", entityId: "entity-quality-event-mfg-001", eventType: "QUALITY_INSPECTED", occurredAt: "2026-09-09T09:00:00.000Z", sourceSystemId: "QMS-DEMO", sourceDocumentId: "doc-quality-mfg-001-v1", payload: { inspectedQty: 100 } }),
  event({ id: "event-quality-mfg-passed", entityId: "entity-quality-event-mfg-001", eventType: "QUALITY_PASSED", occurredAt: "2026-09-09T12:00:00.000Z", sourceSystemId: "QMS-DEMO", sourceDocumentId: "doc-quality-mfg-001-v1", payload: { passedQty: 96 } }),
  event({ id: "event-quality-mfg-failed", entityId: "entity-quality-event-mfg-001", eventType: "QUALITY_FAILED", occurredAt: "2026-09-09T12:01:00.000Z", sourceSystemId: "QMS-DEMO", sourceDocumentId: "doc-quality-mfg-001-v1", payload: { failedQty: 4 } }),
  event({ id: "event-shipment-mfg-dispatched", entityId: "entity-shipment-mfg-001", eventType: "SHIPMENT_DISPATCHED", occurredAt: "2026-09-10T00:00:00.000Z", sourceSystemId: "WMS-DEMO", sourceDocumentId: "doc-shipment-mfg-001-v1", payload: { qty: 96 } }),
  event({ id: "event-receivable-mfg-created", entityId: "entity-receivable-mfg-001", eventType: "RECEIVABLE_CREATED", occurredAt: "2026-09-11T00:00:00.000Z", sourceSystemId: "FINANCE-DEMO", sourceDocumentId: "doc-receivable-mfg-001-v1", payload: { amount: 100000 } }),
  event({ id: "event-payment-mfg-received", entityId: "entity-payment-mfg-001", eventType: "PAYMENT_RECEIVED", occurredAt: "2026-09-12T00:00:00.000Z", sourceSystemId: "FINANCE-DEMO", sourceDocumentId: "doc-payment-mfg-001-v1", payload: { amount: 80000 } }),
  event({ id: "event-complaint-mfg-opened", entityId: "entity-complaint-mfg-001", eventType: "COMPLAINT_OPENED", occurredAt: "2026-09-15T00:00:00.000Z", sourceSystemId: "SERVICE-DEMO", sourceDocumentId: "doc-complaint-mfg-001-v1", payload: { claimedReceivedQty: 80 } }),
];

function evidence(input: {
  id: string;
  sourceSystemId: string;
  sourceDocumentId: string;
  entityId: string;
  eventId: string;
  field: string;
  value: number;
  valueType: V2Evidence["valueType"];
  fileName: string;
  observedAt: string;
}): V2Evidence {
  return {
    ...input,
    tenantId,
    contextId,
    sourceVersion: "v1",
    locator: { fileName: input.fileName, row: 2 },
    quote: `${input.field}=${input.value}`,
    confidence: 1,
    support: "supported",
    createdAt: receivedAt,
    metadata: {},
  };
}

export const SO_MFG_001_EVIDENCE: V2Evidence[] = [
  evidence({ id: "evidence-quote-mfg-qty", sourceSystemId: "CRM-DEMO", sourceDocumentId: "doc-quote-mfg-001-v1", entityId: "entity-quote-mfg-001", eventId: "event-quote-mfg-created", field: "qty", value: 100, valueType: "number", fileName: "QT-MFG-001.csv", observedAt: "2026-09-01T00:00:00.000Z" }),
  evidence({ id: "evidence-order-mfg-qty", sourceSystemId: "ERP-DEMO", sourceDocumentId: "doc-order-mfg-001-v1", entityId: "entity-sales-order-mfg-001", eventId: "event-order-mfg-created", field: "qty", value: 100, valueType: "number", fileName: "SO-MFG-001.csv", observedAt: "2026-09-02T00:00:00.000Z" }),
  evidence({ id: "evidence-production-mfg-planned", sourceSystemId: "MES-DEMO", sourceDocumentId: "doc-production-mfg-001-v1", entityId: "entity-production-order-mfg-001", eventId: "event-production-mfg-started", field: "plannedQty", value: 100, valueType: "number", fileName: "MO-MFG-001.csv", observedAt: "2026-09-04T00:00:00.000Z" }),
  evidence({ id: "evidence-production-mfg-completed", sourceSystemId: "MES-DEMO", sourceDocumentId: "doc-production-mfg-001-v1", entityId: "entity-production-order-mfg-001", eventId: "event-production-mfg-completed", field: "completedQty", value: 100, valueType: "number", fileName: "MO-MFG-001.csv", observedAt: "2026-09-08T00:00:00.000Z" }),
  evidence({ id: "evidence-quality-mfg-inspected", sourceSystemId: "QMS-DEMO", sourceDocumentId: "doc-quality-mfg-001-v1", entityId: "entity-quality-event-mfg-001", eventId: "event-quality-mfg-inspected", field: "inspectedQty", value: 100, valueType: "number", fileName: "QC-MFG-001.csv", observedAt: "2026-09-09T09:00:00.000Z" }),
  evidence({ id: "evidence-quality-mfg-passed", sourceSystemId: "QMS-DEMO", sourceDocumentId: "doc-quality-mfg-001-v1", entityId: "entity-quality-event-mfg-001", eventId: "event-quality-mfg-passed", field: "passedQty", value: 96, valueType: "number", fileName: "QC-MFG-001.csv", observedAt: "2026-09-09T12:00:00.000Z" }),
  evidence({ id: "evidence-quality-mfg-failed", sourceSystemId: "QMS-DEMO", sourceDocumentId: "doc-quality-mfg-001-v1", entityId: "entity-quality-event-mfg-001", eventId: "event-quality-mfg-failed", field: "failedQty", value: 4, valueType: "number", fileName: "QC-MFG-001.csv", observedAt: "2026-09-09T12:01:00.000Z" }),
  evidence({ id: "evidence-shipment-mfg-qty", sourceSystemId: "WMS-DEMO", sourceDocumentId: "doc-shipment-mfg-001-v1", entityId: "entity-shipment-mfg-001", eventId: "event-shipment-mfg-dispatched", field: "qty", value: 96, valueType: "number", fileName: "SH-MFG-001.csv", observedAt: "2026-09-10T00:00:00.000Z" }),
  evidence({ id: "evidence-receivable-mfg-amount", sourceSystemId: "FINANCE-DEMO", sourceDocumentId: "doc-receivable-mfg-001-v1", entityId: "entity-receivable-mfg-001", eventId: "event-receivable-mfg-created", field: "amount", value: 100000, valueType: "currency", fileName: "AR-MFG-001.csv", observedAt: "2026-09-11T00:00:00.000Z" }),
  evidence({ id: "evidence-payment-mfg-amount", sourceSystemId: "FINANCE-DEMO", sourceDocumentId: "doc-payment-mfg-001-v1", entityId: "entity-payment-mfg-001", eventId: "event-payment-mfg-received", field: "amount", value: 80000, valueType: "currency", fileName: "PAY-MFG-001.csv", observedAt: "2026-09-12T00:00:00.000Z" }),
  evidence({ id: "evidence-complaint-mfg-claimed", sourceSystemId: "SERVICE-DEMO", sourceDocumentId: "doc-complaint-mfg-001-v1", entityId: "entity-complaint-mfg-001", eventId: "event-complaint-mfg-opened", field: "claimedReceivedQty", value: 80, valueType: "number", fileName: "CP-MFG-001.csv", observedAt: "2026-09-15T00:00:00.000Z" }),
];

export function seedSoMfg001(store: V2SqliteStore) {
  store.saveContext(SO_MFG_001_CONTEXT);
  for (const sourceSystem of SO_MFG_001_SOURCE_SYSTEMS) store.saveSourceSystem(sourceSystem);
  for (const entity of SO_MFG_001_ENTITIES) store.saveBusinessEntity(entity);
  for (const reference of SO_MFG_001_ENTITY_REFERENCES) store.saveEntityReference(reference);
  for (const document of SO_MFG_001_DOCUMENTS) store.saveSourceDocument(document);
  for (const event of SO_MFG_001_EVENTS) store.appendEvent(event);
  for (const item of SO_MFG_001_EVIDENCE) store.saveEvidence(item);
}
