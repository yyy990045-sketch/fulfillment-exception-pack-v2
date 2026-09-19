import { createHash } from "node:crypto";
import {
  createBusinessEntity,
  createEvidence,
  createFulfillmentEvent,
  createSourceDocument,
  createSourceSystem,
  type BusinessEntityType,
  type EvidenceValueType,
} from "../../domain/v2/index.js";
import type { AdaptedSourceRecord, SourceAdapter, SourceRecordEnvelope } from "../core/types.js";

function stableId(prefix: string, value: unknown) {
  return `${prefix}-${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24)}`;
}

function payloadString(envelope: SourceRecordEnvelope, key: string) {
  const value = envelope.payload[key];
  if (typeof value !== "string" || !value.trim()) throw new Error("REFERENCE_ADAPTER_FIELD_REQUIRED");
  return value;
}

export class ReferenceFulfillmentSourceAdapter implements SourceAdapter {
  adapt(envelope: SourceRecordEnvelope): AdaptedSourceRecord {
    const contextId = payloadString(envelope, "contextId");
    const entityType = payloadString(envelope, "entityType") as BusinessEntityType;
    const businessKey = payloadString(envelope, "businessKey");
    const field = payloadString(envelope, "field");
    const value = envelope.payload.value;
    const valueType = payloadString(envelope, "valueType") as EvidenceValueType;
    const sourceSystemId = payloadString(envelope, "sourceSystemId");
    const sourceSystemName = payloadString(envelope, "sourceSystemName");
    const sourceSystem = createSourceSystem({
      id: sourceSystemId,
      tenantId: envelope.tenantId,
      name: sourceSystemName,
      systemType: "file",
      authorityLevel: "contributing",
      status: "active",
      metadata: { connectorId: envelope.connectorId },
    });
    const entityId = stableId("entity", {
      tenantId: envelope.tenantId,
      contextId,
      entityType,
      businessKey,
    });
    const documentId = stableId("document", {
      tenantId: envelope.tenantId,
      sourceSystemId,
      externalRecordId: envelope.externalRecordId,
      sourceVersion: envelope.sourceVersion,
    });
    const eventId = stableId("event", {
      tenantId: envelope.tenantId,
      installationId: envelope.connectorInstallationId,
      externalRecordId: envelope.externalRecordId,
      sourceVersion: envelope.sourceVersion,
      rawHash: envelope.rawHash,
      mappingVersion: envelope.mappingVersion,
    });
    const evidenceId = stableId("evidence", {
      tenantId: envelope.tenantId,
      installationId: envelope.connectorInstallationId,
      externalRecordId: envelope.externalRecordId,
      sourceVersion: envelope.sourceVersion,
      rawHash: envelope.rawHash,
      mappingId: envelope.mappingId,
      mappingVersion: envelope.mappingVersion,
      field,
    });
    const document = createSourceDocument({
      id: documentId,
      tenantId: envelope.tenantId,
      sourceSystemId,
      externalDocumentId: envelope.externalRecordId,
      documentType: envelope.recordType,
      contentHash: envelope.rawHash,
      receivedAt: envelope.observedAt,
      effectiveAt: envelope.occurredAt,
      version: envelope.sourceVersion,
      contextId,
      entityId,
      metadata: {
        connectorId: envelope.connectorId,
        connectorInstallationId: envelope.connectorInstallationId,
        mappingId: envelope.mappingId,
        mappingVersion: envelope.mappingVersion,
      },
    });
    const entity = createBusinessEntity({
      id: entityId,
      tenantId: envelope.tenantId,
      contextId,
      entityType,
      businessKey,
      attributes: { [field]: value },
      createdAt: envelope.observedAt,
      updatedAt: envelope.observedAt,
    });
    const event = createFulfillmentEvent({
      id: eventId,
      tenantId: envelope.tenantId,
      contextId,
      entityId,
      eventType: envelope.recordType,
      occurredAt: envelope.occurredAt,
      recordedAt: envelope.observedAt,
      sourceSystemId,
      sourceDocumentId: documentId,
      payload: envelope.payload,
      idempotencyKey: `${envelope.connectorInstallationId}:${envelope.externalRecordId}:${envelope.sourceVersion}:${envelope.rawHash}:${envelope.mappingVersion}`,
    });
    const evidence = createEvidence({
      id: evidenceId,
      tenantId: envelope.tenantId,
      contextId,
      sourceSystemId,
      sourceDocumentId: documentId,
      sourceVersion: envelope.sourceVersion,
      entityId,
      eventId,
      field,
      value,
      valueType,
      locator: { fileName: envelope.externalRecordId, ...envelope.locator },
      quote: JSON.stringify(envelope.payload),
      confidence: 1,
      support: "supported",
      observedAt: envelope.observedAt,
      createdAt: envelope.observedAt,
      metadata: {
        connectorId: envelope.connectorId,
        connectorInstallationId: envelope.connectorInstallationId,
        externalRecordId: envelope.externalRecordId,
        rawHash: envelope.rawHash,
        mappingId: envelope.mappingId,
        mappingVersion: envelope.mappingVersion,
      },
    });
    return {
      contextId,
      sourceSystems: [sourceSystem],
      sourceDocuments: [document],
      entities: [entity],
      events: [event],
      evidence: [evidence],
    };
  }
}
