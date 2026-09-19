import type {
  ConnectorAudience,
  ConnectorDeliveryAttemptRecord,
  ConnectorDirection,
  ConnectorInstallationRecord,
  ConnectorOutboxRecord,
  ConnectorReceiptRecord,
} from "../../domain/v2/index.js";

export const CORE_CONNECTOR_API_VERSION = "1";

export type ConnectorManifest = {
  id: string;
  version: string;
  name: string;
  description: string;
  direction: ConnectorDirection;
  capabilities: string[];
  audience: ConnectorAudience;
  effects: {
    customerFacing: boolean;
    financialMovement: boolean;
    legalEffect: boolean;
  };
  compatibility: { coreApiVersion: string };
};

export type ConnectorDeliveryResult = {
  status: "succeeded" | "retryable_failure" | "permanent_failure";
  httpStatus?: number;
  errorCode?: string;
  externalRequestId?: string;
  externalResourceId?: string;
  responseHash?: string;
};

export type ConnectorDeliveryInput = {
  installation: ConnectorInstallationRecord;
  outbox: ConnectorOutboxRecord;
  secret?: string;
  now?: () => Date;
};

export interface OutboundConnector {
  manifest: ConnectorManifest;
  validateConfig(config: Record<string, unknown>): Record<string, unknown>;
  deliver(input: ConnectorDeliveryInput): Promise<ConnectorDeliveryResult>;
}

export type InboundConnector = {
  manifest: ConnectorManifest;
};

export type SourceRecordEnvelope = {
  connectorId: string;
  externalRecordId: string;
  recordType: string;
  occurredAt: string;
  sourceVersion: string;
  payload: Record<string, unknown>;
};

export interface SourceAdapter {
  adapt(envelope: SourceRecordEnvelope): Array<Record<string, unknown>>;
}

export type ConnectorDeliveryView = {
  outbox: ConnectorOutboxRecord;
  attempts: ConnectorDeliveryAttemptRecord[];
  receipt?: ConnectorReceiptRecord;
};

export class ConnectorError extends Error {
  constructor(public readonly code: string, public readonly status = 422) {
    super(code);
    this.name = "ConnectorError";
  }
}
