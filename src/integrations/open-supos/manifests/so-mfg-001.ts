import type { OpenSupOSUnsEnvelope } from "../types.js";
import { buildUnsTopic } from "../topic-mapper.js";

const tenantKey = "demo-manufacturing";
const context = { businessKey: "SO-MFG-001", contextType: "sales_order" as const };
const metadata = { recordedAt: "2026-09-18T00:00:00.000Z" };

function message(input: {
  messageId: string;
  systemKey: string;
  systemType: OpenSupOSUnsEnvelope["source"]["systemType"];
  externalDocumentId: string;
  documentType: string;
  entityType: OpenSupOSUnsEnvelope["entity"]["entityType"];
  entityBusinessKey: string;
  eventType: OpenSupOSUnsEnvelope["event"]["eventType"];
  occurredAt: string;
  facts: OpenSupOSUnsEnvelope["facts"];
  quote: string;
}): OpenSupOSUnsEnvelope {
  return {
    schemaVersion: "1.0",
    messageId: input.messageId,
    tenantKey,
    context,
    source: {
      systemKey: input.systemKey,
      systemType: input.systemType,
      externalDocumentId: input.externalDocumentId,
      documentType: input.documentType,
      sourceVersion: "v1",
    },
    entity: { entityType: input.entityType, businessKey: input.entityBusinessKey },
    event: { eventType: input.eventType, occurredAt: input.occurredAt },
    facts: input.facts,
    lineage: { quote: input.quote, confidence: 1 },
    metadata,
  };
}

const ENVELOPES: OpenSupOSUnsEnvelope[] = [
  message({ messageId: "CRM-DEMO:QT-MFG-001:v1:created", systemKey: "CRM-DEMO", systemType: "crm", externalDocumentId: "QT-MFG-001", documentType: "quote", entityType: "quote", entityBusinessKey: "QT-MFG-001", eventType: "QUOTE_CREATED", occurredAt: "2026-09-01T00:00:00.000Z", facts: { qty: { value: 100, valueType: "number" } }, quote: "qty=100" }),
  message({ messageId: "ERP-DEMO:SO-MFG-001:v1:created", systemKey: "ERP-DEMO", systemType: "erp", externalDocumentId: "SO-MFG-001", documentType: "sales_order", entityType: "sales_order", entityBusinessKey: "SO-MFG-001", eventType: "ORDER_CREATED", occurredAt: "2026-09-02T00:00:00.000Z", facts: { qty: { value: 100, valueType: "number" } }, quote: "qty=100" }),
  message({ messageId: "MES-DEMO:MO-MFG-001:v1:started", systemKey: "MES-DEMO", systemType: "mes", externalDocumentId: "MO-MFG-001", documentType: "production_order", entityType: "production_order", entityBusinessKey: "MO-MFG-001", eventType: "PRODUCTION_STARTED", occurredAt: "2026-09-04T00:00:00.000Z", facts: { plannedQty: { value: 100, valueType: "number" } }, quote: "plannedQty=100" }),
  message({ messageId: "MES-DEMO:MO-MFG-001:v1:completed", systemKey: "MES-DEMO", systemType: "mes", externalDocumentId: "MO-MFG-001", documentType: "production_order", entityType: "production_order", entityBusinessKey: "MO-MFG-001", eventType: "PRODUCTION_COMPLETED", occurredAt: "2026-09-08T00:00:00.000Z", facts: { completedQty: { value: 100, valueType: "number" } }, quote: "completedQty=100" }),
  message({ messageId: "QMS-DEMO:QC-MFG-001:v1:inspected", systemKey: "QMS-DEMO", systemType: "qms", externalDocumentId: "QC-MFG-001", documentType: "quality_inspection", entityType: "quality_event", entityBusinessKey: "QC-MFG-001", eventType: "QUALITY_INSPECTED", occurredAt: "2026-09-09T09:00:00.000Z", facts: { inspectedQty: { value: 100, valueType: "number" } }, quote: "inspectedQty=100" }),
  message({ messageId: "QMS-DEMO:QC-MFG-001:v1:passed", systemKey: "QMS-DEMO", systemType: "qms", externalDocumentId: "QC-MFG-001", documentType: "quality_inspection", entityType: "quality_event", entityBusinessKey: "QC-MFG-001", eventType: "QUALITY_PASSED", occurredAt: "2026-09-09T12:00:00.000Z", facts: { passedQty: { value: 96, valueType: "number" } }, quote: "passedQty=96" }),
  message({ messageId: "QMS-DEMO:QC-MFG-001:v1:failed", systemKey: "QMS-DEMO", systemType: "qms", externalDocumentId: "QC-MFG-001", documentType: "quality_inspection", entityType: "quality_event", entityBusinessKey: "QC-MFG-001", eventType: "QUALITY_FAILED", occurredAt: "2026-09-09T12:01:00.000Z", facts: { failedQty: { value: 4, valueType: "number" } }, quote: "failedQty=4" }),
  message({ messageId: "WMS-DEMO:SH-MFG-001:v1:dispatched", systemKey: "WMS-DEMO", systemType: "wms", externalDocumentId: "SH-MFG-001", documentType: "shipment", entityType: "shipment", entityBusinessKey: "SH-MFG-001", eventType: "SHIPMENT_DISPATCHED", occurredAt: "2026-09-10T00:00:00.000Z", facts: { qty: { value: 96, valueType: "number" } }, quote: "qty=96" }),
  message({ messageId: "FINANCE-DEMO:AR-MFG-001:v1:created", systemKey: "FINANCE-DEMO", systemType: "finance", externalDocumentId: "AR-MFG-001", documentType: "receivable", entityType: "receivable", entityBusinessKey: "AR-MFG-001", eventType: "RECEIVABLE_CREATED", occurredAt: "2026-09-11T00:00:00.000Z", facts: { amount: { value: 100000, valueType: "currency" } }, quote: "amount=100000" }),
  message({ messageId: "FINANCE-DEMO:PAY-MFG-001:v1:received", systemKey: "FINANCE-DEMO", systemType: "finance", externalDocumentId: "PAY-MFG-001", documentType: "payment", entityType: "payment", entityBusinessKey: "PAY-MFG-001", eventType: "PAYMENT_RECEIVED", occurredAt: "2026-09-12T00:00:00.000Z", facts: { amount: { value: 80000, valueType: "currency" } }, quote: "amount=80000" }),
  message({ messageId: "SERVICE-DEMO:CP-MFG-001:v1:opened", systemKey: "SERVICE-DEMO", systemType: "manual", externalDocumentId: "CP-MFG-001", documentType: "complaint", entityType: "complaint", entityBusinessKey: "CP-MFG-001", eventType: "COMPLAINT_OPENED", occurredAt: "2026-09-15T00:00:00.000Z", facts: { claimedReceivedQty: { value: 80, valueType: "number" } }, quote: "claimedReceivedQty=80" }),
];

export const SO_MFG_001_UNS_MANIFEST = ENVELOPES.map((envelope) => ({
  topic: buildUnsTopic(envelope),
  envelope,
}));

export function buildSoMfg001UnsMessages() {
  return SO_MFG_001_UNS_MANIFEST.map((item) => ({ topic: item.topic, envelope: structuredClone(item.envelope) }));
}
