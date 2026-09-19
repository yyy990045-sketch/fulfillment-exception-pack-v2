export type ConnectorDirection = "inbound" | "outbound" | "bidirectional";
export type ConnectorAudience = "internal_operations" | "business_system" | "external_customer";
export type ConnectorInstallationStatus = "active" | "inactive";
export type ConnectorOutboxStatus = "pending" | "in_flight" | "succeeded" | "failed" | "dead_letter";
export type ConnectorAttemptStatus = "succeeded" | "retryable_failure" | "permanent_failure";
export type ConnectorSyncRunStatus = "running" | "succeeded" | "failed" | "blocked";
export type ConnectorSyncErrorClass = "retryable" | "permanent" | "blocked";

export type ConnectorInstallationRecord = {
  tenantId: string;
  id: string;
  connectorId: string;
  connectorVersion: string;
  status: ConnectorInstallationStatus;
  manifestHash: string;
  config: Record<string, unknown>;
  secretRef?: string;
  installedBy: string;
  installedAt: string;
  updatedAt: string;
};

export type ConnectorOutboxRecord = {
  tenantId: string;
  id: string;
  connectorInstallationId: string;
  workItemId: string;
  contextId: string;
  exceptionId: string;
  capability: string;
  operationKey: string;
  payload: Record<string, unknown>;
  status: ConnectorOutboxStatus;
  attemptCount: number;
  availableAt: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  lastErrorCode?: string;
  createdAt: string;
  updatedAt: string;
};

export type ConnectorDeliveryAttemptRecord = {
  tenantId: string;
  id: string;
  outboxId: string;
  attemptNumber: number;
  workerId: string;
  startedAt: string;
  completedAt: string;
  status: ConnectorAttemptStatus;
  httpStatus?: number;
  errorCode?: string;
  responseHash?: string;
};

export type ConnectorReceiptRecord = {
  tenantId: string;
  id: string;
  outboxId: string;
  externalRequestId: string;
  externalResourceId?: string;
  receiptSource: string;
  status: "succeeded" | "failed";
  payloadHash: string;
  createdAt: string;
};

export type ConnectorSyncRunRecord = {
  tenantId: string;
  id: string;
  connectorInstallationId: string;
  connectorId: string;
  recordType: string;
  status: ConnectorSyncRunStatus;
  startedAt: string;
  completedAt: string | null;
  recordsRead: number;
  recordsAccepted: number;
  recordsRejected: number;
  recordsDuplicate: number;
  attemptedCursor: string | null;
  committedCursor: string | null;
  lastErrorCode?: string;
  errorClass?: ConnectorSyncErrorClass;
  retryAfterMs?: number;
  providerRequestId?: string;
  mappingId: string;
  mappingVersion: string;
};

export type ConnectorSyncStateRecord = {
  tenantId: string;
  connectorInstallationId: string;
  recordType: string;
  lastSuccessfulCursor: string | null;
  lastAttemptedCursor: string | null;
  updatedAt: string;
};

export type ConnectorSourceRecordRecord = {
  tenantId: string;
  id: string;
  connectorId: string;
  connectorInstallationId: string;
  recordType: string;
  externalRecordId: string;
  sourceVersion: string;
  rawHash: string;
  locator: Record<string, unknown>;
  observedAt: string;
  mappingId: string;
  mappingVersion: string;
  firstSeenAt: string;
  lastSeenAt: string;
  canonicalRefs: string[];
  evidenceRefs: string[];
};

export type ConnectorMappingVersionRecord = {
  tenantId: string;
  connectorId: string;
  mappingId: string;
  version: string;
  effectiveAt: string;
  definitionHash: string;
  description: string;
  createdAt: string;
};
