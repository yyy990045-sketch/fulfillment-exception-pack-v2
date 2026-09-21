import type {
  BusinessEntity,
  BusinessEntityType,
  EvidenceLocator,
  EvidenceValueType,
  FulfillmentContext,
  FulfillmentEvent,
  SourceDocument,
  SourceSystem,
  SourceSystemType,
  V2Evidence,
} from "../../domain/v2/index.js";

export type OpenSupOSFact = {
  value: string | number | boolean | null | Record<string, unknown>;
  valueType?: EvidenceValueType;
};

export type OpenSupOSUnsEnvelope = {
  schemaVersion: "1.0";
  messageId: string;
  tenantKey: string;
  context: {
    businessKey: string;
    contextType: "sales_order" | "project" | "contract";
  };
  source: {
    systemKey: string;
    systemType: SourceSystemType;
    externalDocumentId: string;
    documentType: string;
    sourceVersion: string;
  };
  entity: {
    entityType: BusinessEntityType;
    businessKey: string;
  };
  event: {
    eventType: FulfillmentEvent["eventType"];
    occurredAt: string;
  };
  facts: Record<string, OpenSupOSFact>;
  lineage: {
    locator?: EvidenceLocator;
    quote?: string;
    confidence?: number;
  };
  metadata: Record<string, unknown>;
};

export type DomainWritePlan = {
  context: FulfillmentContext;
  sourceSystem: SourceSystem;
  businessEntity: BusinessEntity;
  entityReference: import("../../domain/v2/index.js").EntityReference;
  sourceDocument: SourceDocument;
  event: FulfillmentEvent;
  evidence: V2Evidence[];
};

export type OpenSupOSInboundResult = {
  messageId: string;
  contextId: string;
  entityId: string;
  eventId: string;
  evidenceIds: string[];
  duplicated: boolean;
};

export type OpenSupOSTopicParts = {
  /** legacy 6 段式子；industrial 11 段式子由 `ParsedIndustrialUnsTopic` 表达 */
  form: "legacy";
  tenantKey: string;
  contextBusinessKey: string;
  entityType: BusinessEntityType;
  entityBusinessKey: string;
  eventType: FulfillmentEvent["eventType"];
};

export class OpenSupOSIntegrationError extends Error {
  constructor(public readonly code: string, detail?: string) {
    super(detail ? `${code}:${detail}` : code);
    this.name = "OpenSupOSIntegrationError";
  }
}
