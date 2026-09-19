import type {
  ConnectorAudience,
  ConnectorDeliveryAttemptRecord,
  ConnectorDirection,
  ConnectorInstallationRecord,
  ConnectorOutboxRecord,
  ConnectorReceiptRecord,
  BusinessEntity,
  FulfillmentEvent,
  SourceDocument,
  SourceSystem,
  V2Evidence,
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

export type InboundReadPageInput = {
  installation: ConnectorInstallationRecord;
  cursor: string | null;
  pageSize: number;
  secret?: string;
  now?: () => Date;
};

export type InboundRecord = {
  externalRecordId: string;
  recordType: string;
  occurredAt: string;
  observedAt?: string;
  sourceVersion: string;
  locator?: Record<string, unknown>;
  payload: Record<string, unknown>;
};

export type InboundPageRateLimit = {
  retryAfterMs?: number;
};

export type InboundReadPageResult = {
  records: InboundRecord[];
  nextCursor: string | null;
  hasMore: boolean;
  providerRequestId?: string;
  rateLimit?: InboundPageRateLimit;
  observedAt?: string;
};

export type InboundConnector = {
  manifest: ConnectorManifest;
  validateConfig(config: Record<string, unknown>): Record<string, unknown>;
  readPage(input: InboundReadPageInput): Promise<InboundReadPageResult>;
};

export type SourceRecordEnvelope = {
  tenantId: string;
  connectorId: string;
  connectorInstallationId: string;
  externalRecordId: string;
  recordType: string;
  occurredAt: string;
  observedAt: string;
  sourceVersion: string;
  locator: Record<string, unknown>;
  rawHash: string;
  mappingId: string;
  mappingVersion: string;
  payload: Record<string, unknown>;
};

export type AdaptedSourceRecord = {
  contextId: string;
  sourceSystems: SourceSystem[];
  sourceDocuments: SourceDocument[];
  entities: BusinessEntity[];
  events: FulfillmentEvent[];
  evidence: V2Evidence[];
};

export interface SourceAdapter {
  adapt(envelope: SourceRecordEnvelope): AdaptedSourceRecord;
}

export type ConnectorDeliveryView = {
  outbox: ConnectorOutboxRecord;
  attempts: ConnectorDeliveryAttemptRecord[];
  receipt?: ConnectorReceiptRecord;
};

export class ConnectorError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 422,
    public readonly options: {
      retryable?: boolean;
      retryAfterMs?: number;
    } = {},
  ) {
    super(code);
    this.name = "ConnectorError";
  }
}
