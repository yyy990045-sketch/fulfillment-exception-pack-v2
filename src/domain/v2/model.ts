import type {
  BusinessEntity,
  EntityReference,
  FulfillmentContext,
  FulfillmentEvent,
  SourceDocument,
  SourceSystem,
  V2Evidence,
} from "./types.js";
import { FULFILLMENT_EVENT_TYPES } from "./types.js";

export type DomainErrorCode =
  | "DOMAIN_ID_REQUIRED"
  | "DOMAIN_TENANT_REQUIRED"
  | "DOMAIN_BUSINESS_KEY_REQUIRED"
  | "DOMAIN_OPENED_AT_REQUIRED"
  | "DOMAIN_UPDATED_AT_REQUIRED"
  | "DOMAIN_CREATED_AT_REQUIRED"
  | "DOMAIN_RECEIVED_AT_REQUIRED"
  | "DOMAIN_EFFECTIVE_AT_INVALID"
  | "DOMAIN_CONTEXT_ID_REQUIRED"
  | "DOMAIN_ENTITY_ID_REQUIRED"
  | "DOMAIN_SOURCE_SYSTEM_ID_REQUIRED"
  | "DOMAIN_SOURCE_SYSTEM_NAME_REQUIRED"
  | "DOMAIN_EXTERNAL_ID_REQUIRED"
  | "DOMAIN_EXTERNAL_TYPE_REQUIRED"
  | "DOMAIN_DOCUMENT_TYPE_REQUIRED"
  | "DOMAIN_DOCUMENT_VERSION_REQUIRED"
  | "DOMAIN_CONTENT_HASH_REQUIRED"
  | "DOMAIN_METADATA_REQUIRED"
  | "DOMAIN_EVENT_TYPE_INVALID"
  | "DOMAIN_EVENT_OCCURRED_AT_REQUIRED"
  | "DOMAIN_EVENT_RECORDED_AT_REQUIRED"
  | "DOMAIN_EVENT_IDEMPOTENCY_KEY_REQUIRED"
  | "DOMAIN_EVIDENCE_FIELD_REQUIRED"
  | "DOMAIN_EVIDENCE_VALUE_TYPE_INVALID"
  | "DOMAIN_EVIDENCE_LOCATOR_REQUIRED"
  | "DOMAIN_EVIDENCE_QUOTE_REQUIRED"
  | "DOMAIN_EVIDENCE_CONFIDENCE_INVALID"
  | "DOMAIN_EVIDENCE_SUPPORT_INVALID"
  | "DOMAIN_SOURCE_DOCUMENT_CONFLICT"
  | "DOMAIN_SOURCE_DOCUMENT_IDEMPOTENCY_CONFLICT"
  | "DOMAIN_ENTITY_REFERENCE_CONFLICT"
  | "DOMAIN_EVENT_IDEMPOTENCY_CONFLICT"
  | "DOMAIN_CONTEXT_NOT_FOUND"
  | "DOMAIN_SOURCE_SYSTEM_NOT_FOUND"
  | "DOMAIN_ENTITY_NOT_FOUND"
  | "DOMAIN_SOURCE_DOCUMENT_NOT_FOUND"
  | "DOMAIN_EVENT_NOT_FOUND"
  | "DOMAIN_EXCEPTION_NOT_FOUND"
  | "DOMAIN_CONTEXT_ENTITY_TENANT_MISMATCH"
  | "DOMAIN_CONTEXT_ENTITY_CONTEXT_MISMATCH"
  | "DOMAIN_ENTITY_DOCUMENT_TENANT_MISMATCH"
  | "DOMAIN_ENTITY_DOCUMENT_ENTITY_MISMATCH"
  | "DOMAIN_ENTITY_REFERENCE_SOURCE_TENANT_MISMATCH"
  | "DOMAIN_ENTITY_REFERENCE_SOURCE_MISMATCH"
  | "DOMAIN_EVIDENCE_DOCUMENT_TENANT_MISMATCH"
  | "DOMAIN_EVIDENCE_DOCUMENT_SOURCE_MISMATCH"
  | "DOMAIN_EVIDENCE_DOCUMENT_CONTEXT_MISMATCH"
  | "DOMAIN_EVIDENCE_DOCUMENT_VERSION_MISMATCH"
  | "DOMAIN_EVIDENCE_ENTITY_TENANT_MISMATCH"
  | "DOMAIN_EVIDENCE_ENTITY_CONTEXT_MISMATCH"
  | "DOMAIN_EVIDENCE_EVENT_TENANT_MISMATCH"
  | "DOMAIN_EVIDENCE_EVENT_CONTEXT_MISMATCH"
  | "DOMAIN_EVIDENCE_EVENT_ENTITY_MISMATCH"
  | "DOMAIN_EVIDENCE_EVENT_DOCUMENT_MISMATCH"
  | "DOMAIN_EVIDENCE_EVENT_SOURCE_SYSTEM_MISMATCH"
  | "DOMAIN_EVENT_DOCUMENT_TENANT_MISMATCH"
  | "DOMAIN_EVENT_DOCUMENT_SOURCE_MISMATCH"
  | "DOMAIN_EVENT_DOCUMENT_CONTEXT_MISMATCH"
  | "DOMAIN_RULE_VERSION_IMMUTABILITY_CONFLICT"
  | "DOMAIN_RULE_VERSION_CONTENT_HASH_MISMATCH"
  | "DOMAIN_RULE_TENANT_MISMATCH"
  | "DOMAIN_RULE_VERSION_NOT_ACTIVE";

export class DomainError extends Error {
  constructor(public readonly code: DomainErrorCode, detail?: string) {
    super(detail ? `${code}:${detail}` : code);
    this.name = "DomainError";
  }
}

function required(value: string | undefined, code: string) {
  if (!value?.trim()) throw new DomainError(code as DomainErrorCode);
}

function timestamp(value: string, code: string) {
  required(value, code);
  if (Number.isNaN(Date.parse(value))) throw new DomainError(code as DomainErrorCode);
}

function tenant(value: string) {
  required(value, "DOMAIN_TENANT_REQUIRED");
}

function metadata(value: Record<string, unknown>) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DomainError("DOMAIN_METADATA_REQUIRED");
  return { ...value };
}

export function createFulfillmentContext(input: FulfillmentContext): FulfillmentContext {
  required(input.id, "DOMAIN_ID_REQUIRED");
  tenant(input.tenantId);
  required(input.businessKey, "DOMAIN_BUSINESS_KEY_REQUIRED");
  timestamp(input.openedAt, "DOMAIN_OPENED_AT_REQUIRED");
  timestamp(input.updatedAt, "DOMAIN_UPDATED_AT_REQUIRED");
  return { ...input, metadata: metadata(input.metadata) };
}

export function createBusinessEntity(input: BusinessEntity): BusinessEntity {
  required(input.id, "DOMAIN_ID_REQUIRED");
  tenant(input.tenantId);
  required(input.contextId, "DOMAIN_CONTEXT_ID_REQUIRED");
  required(input.businessKey, "DOMAIN_BUSINESS_KEY_REQUIRED");
  timestamp(input.createdAt, "DOMAIN_CREATED_AT_REQUIRED");
  timestamp(input.updatedAt, "DOMAIN_UPDATED_AT_REQUIRED");
  return { ...input, attributes: metadata(input.attributes) };
}

export function createEntityReference(input: EntityReference): EntityReference {
  required(input.id, "DOMAIN_ID_REQUIRED");
  tenant(input.tenantId);
  required(input.entityId, "DOMAIN_ENTITY_ID_REQUIRED");
  required(input.sourceSystemId, "DOMAIN_SOURCE_SYSTEM_ID_REQUIRED");
  required(input.externalId, "DOMAIN_EXTERNAL_ID_REQUIRED");
  required(input.externalType, "DOMAIN_EXTERNAL_TYPE_REQUIRED");
  timestamp(input.createdAt, "DOMAIN_CREATED_AT_REQUIRED");
  return { ...input };
}

export function entityReferenceExternalKey(input: Pick<EntityReference, "tenantId" | "sourceSystemId" | "externalType" | "externalId">) {
  return [input.tenantId, input.sourceSystemId, input.externalType, input.externalId].join("\u0000");
}

export function assertUniqueEntityReferences(references: EntityReference[]) {
  const seen = new Set<string>();
  for (const reference of references) {
    const key = entityReferenceExternalKey(reference);
    if (seen.has(key)) throw new DomainError("DOMAIN_ENTITY_REFERENCE_CONFLICT", reference.externalId);
    seen.add(key);
  }
}

export function createSourceSystem(input: SourceSystem): SourceSystem {
  required(input.id, "DOMAIN_ID_REQUIRED");
  tenant(input.tenantId);
  required(input.name, "DOMAIN_SOURCE_SYSTEM_NAME_REQUIRED");
  return { ...input, metadata: metadata(input.metadata) };
}

export function createSourceDocument(input: SourceDocument): SourceDocument {
  required(input.id, "DOMAIN_ID_REQUIRED");
  tenant(input.tenantId);
  required(input.sourceSystemId, "DOMAIN_SOURCE_SYSTEM_ID_REQUIRED");
  required(input.externalDocumentId, "DOMAIN_EXTERNAL_ID_REQUIRED");
  required(input.documentType, "DOMAIN_DOCUMENT_TYPE_REQUIRED");
  required(input.contentHash, "DOMAIN_CONTENT_HASH_REQUIRED");
  timestamp(input.receivedAt, "DOMAIN_RECEIVED_AT_REQUIRED");
  required(input.version, "DOMAIN_DOCUMENT_VERSION_REQUIRED");
  if (input.effectiveAt !== null && Number.isNaN(Date.parse(input.effectiveAt))) throw new DomainError("DOMAIN_EFFECTIVE_AT_INVALID");
  return { ...input, metadata: metadata(input.metadata) };
}

export function sourceDocumentIdentityKey(input: Pick<SourceDocument, "tenantId" | "sourceSystemId" | "externalDocumentId" | "version">) {
  return [input.tenantId, input.sourceSystemId, input.externalDocumentId, input.version].join("\u0000");
}

export function assertUniqueSourceDocuments(documents: SourceDocument[]) {
  const seen = new Set<string>();
  for (const document of documents) {
    const key = sourceDocumentIdentityKey(document);
    if (seen.has(key)) throw new DomainError("DOMAIN_SOURCE_DOCUMENT_CONFLICT", document.externalDocumentId);
    seen.add(key);
  }
}

export function createFulfillmentEvent(input: FulfillmentEvent): FulfillmentEvent {
  required(input.id, "DOMAIN_ID_REQUIRED");
  tenant(input.tenantId);
  required(input.contextId, "DOMAIN_CONTEXT_ID_REQUIRED");
  required(input.entityId, "DOMAIN_ENTITY_ID_REQUIRED");
  required(input.sourceSystemId, "DOMAIN_SOURCE_SYSTEM_ID_REQUIRED");
  if (!FULFILLMENT_EVENT_TYPES.includes(input.eventType)) throw new DomainError("DOMAIN_EVENT_TYPE_INVALID");
  timestamp(input.occurredAt, "DOMAIN_EVENT_OCCURRED_AT_REQUIRED");
  timestamp(input.recordedAt, "DOMAIN_EVENT_RECORDED_AT_REQUIRED");
  required(input.idempotencyKey, "DOMAIN_EVENT_IDEMPOTENCY_KEY_REQUIRED");
  return { ...input, payload: metadata(input.payload) };
}

export function eventIdempotencyKey(input: Pick<FulfillmentEvent, "tenantId" | "sourceSystemId" | "idempotencyKey">) {
  return [input.tenantId, input.sourceSystemId, input.idempotencyKey].join("\u0000");
}

export function assertUniqueEvents(events: FulfillmentEvent[]) {
  const seen = new Set<string>();
  for (const event of events) {
    const key = eventIdempotencyKey(event);
    if (seen.has(key)) throw new DomainError("DOMAIN_EVENT_IDEMPOTENCY_CONFLICT", event.idempotencyKey);
    seen.add(key);
  }
}

function evidenceValueType(value: V2Evidence["valueType"]) {
  return ["string", "number", "boolean", "date", "datetime", "currency", "json", "null"].includes(value);
}

function evidenceSupport(value: V2Evidence["support"]) {
  return ["supported", "partial", "unsupported"].includes(value);
}

export function createEvidence(input: V2Evidence): V2Evidence {
  required(input.id, "DOMAIN_ID_REQUIRED");
  tenant(input.tenantId);
  required(input.contextId, "DOMAIN_CONTEXT_ID_REQUIRED");
  required(input.sourceSystemId, "DOMAIN_SOURCE_SYSTEM_ID_REQUIRED");
  required(input.sourceDocumentId, "DOMAIN_EXTERNAL_ID_REQUIRED");
  required(input.sourceVersion, "DOMAIN_DOCUMENT_VERSION_REQUIRED");
  required(input.field, "DOMAIN_EVIDENCE_FIELD_REQUIRED");
  if (!evidenceValueType(input.valueType)) throw new DomainError("DOMAIN_EVIDENCE_VALUE_TYPE_INVALID");
  if (!input.locator || typeof input.locator !== "object" || !input.locator.fileName?.trim()) throw new DomainError("DOMAIN_EVIDENCE_LOCATOR_REQUIRED");
  required(input.quote, "DOMAIN_EVIDENCE_QUOTE_REQUIRED");
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) throw new DomainError("DOMAIN_EVIDENCE_CONFIDENCE_INVALID");
  if (!evidenceSupport(input.support)) throw new DomainError("DOMAIN_EVIDENCE_SUPPORT_INVALID");
  timestamp(input.observedAt, "DOMAIN_EVENT_OCCURRED_AT_REQUIRED");
  timestamp(input.createdAt, "DOMAIN_CREATED_AT_REQUIRED");
  return { ...input, locator: { ...input.locator }, metadata: metadata(input.metadata) };
}

export function assertContextEntityRelation(context: FulfillmentContext, entity: BusinessEntity) {
  if (context.tenantId !== entity.tenantId) throw new DomainError("DOMAIN_CONTEXT_ENTITY_TENANT_MISMATCH", entity.id);
  if (context.id !== entity.contextId) throw new DomainError("DOMAIN_CONTEXT_ENTITY_CONTEXT_MISMATCH", entity.id);
}

export function assertEntityDocumentRelation(entity: BusinessEntity, document: SourceDocument) {
  if (entity.tenantId !== document.tenantId) throw new DomainError("DOMAIN_ENTITY_DOCUMENT_TENANT_MISMATCH", document.id);
  if (document.entityId !== entity.id) throw new DomainError("DOMAIN_ENTITY_DOCUMENT_ENTITY_MISMATCH", document.id);
}

export function assertEntityReferenceSourceRelation(reference: EntityReference, sourceSystem: SourceSystem) {
  if (reference.tenantId !== sourceSystem.tenantId) throw new DomainError("DOMAIN_ENTITY_REFERENCE_SOURCE_TENANT_MISMATCH", reference.id);
  if (reference.sourceSystemId !== sourceSystem.id) throw new DomainError("DOMAIN_ENTITY_REFERENCE_SOURCE_MISMATCH", reference.id);
}

export function assertEvidenceDocumentRelation(evidence: V2Evidence, document: SourceDocument) {
  if (evidence.tenantId !== document.tenantId) throw new DomainError("DOMAIN_EVIDENCE_DOCUMENT_TENANT_MISMATCH", evidence.id);
  if (evidence.sourceDocumentId !== document.id || evidence.sourceSystemId !== document.sourceSystemId) throw new DomainError("DOMAIN_EVIDENCE_DOCUMENT_SOURCE_MISMATCH", evidence.id);
  if (document.contextId && evidence.contextId !== document.contextId) throw new DomainError("DOMAIN_EVIDENCE_DOCUMENT_CONTEXT_MISMATCH", evidence.id);
  if (evidence.sourceVersion !== document.version) throw new DomainError("DOMAIN_EVIDENCE_DOCUMENT_VERSION_MISMATCH", evidence.id);
}

export function assertEvidenceEntityRelation(evidence: V2Evidence, entity: BusinessEntity) {
  if (evidence.tenantId !== entity.tenantId) throw new DomainError("DOMAIN_EVIDENCE_ENTITY_TENANT_MISMATCH", evidence.id);
  if (evidence.entityId !== entity.id) throw new DomainError("DOMAIN_EVIDENCE_ENTITY_CONTEXT_MISMATCH", evidence.id);
  if (evidence.contextId !== entity.contextId) throw new DomainError("DOMAIN_EVIDENCE_ENTITY_CONTEXT_MISMATCH", evidence.id);
}

export function assertEvidenceEventRelation(evidence: V2Evidence, event: FulfillmentEvent) {
  if (evidence.tenantId !== event.tenantId) throw new DomainError("DOMAIN_EVIDENCE_EVENT_TENANT_MISMATCH", evidence.id);
  if (evidence.eventId !== event.id) throw new DomainError("DOMAIN_EVIDENCE_EVENT_CONTEXT_MISMATCH", evidence.id);
  if (evidence.contextId !== event.contextId) throw new DomainError("DOMAIN_EVIDENCE_EVENT_CONTEXT_MISMATCH", evidence.id);
  if (evidence.entityId && evidence.entityId !== event.entityId) throw new DomainError("DOMAIN_EVIDENCE_EVENT_ENTITY_MISMATCH", evidence.id);
  if (event.sourceDocumentId && evidence.sourceDocumentId !== event.sourceDocumentId) throw new DomainError("DOMAIN_EVIDENCE_EVENT_DOCUMENT_MISMATCH", evidence.id);
  if (evidence.sourceSystemId !== event.sourceSystemId) throw new DomainError("DOMAIN_EVIDENCE_EVENT_SOURCE_SYSTEM_MISMATCH", evidence.id);
}

export function assertEventDocumentRelation(event: FulfillmentEvent, document: SourceDocument) {
  if (event.tenantId !== document.tenantId) throw new DomainError("DOMAIN_EVENT_DOCUMENT_TENANT_MISMATCH", event.id);
  if (event.sourceDocumentId !== document.id || event.sourceSystemId !== document.sourceSystemId) throw new DomainError("DOMAIN_EVENT_DOCUMENT_SOURCE_MISMATCH", event.id);
  if (document.contextId && event.contextId !== document.contextId) throw new DomainError("DOMAIN_EVENT_DOCUMENT_CONTEXT_MISMATCH", event.id);
}
