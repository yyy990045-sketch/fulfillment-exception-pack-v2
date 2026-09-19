export type FulfillmentContextType = "sales_order" | "project" | "contract" | "finance_reconciliation";

export type FulfillmentContextStatus = "open" | "active" | "on_hold" | "closed" | "cancelled";

export type BusinessEntityType =
  | "quote"
  | "contract"
  | "sales_order"
  | "production_order"
  | "quality_event"
  | "shipment"
  | "receivable"
  | "invoice"
  | "payment"
  | "complaint";

export type SourceSystemType = "erp" | "mes" | "qms" | "wms" | "crm" | "finance" | "manual" | "file" | "demo";

export type SourceSystemAuthorityLevel = "system_of_record" | "authoritative" | "contributing" | "reference";

export type SourceSystemStatus = "active" | "inactive";

export const FULFILLMENT_EVENT_TYPES = [
  "QUOTE_CREATED",
  "QUOTE_CHANGED",
  "ORDER_CREATED",
  "ORDER_CHANGED",
  "PRODUCTION_STARTED",
  "PRODUCTION_COMPLETED",
  "QUALITY_INSPECTED",
  "QUALITY_PASSED",
  "QUALITY_FAILED",
  "SHIPMENT_CREATED",
  "SHIPMENT_DISPATCHED",
  "SHIPMENT_SIGNED",
  "RECEIVABLE_CREATED",
  "INVOICE_CREATED",
  "PAYMENT_RECEIVED",
  "BANK_PAYMENT_RECEIVED",
  "COMPLAINT_OPENED",
  "COMPLAINT_UPDATED",
] as const;

export type FulfillmentEventType = (typeof FULFILLMENT_EVENT_TYPES)[number];

export type EvidenceValueType = "string" | "number" | "boolean" | "date" | "datetime" | "currency" | "json" | "null";

export type EvidenceSupport = "supported" | "partial" | "unsupported";

export type EvidenceLocator = {
  fileName: string;
  sheet?: string;
  row?: number;
  cell?: string;
  line?: number;
  page?: number;
};

export type FulfillmentContext = {
  id: string;
  tenantId: string;
  businessKey: string;
  contextType: FulfillmentContextType;
  status: FulfillmentContextStatus;
  openedAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
};

export type BusinessEntity = {
  id: string;
  tenantId: string;
  contextId: string;
  entityType: BusinessEntityType;
  businessKey: string;
  attributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type EntityReference = {
  id: string;
  tenantId: string;
  entityId: string;
  sourceSystemId: string;
  externalId: string;
  externalType: string;
  createdAt: string;
};

export type SourceSystem = {
  id: string;
  tenantId: string;
  name: string;
  systemType: SourceSystemType;
  authorityLevel: SourceSystemAuthorityLevel;
  status: SourceSystemStatus;
  metadata: Record<string, unknown>;
};

export type SourceDocument = {
  id: string;
  tenantId: string;
  sourceSystemId: string;
  externalDocumentId: string;
  documentType: string;
  contentHash: string;
  receivedAt: string;
  effectiveAt: string | null;
  version: string;
  contextId?: string;
  entityId?: string;
  fileName?: string;
  mimeType?: string;
  metadata: Record<string, unknown>;
};

export type FulfillmentEvent = {
  id: string;
  tenantId: string;
  contextId: string;
  entityId: string;
  eventType: FulfillmentEventType;
  occurredAt: string;
  recordedAt: string;
  sourceSystemId: string;
  sourceDocumentId?: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
};

export type EvidenceBinding = {
  tenantId: string;
  contextId: string;
  sourceSystemId: string;
  sourceDocumentId: string;
  entityId?: string;
  eventId?: string;
};

export type V2Evidence = EvidenceBinding & {
  id: string;
  sourceVersion: string;
  field: string;
  value: unknown;
  valueType: EvidenceValueType;
  locator: EvidenceLocator;
  quote: string;
  confidence: number;
  support: EvidenceSupport;
  observedAt: string;
  createdAt: string;
  metadata: Record<string, unknown>;
};
