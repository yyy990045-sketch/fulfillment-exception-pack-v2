export type FulfillmentContextType = "sales_order" | "project" | "contract";

export type FulfillmentContextStatus = "open" | "active" | "on_hold" | "closed" | "cancelled";

export type BusinessEntityType =
  | "quote"
  | "contract"
  | "sales_order"
  | "production_order"
  | "quality_event"
  | "shipment"
  | "receivable"
  | "payment"
  | "complaint";

export type SourceSystemType = "erp" | "mes" | "qms" | "wms" | "crm" | "finance" | "manual" | "file" | "demo";

export type SourceSystemAuthorityLevel = "system_of_record" | "authoritative" | "contributing" | "reference";

export type SourceSystemStatus = "active" | "inactive";

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
  contextId?: string;
  entityId?: string;
  fileName?: string;
  mimeType?: string;
  metadata: Record<string, unknown>;
};
