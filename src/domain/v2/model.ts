import type {
  BusinessEntity,
  EntityReference,
  FulfillmentContext,
  SourceDocument,
  SourceSystem,
} from "./types.js";

function required(value: string | undefined, code: string) {
  if (!value?.trim()) throw new Error(code);
}

function timestamp(value: string, code: string) {
  required(value, code);
  if (Number.isNaN(Date.parse(value))) throw new Error(code);
}

function tenant(value: string) {
  required(value, "DOMAIN_TENANT_REQUIRED");
}

function metadata(value: Record<string, unknown>) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("DOMAIN_METADATA_REQUIRED");
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
    if (seen.has(key)) throw new Error(`DOMAIN_ENTITY_REFERENCE_CONFLICT:${reference.externalId}`);
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
  return { ...input, metadata: metadata(input.metadata) };
}
