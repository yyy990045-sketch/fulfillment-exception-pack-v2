import { createHash } from "node:crypto";
import type {
  BusinessEntityType,
  EvidenceLocator,
  EvidenceValueType,
  SourceSystemType,
} from "../../domain/v2/index.js";
import type { DomainWritePlan, OpenSupOSFact, OpenSupOSUnsEnvelope } from "./types.js";

function hash(input: unknown) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 24);
}

function authority(systemType: SourceSystemType) {
  if (["erp", "mes", "qms", "finance", "wms"].includes(systemType)) return "system_of_record" as const;
  if (systemType === "crm") return "authoritative" as const;
  if (systemType === "manual" || systemType === "file") return "contributing" as const;
  return "reference" as const;
}

function normalizeFact(fact: OpenSupOSFact): { value: OpenSupOSFact["value"]; valueType: EvidenceValueType } {
  if (fact.valueType) return { value: fact.value, valueType: fact.valueType };
  if (typeof fact.value === "number") return { value: fact.value, valueType: "number" };
  if (typeof fact.value === "boolean") return { value: fact.value, valueType: "boolean" };
  if (fact.value === null) return { value: null, valueType: "null" };
  return { value: fact.value, valueType: "string" };
}

export function mapUnsEnvelopeToDomainPlan(envelope: OpenSupOSUnsEnvelope): DomainWritePlan {
  const contextId = `ctx-${hash({ tenant: envelope.tenantKey, businessKey: envelope.context.businessKey })}`;
  const entityId = `entity-${hash({ tenant: envelope.tenantKey, contextId, entityType: envelope.entity.entityType, businessKey: envelope.entity.businessKey })}`;
  const documentId = `doc-${hash({ tenant: envelope.tenantKey, source: envelope.source.systemKey, externalId: envelope.source.externalDocumentId, version: envelope.source.sourceVersion })}`;
  const eventId = `event-${hash({ tenant: envelope.tenantKey, contextId, entityId, messageId: envelope.messageId, eventType: envelope.event.eventType })}`;
  const receivedAt = typeof envelope.metadata.receivedAt === "string" ? envelope.metadata.receivedAt : envelope.event.occurredAt;
  const recordedAt = typeof envelope.metadata.recordedAt === "string" ? envelope.metadata.recordedAt : envelope.event.occurredAt;
  const locator: EvidenceLocator = envelope.lineage.locator ?? { fileName: envelope.source.externalDocumentId };
  const facts = Object.fromEntries(Object.entries(envelope.facts).map(([key, value]) => [key, normalizeFact(value)]));

  return {
    context: {
      id: contextId,
      tenantId: envelope.tenantKey,
      businessKey: envelope.context.businessKey,
      contextType: envelope.context.contextType,
      status: "active",
      openedAt: envelope.event.occurredAt,
      updatedAt: recordedAt,
      metadata: envelope.metadata,
    },
    sourceSystem: {
      id: envelope.source.systemKey,
      tenantId: envelope.tenantKey,
      name: envelope.source.systemKey,
      systemType: envelope.source.systemType,
      authorityLevel: authority(envelope.source.systemType),
      status: "active",
      metadata: {},
    },
    businessEntity: {
      id: entityId,
      tenantId: envelope.tenantKey,
      contextId,
      entityType: envelope.entity.entityType,
      businessKey: envelope.entity.businessKey,
      attributes: {},
      createdAt: envelope.event.occurredAt,
      updatedAt: recordedAt,
    },
    entityReference: {
      id: `ref-${hash({ tenant: envelope.tenantKey, entityId, sourceSystemId: envelope.source.systemKey, externalType: envelope.entity.entityType, externalId: envelope.entity.businessKey })}`,
      tenantId: envelope.tenantKey,
      entityId,
      sourceSystemId: envelope.source.systemKey,
      externalId: envelope.entity.businessKey,
      externalType: envelope.entity.entityType,
      createdAt: envelope.event.occurredAt,
    },
    sourceDocument: {
      id: documentId,
      tenantId: envelope.tenantKey,
      sourceSystemId: envelope.source.systemKey,
      externalDocumentId: envelope.source.externalDocumentId,
      documentType: envelope.source.documentType,
      contentHash: hash({
        tenant: envelope.tenantKey,
        sourceSystemKey: envelope.source.systemKey,
        externalDocumentId: envelope.source.externalDocumentId,
        documentType: envelope.source.documentType,
        sourceVersion: envelope.source.sourceVersion,
      }),
      receivedAt,
      effectiveAt: envelope.event.occurredAt,
      version: envelope.source.sourceVersion,
      contextId,
      entityId,
      fileName: `${envelope.source.externalDocumentId}.json`,
      mimeType: "application/json",
      metadata: {},
    },
    event: {
      id: eventId,
      tenantId: envelope.tenantKey,
      contextId,
      entityId,
      eventType: envelope.event.eventType,
      occurredAt: envelope.event.occurredAt,
      recordedAt,
      sourceSystemId: envelope.source.systemKey,
      sourceDocumentId: documentId,
      payload: Object.fromEntries(Object.entries(facts).map(([key, fact]) => [key, fact.value])),
      idempotencyKey: `uns:${envelope.messageId}`,
    },
    evidence: Object.entries(facts).map(([field, fact]) => ({
      id: `evidence-${hash({ eventId, field, value: fact.value })}`,
      tenantId: envelope.tenantKey,
      contextId,
      sourceSystemId: envelope.source.systemKey,
      sourceDocumentId: documentId,
      sourceVersion: envelope.source.sourceVersion,
      entityId,
      eventId,
      field,
      value: fact.value,
      valueType: fact.valueType,
      locator,
      quote: envelope.lineage.quote ?? `${field}=${String(fact.value)}`,
      confidence: envelope.lineage.confidence ?? 1,
      support: "supported" as const,
      observedAt: envelope.event.occurredAt,
      createdAt: recordedAt,
      metadata: {},
    })),
  };
}
