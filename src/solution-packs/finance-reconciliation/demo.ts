import {
  createBusinessEntity,
  createEntityReference,
  createEvidence,
  createFulfillmentContext,
  createFulfillmentEvent,
  createSourceDocument,
  createSourceSystem,
  type V2SqliteStore,
} from "../../domain/v2/index.js";

const contextId = "ctx-fin-rec-001";
const receivedAt = "2026-09-20T00:00:00.000Z";

export function provisionFinanceReconciliationDemo(store: V2SqliteStore, tenantId = "demo-finance") {
  const context = createFulfillmentContext({
    id: contextId,
    tenantId,
    businessKey: "REC-FIN-001",
    contextType: "finance_reconciliation",
    status: "active",
    openedAt: receivedAt,
    updatedAt: receivedAt,
    metadata: { synthetic: true, ruleProfile: "finance" },
  });
  const systems = [
    createSourceSystem({ id: "FIN-ERP-DEMO", tenantId, name: "Finance ERP Demo", systemType: "erp", authorityLevel: "system_of_record", status: "active", metadata: { synthetic: true } }),
    createSourceSystem({ id: "INVOICE-DEMO", tenantId, name: "Invoice Demo", systemType: "finance", authorityLevel: "authoritative", status: "active", metadata: { synthetic: true } }),
    createSourceSystem({ id: "BANK-DEMO", tenantId, name: "Bank Demo", systemType: "finance", authorityLevel: "authoritative", status: "active", metadata: { synthetic: true } }),
  ];
  const entities = [
    createBusinessEntity({ id: "entity-receivable-fin-001", tenantId, contextId, entityType: "receivable", businessKey: "AR-FIN-001", attributes: { amount: 100000 }, createdAt: receivedAt, updatedAt: receivedAt }),
    createBusinessEntity({ id: "entity-invoice-fin-001", tenantId, contextId, entityType: "invoice", businessKey: "INV-FIN-001", attributes: { amount: 100000 }, createdAt: receivedAt, updatedAt: receivedAt }),
    createBusinessEntity({ id: "entity-payment-fin-001", tenantId, contextId, entityType: "payment", businessKey: "BANK-FIN-001", attributes: { amount: 80000 }, createdAt: receivedAt, updatedAt: receivedAt }),
  ];
  const references = [
    createEntityReference({ id: "ref-receivable-fin-erp", tenantId, entityId: entities[0]!.id, sourceSystemId: "FIN-ERP-DEMO", externalId: "AR-FIN-001", externalType: "receivable", createdAt: receivedAt }),
    createEntityReference({ id: "ref-invoice-fin", tenantId, entityId: entities[1]!.id, sourceSystemId: "INVOICE-DEMO", externalId: "INV-FIN-001", externalType: "invoice", createdAt: receivedAt }),
    createEntityReference({ id: "ref-payment-fin-bank", tenantId, entityId: entities[2]!.id, sourceSystemId: "BANK-DEMO", externalId: "BANK-FIN-001", externalType: "bank_payment", createdAt: receivedAt }),
  ];
  const documents = [
    createSourceDocument({ id: "doc-receivable-fin-001-v1", tenantId, sourceSystemId: "FIN-ERP-DEMO", contextId, entityId: entities[0]!.id, externalDocumentId: "AR-FIN-001", documentType: "receivable", contentHash: "a".repeat(64), receivedAt, effectiveAt: receivedAt, version: "v1", metadata: { synthetic: true } }),
    createSourceDocument({ id: "doc-invoice-fin-001-v1", tenantId, sourceSystemId: "INVOICE-DEMO", contextId, entityId: entities[1]!.id, externalDocumentId: "INV-FIN-001", documentType: "invoice", contentHash: "b".repeat(64), receivedAt, effectiveAt: receivedAt, version: "v1", metadata: { synthetic: true } }),
    createSourceDocument({ id: "doc-payment-fin-001-v1", tenantId, sourceSystemId: "BANK-DEMO", contextId, entityId: entities[2]!.id, externalDocumentId: "BANK-FIN-001", documentType: "payment", contentHash: "c".repeat(64), receivedAt, effectiveAt: receivedAt, version: "v1", metadata: { synthetic: true } }),
  ];
  const events = [
    createFulfillmentEvent({ id: "event-receivable-fin-created", tenantId, contextId, entityId: entities[0]!.id, eventType: "RECEIVABLE_CREATED", occurredAt: receivedAt, recordedAt: receivedAt, sourceSystemId: "FIN-ERP-DEMO", sourceDocumentId: documents[0]!.id, payload: { amount: 100000 }, idempotencyKey: "AR-FIN-001:created:v1" }),
    createFulfillmentEvent({ id: "event-invoice-fin-created", tenantId, contextId, entityId: entities[1]!.id, eventType: "INVOICE_CREATED", occurredAt: receivedAt, recordedAt: receivedAt, sourceSystemId: "INVOICE-DEMO", sourceDocumentId: documents[1]!.id, payload: { amount: 100000 }, idempotencyKey: "INV-FIN-001:created:v1" }),
    createFulfillmentEvent({ id: "event-payment-fin-received", tenantId, contextId, entityId: entities[2]!.id, eventType: "BANK_PAYMENT_RECEIVED", occurredAt: receivedAt, recordedAt: receivedAt, sourceSystemId: "BANK-DEMO", sourceDocumentId: documents[2]!.id, payload: { amount: 80000 }, idempotencyKey: "BANK-FIN-001:received:v1" }),
  ];
  const evidence = [
    createEvidence({ id: "evidence-receivable-fin-amount", tenantId, contextId, sourceSystemId: "FIN-ERP-DEMO", sourceDocumentId: documents[0]!.id, sourceVersion: "v1", entityId: entities[0]!.id, eventId: events[0]!.id, field: "amount", value: 100000, valueType: "currency", locator: { fileName: "AR-FIN-001.csv", row: 2 }, quote: "应收=100000", confidence: 1, support: "supported", observedAt: receivedAt, createdAt: receivedAt, metadata: { synthetic: true } }),
    createEvidence({ id: "evidence-invoice-fin-amount", tenantId, contextId, sourceSystemId: "INVOICE-DEMO", sourceDocumentId: documents[1]!.id, sourceVersion: "v1", entityId: entities[1]!.id, eventId: events[1]!.id, field: "amount", value: 100000, valueType: "currency", locator: { fileName: "INV-FIN-001.csv", row: 2 }, quote: "发票=100000", confidence: 1, support: "supported", observedAt: receivedAt, createdAt: receivedAt, metadata: { synthetic: true } }),
    createEvidence({ id: "evidence-payment-fin-amount", tenantId, contextId, sourceSystemId: "BANK-DEMO", sourceDocumentId: documents[2]!.id, sourceVersion: "v1", entityId: entities[2]!.id, eventId: events[2]!.id, field: "amount", value: 80000, valueType: "currency", locator: { fileName: "BANK-FIN-001.csv", row: 2 }, quote: "银行回款=80000", confidence: 1, support: "supported", observedAt: receivedAt, createdAt: receivedAt, metadata: { synthetic: true } }),
    createEvidence({ id: "evidence-payment-fin-outstanding", tenantId, contextId, sourceSystemId: "BANK-DEMO", sourceDocumentId: documents[2]!.id, sourceVersion: "v1", entityId: entities[2]!.id, field: "outstandingAmount", value: 0, valueType: "currency", locator: { fileName: "BANK-FIN-001.csv", row: 3 }, quote: "未覆盖=0", confidence: 1, support: "supported", observedAt: "2026-10-01T00:00:00.000Z", createdAt: "2026-10-01T00:00:00.000Z", metadata: { synthetic: true } }),
  ];
  store.saveContext(context);
  for (const system of systems) store.saveSourceSystem(system);
  for (const entity of entities) store.saveBusinessEntity(entity);
  for (const reference of references) store.saveEntityReference(reference);
  for (const document of documents) store.saveSourceDocument(document);
  for (const event of events) store.appendEvent(event);
  for (const item of evidence) store.saveEvidence(item);
  return {
    contextId,
    entities: entities.length,
    sourceSystems: systems.length,
    documents: documents.length,
    events: events.length,
    evidence: evidence.length,
  };
}
