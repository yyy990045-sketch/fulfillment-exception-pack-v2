export type ConnectorDirection = "inbound" | "outbound" | "bidirectional";
export type ConnectorAudience = "internal_operations" | "business_system" | "external_customer";
export type ConnectorInstallationStatus = "active" | "inactive";
export type ConnectorOutboxStatus = "pending" | "in_flight" | "succeeded" | "failed" | "dead_letter";
export type ConnectorAttemptStatus = "succeeded" | "retryable_failure" | "permanent_failure";

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
