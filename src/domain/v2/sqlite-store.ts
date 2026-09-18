import type {
  BusinessEntity,
  EntityReference,
  FulfillmentContext,
  FulfillmentEvent,
  SourceDocument,
  SourceSystem,
  V2Evidence,
} from "./types.js";
import {
  assertContextEntityRelation,
  assertEntityDocumentRelation,
  assertEntityReferenceSourceRelation,
  assertEventDocumentRelation,
  assertEvidenceDocumentRelation,
  assertEvidenceEntityRelation,
  assertEvidenceEventRelation,
  createBusinessEntity,
  createEntityReference,
  createEvidence,
  createFulfillmentContext,
  createFulfillmentEvent,
  createSourceDocument,
  createSourceSystem,
  DomainError,
} from "./model.js";
import { runV2Migrations, type SqliteDatabaseLike } from "./sqlite-migrations.js";

type JsonRecord = Record<string, unknown>;

function json(value: unknown) {
  return JSON.stringify(value);
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function optional<T>(value: T | null | undefined): T | undefined {
  return value == null ? undefined : value;
}

export class V2SqliteStore {
  constructor(private readonly db: SqliteDatabaseLike) {
    runV2Migrations(db);
  }

  saveContext(input: FulfillmentContext): FulfillmentContext {
    const context = createFulfillmentContext(input);
    this.db.prepare(`
      INSERT INTO fulfillment_contexts
        (tenant_id, id, business_key, context_type, status, opened_at, updated_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, id) DO UPDATE SET
        business_key = excluded.business_key,
        context_type = excluded.context_type,
        status = excluded.status,
        opened_at = excluded.opened_at,
        updated_at = excluded.updated_at,
        metadata_json = excluded.metadata_json
    `).run(context.tenantId, context.id, context.businessKey, context.contextType, context.status, context.openedAt, context.updatedAt, json(context.metadata));
    return context;
  }

  saveSourceSystem(input: SourceSystem): SourceSystem {
    const sourceSystem = createSourceSystem(input);
    this.db.prepare(`
      INSERT INTO source_systems
        (tenant_id, id, name, system_type, authority_level, status, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, id) DO UPDATE SET
        name = excluded.name,
        system_type = excluded.system_type,
        authority_level = excluded.authority_level,
        status = excluded.status,
        metadata_json = excluded.metadata_json
    `).run(sourceSystem.tenantId, sourceSystem.id, sourceSystem.name, sourceSystem.systemType, sourceSystem.authorityLevel, sourceSystem.status, json(sourceSystem.metadata));
    return sourceSystem;
  }

  saveBusinessEntity(input: BusinessEntity): BusinessEntity {
    const entity = createBusinessEntity(input);
    const context = this.getContext(entity.tenantId, entity.contextId);
    if (!context) throw new DomainError("DOMAIN_CONTEXT_NOT_FOUND", entity.contextId);
    assertContextEntityRelation(context, entity);
    this.db.prepare(`
      INSERT INTO business_entities
        (tenant_id, id, context_id, entity_type, business_key, attributes_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, id) DO UPDATE SET
        context_id = excluded.context_id,
        entity_type = excluded.entity_type,
        business_key = excluded.business_key,
        attributes_json = excluded.attributes_json,
        updated_at = excluded.updated_at
    `).run(entity.tenantId, entity.id, entity.contextId, entity.entityType, entity.businessKey, json(entity.attributes), entity.createdAt, entity.updatedAt);
    return entity;
  }

  saveSourceDocument(input: SourceDocument): SourceDocument {
    const document = createSourceDocument(input);
    const existing = this.getSourceDocumentByIdentity(document.tenantId, document.sourceSystemId, document.externalDocumentId, document.version);
    if (existing) {
      if (existing.contentHash !== document.contentHash || existing.documentType !== document.documentType) {
        throw new DomainError("DOMAIN_SOURCE_DOCUMENT_IDEMPOTENCY_CONFLICT", document.id);
      }
      return existing;
    }
    const sourceSystem = this.getSourceSystem(document.tenantId, document.sourceSystemId);
    if (!sourceSystem) throw new DomainError("DOMAIN_SOURCE_SYSTEM_NOT_FOUND", document.sourceSystemId);
    if (document.contextId) {
      const context = this.getContext(document.tenantId, document.contextId);
      if (!context) throw new DomainError("DOMAIN_CONTEXT_NOT_FOUND", document.contextId);
    }
    if (document.entityId) {
      const entity = this.getBusinessEntity(document.tenantId, document.entityId);
      if (!entity) throw new DomainError("DOMAIN_ENTITY_NOT_FOUND", document.entityId);
      assertEntityDocumentRelation(entity, document);
      if (document.contextId) {
        const context = this.getContext(document.tenantId, document.contextId);
        if (!context) throw new DomainError("DOMAIN_CONTEXT_NOT_FOUND", document.contextId);
        assertContextEntityRelation(context, entity);
      }
    }
    this.db.prepare(`
      INSERT OR IGNORE INTO source_documents
        (tenant_id, id, source_system_id, external_document_id, document_type, content_hash, received_at, effective_at, version, context_id, entity_id, file_name, mime_type, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      document.tenantId,
      document.id,
      document.sourceSystemId,
      document.externalDocumentId,
      document.documentType,
      document.contentHash,
      document.receivedAt,
      document.effectiveAt,
      document.version,
      document.contextId ?? null,
      document.entityId ?? null,
      document.fileName ?? null,
      document.mimeType ?? null,
      json(document.metadata),
    );
    return this.getSourceDocumentByIdentity(document.tenantId, document.sourceSystemId, document.externalDocumentId, document.version) ?? document;
  }

  saveEntityReference(input: EntityReference): EntityReference {
    const reference = createEntityReference(input);
    const entity = this.getBusinessEntity(reference.tenantId, reference.entityId);
    if (!entity) throw new DomainError("DOMAIN_ENTITY_NOT_FOUND", reference.entityId);
    const sourceSystem = this.getSourceSystem(reference.tenantId, reference.sourceSystemId);
    if (!sourceSystem) throw new DomainError("DOMAIN_SOURCE_SYSTEM_NOT_FOUND", reference.sourceSystemId);
    assertEntityReferenceSourceRelation(reference, sourceSystem);
    this.db.prepare(`
      INSERT INTO entity_references
        (tenant_id, id, entity_id, source_system_id, external_id, external_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, source_system_id, external_type, external_id) DO NOTHING
    `).run(reference.tenantId, reference.id, reference.entityId, reference.sourceSystemId, reference.externalId, reference.externalType, reference.createdAt);
    const row = this.db.prepare(`
      SELECT tenant_id as tenantId, id, entity_id as entityId, source_system_id as sourceSystemId,
             external_id as externalId, external_type as externalType, created_at as createdAt
      FROM entity_references
      WHERE tenant_id = ? AND source_system_id = ? AND external_type = ? AND external_id = ?
    `).get(reference.tenantId, reference.sourceSystemId, reference.externalType, reference.externalId) as EntityReference;
    return row;
  }

  appendEvent(input: FulfillmentEvent): FulfillmentEvent {
    const event = createFulfillmentEvent(input);
    const existing = this.getEventByIdempotency(event.tenantId, event.sourceSystemId, event.idempotencyKey);
    if (existing) {
      const unchanged =
        existing.eventType === event.eventType &&
        existing.entityId === event.entityId &&
        existing.contextId === event.contextId &&
        existing.occurredAt === event.occurredAt &&
        existing.sourceDocumentId === event.sourceDocumentId &&
        stableJson(existing.payload) === stableJson(event.payload);
      if (!unchanged) throw new DomainError("DOMAIN_EVENT_IDEMPOTENCY_CONFLICT", event.idempotencyKey);
      return existing;
    }
    const context = this.getContext(event.tenantId, event.contextId);
    if (!context) throw new DomainError("DOMAIN_CONTEXT_NOT_FOUND", event.contextId);
    const entity = this.getBusinessEntity(event.tenantId, event.entityId);
    if (!entity) throw new DomainError("DOMAIN_ENTITY_NOT_FOUND", event.entityId);
    assertContextEntityRelation(context, entity);
    const sourceSystem = this.getSourceSystem(event.tenantId, event.sourceSystemId);
    if (!sourceSystem) throw new DomainError("DOMAIN_SOURCE_SYSTEM_NOT_FOUND", event.sourceSystemId);
    if (event.sourceDocumentId) {
      const document = this.getSourceDocument(event.tenantId, event.sourceDocumentId);
      if (!document) throw new DomainError("DOMAIN_SOURCE_DOCUMENT_NOT_FOUND", event.sourceDocumentId);
      assertEventDocumentRelation(event, document);
    }
    this.db.prepare(`
      INSERT OR IGNORE INTO fulfillment_events
        (tenant_id, id, context_id, entity_id, event_type, occurred_at, recorded_at, source_system_id, source_document_id, payload_json, idempotency_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.tenantId,
      event.id,
      event.contextId,
      event.entityId,
      event.eventType,
      event.occurredAt,
      event.recordedAt,
      event.sourceSystemId,
      event.sourceDocumentId ?? null,
      json(event.payload),
      event.idempotencyKey,
    );
    return this.getEventByIdempotency(event.tenantId, event.sourceSystemId, event.idempotencyKey) ?? event;
  }

  saveEvidence(input: V2Evidence): V2Evidence {
    const evidence = createEvidence(input);
    const document = this.getSourceDocument(evidence.tenantId, evidence.sourceDocumentId);
    if (!document) throw new DomainError("DOMAIN_SOURCE_DOCUMENT_NOT_FOUND", evidence.sourceDocumentId);
    assertEvidenceDocumentRelation(evidence, document);
    if (evidence.entityId) {
      const entity = this.getBusinessEntity(evidence.tenantId, evidence.entityId);
      if (!entity) throw new DomainError("DOMAIN_ENTITY_NOT_FOUND", evidence.entityId);
      assertEvidenceEntityRelation(evidence, entity);
    }
    if (evidence.eventId) {
      const event = this.getEvent(evidence.tenantId, evidence.eventId);
      if (!event) throw new DomainError("DOMAIN_EVENT_NOT_FOUND", evidence.eventId);
      assertEvidenceEventRelation(evidence, event);
    }
    this.db.prepare(`
      INSERT OR IGNORE INTO v2_evidence
        (tenant_id, id, context_id, source_system_id, source_document_id, source_version, entity_id, event_id,
         field, value_json, value_type, locator_json, quote, confidence, support, observed_at, created_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      evidence.tenantId,
      evidence.id,
      evidence.contextId,
      evidence.sourceSystemId,
      evidence.sourceDocumentId,
      evidence.sourceVersion,
      evidence.entityId ?? null,
      evidence.eventId ?? null,
      evidence.field,
      json(evidence.value),
      evidence.valueType,
      json(evidence.locator),
      evidence.quote,
      evidence.confidence,
      evidence.support,
      evidence.observedAt,
      evidence.createdAt,
      json(evidence.metadata),
    );
    return this.getEvidence(evidence.tenantId, evidence.id) ?? evidence;
  }

  getContext(tenantId: string, contextId: string): FulfillmentContext | undefined {
    const row = this.db.prepare(`
      SELECT tenant_id as tenantId, id, business_key as businessKey, context_type as contextType,
             status, opened_at as openedAt, updated_at as updatedAt, metadata_json as metadataJson
      FROM fulfillment_contexts WHERE tenant_id = ? AND id = ?
    `).get(tenantId, contextId) as (Omit<FulfillmentContext, "metadata"> & { metadataJson: string }) | undefined;
    return row ? {
      tenantId: row.tenantId,
      id: row.id,
      businessKey: row.businessKey,
      contextType: row.contextType,
      status: row.status,
      openedAt: row.openedAt,
      updatedAt: row.updatedAt,
      metadata: parseJson<JsonRecord>(row.metadataJson),
    } : undefined;
  }

  getSourceSystem(tenantId: string, sourceSystemId: string): SourceSystem | undefined {
    const row = this.db.prepare(`
      SELECT tenant_id as tenantId, id, name, system_type as systemType,
             authority_level as authorityLevel, status, metadata_json as metadataJson
      FROM source_systems WHERE tenant_id = ? AND id = ?
    `).get(tenantId, sourceSystemId) as (Omit<SourceSystem, "metadata"> & { metadataJson: string }) | undefined;
    return row ? {
      tenantId: row.tenantId,
      id: row.id,
      name: row.name,
      systemType: row.systemType,
      authorityLevel: row.authorityLevel,
      status: row.status,
      metadata: parseJson<JsonRecord>(row.metadataJson),
    } : undefined;
  }

  getBusinessEntity(tenantId: string, entityId: string): BusinessEntity | undefined {
    const row = this.db.prepare(`
      SELECT tenant_id as tenantId, id, context_id as contextId, entity_type as entityType,
             business_key as businessKey, attributes_json as attributesJson,
             created_at as createdAt, updated_at as updatedAt
      FROM business_entities WHERE tenant_id = ? AND id = ?
    `).get(tenantId, entityId) as (Omit<BusinessEntity, "attributes"> & { attributesJson: string }) | undefined;
    return row ? {
      tenantId: row.tenantId,
      id: row.id,
      contextId: row.contextId,
      entityType: row.entityType,
      businessKey: row.businessKey,
      attributes: parseJson<JsonRecord>(row.attributesJson),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    } : undefined;
  }

  getSourceDocument(tenantId: string, documentId: string): SourceDocument | undefined {
    const row = this.db.prepare(`
      SELECT tenant_id as tenantId, id, source_system_id as sourceSystemId,
             external_document_id as externalDocumentId, document_type as documentType,
             content_hash as contentHash, received_at as receivedAt, effective_at as effectiveAt,
             version, context_id as contextId, entity_id as entityId, file_name as fileName,
             mime_type as mimeType, metadata_json as metadataJson
      FROM source_documents WHERE tenant_id = ? AND id = ?
    `).get(tenantId, documentId) as (Omit<SourceDocument, "metadata"> & { metadataJson: string }) | undefined;
    if (!row) return undefined;
    return {
      tenantId: row.tenantId,
      id: row.id,
      sourceSystemId: row.sourceSystemId,
      externalDocumentId: row.externalDocumentId,
      documentType: row.documentType,
      contentHash: row.contentHash,
      receivedAt: row.receivedAt,
      effectiveAt: row.effectiveAt,
      version: row.version,
      ...(row.contextId ? { contextId: row.contextId } : {}),
      ...(row.entityId ? { entityId: row.entityId } : {}),
      ...(optional(row.fileName) ? { fileName: row.fileName } : {}),
      ...(optional(row.mimeType) ? { mimeType: row.mimeType } : {}),
      metadata: parseJson<JsonRecord>(row.metadataJson),
    };
  }

  getEvent(tenantId: string, eventId: string): FulfillmentEvent | undefined {
    const row = this.db.prepare(`
      SELECT tenant_id as tenantId, id, context_id as contextId, entity_id as entityId,
             event_type as eventType, occurred_at as occurredAt, recorded_at as recordedAt,
             source_system_id as sourceSystemId, source_document_id as sourceDocumentId,
             payload_json as payloadJson, idempotency_key as idempotencyKey
      FROM fulfillment_events WHERE tenant_id = ? AND id = ?
    `).get(tenantId, eventId) as (Omit<FulfillmentEvent, "payload" | "sourceDocumentId"> & { sourceDocumentId: string | null; payloadJson: string }) | undefined;
    if (!row) return undefined;
    return {
      tenantId: row.tenantId,
      id: row.id,
      contextId: row.contextId,
      entityId: row.entityId,
      eventType: row.eventType,
      occurredAt: row.occurredAt,
      recordedAt: row.recordedAt,
      sourceSystemId: row.sourceSystemId,
      ...(row.sourceDocumentId ? { sourceDocumentId: row.sourceDocumentId } : {}),
      payload: parseJson<JsonRecord>(row.payloadJson),
      idempotencyKey: row.idempotencyKey,
    };
  }

  listEntities(tenantId: string, contextId: string): BusinessEntity[] {
    const rows = this.db.prepare(`
      SELECT tenant_id as tenantId, id, context_id as contextId, entity_type as entityType,
             business_key as businessKey, attributes_json as attributesJson,
             created_at as createdAt, updated_at as updatedAt
      FROM business_entities WHERE tenant_id = ? AND context_id = ?
      ORDER BY entity_type, business_key, id
    `).all(tenantId, contextId) as Array<Omit<BusinessEntity, "attributes"> & { attributesJson: string }>;
    return rows.map((row) => ({
      tenantId: row.tenantId,
      id: row.id,
      contextId: row.contextId,
      entityType: row.entityType,
      businessKey: row.businessKey,
      attributes: parseJson<JsonRecord>(row.attributesJson),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  listDocuments(tenantId: string, contextId: string): SourceDocument[] {
    const rows = this.db.prepare(`
      SELECT tenant_id as tenantId, id, source_system_id as sourceSystemId,
             external_document_id as externalDocumentId, document_type as documentType,
             content_hash as contentHash, received_at as receivedAt, effective_at as effectiveAt,
             version, context_id as contextId, entity_id as entityId, file_name as fileName,
             mime_type as mimeType, metadata_json as metadataJson
      FROM source_documents WHERE tenant_id = ? AND context_id = ?
      ORDER BY received_at, id
    `).all(tenantId, contextId) as Array<Omit<SourceDocument, "metadata"> & { metadataJson: string }>;
    return rows.map((row) => ({
      tenantId: row.tenantId,
      id: row.id,
      sourceSystemId: row.sourceSystemId,
      externalDocumentId: row.externalDocumentId,
      documentType: row.documentType,
      contentHash: row.contentHash,
      receivedAt: row.receivedAt,
      effectiveAt: row.effectiveAt,
      version: row.version,
      ...(row.contextId ? { contextId: row.contextId } : {}),
      ...(row.entityId ? { entityId: row.entityId } : {}),
      ...(optional(row.fileName) ? { fileName: row.fileName } : {}),
      ...(optional(row.mimeType) ? { mimeType: row.mimeType } : {}),
      metadata: parseJson<JsonRecord>(row.metadataJson),
    }));
  }

  listEvents(tenantId: string, contextId: string): FulfillmentEvent[] {
    const rows = this.db.prepare(`
      SELECT tenant_id as tenantId, id, context_id as contextId, entity_id as entityId,
             event_type as eventType, occurred_at as occurredAt, recorded_at as recordedAt,
             source_system_id as sourceSystemId, source_document_id as sourceDocumentId,
             payload_json as payloadJson, idempotency_key as idempotencyKey
      FROM fulfillment_events WHERE tenant_id = ? AND context_id = ?
      ORDER BY occurred_at, recorded_at, id
    `).all(tenantId, contextId) as Array<Omit<FulfillmentEvent, "payload" | "sourceDocumentId"> & { sourceDocumentId: string | null; payloadJson: string }>;
    return rows.map((row) => ({
      tenantId: row.tenantId,
      id: row.id,
      contextId: row.contextId,
      entityId: row.entityId,
      eventType: row.eventType,
      occurredAt: row.occurredAt,
      recordedAt: row.recordedAt,
      sourceSystemId: row.sourceSystemId,
      ...(row.sourceDocumentId ? { sourceDocumentId: row.sourceDocumentId } : {}),
      payload: parseJson<JsonRecord>(row.payloadJson),
      idempotencyKey: row.idempotencyKey,
    }));
  }

  listEvidence(tenantId: string, contextId: string): V2Evidence[] {
    const rows = this.db.prepare(`
      SELECT tenant_id as tenantId, id, context_id as contextId, source_system_id as sourceSystemId,
             source_document_id as sourceDocumentId, source_version as sourceVersion, entity_id as entityId,
             event_id as eventId, field, value_json as valueJson, value_type as valueType,
             locator_json as locatorJson, quote, confidence, support, observed_at as observedAt,
             created_at as createdAt, metadata_json as metadataJson
      FROM v2_evidence WHERE tenant_id = ? AND context_id = ?
      ORDER BY observed_at, created_at, id
    `).all(tenantId, contextId) as Array<Omit<V2Evidence, "value" | "locator" | "metadata" | "entityId" | "eventId"> & {
      valueJson: string;
      locatorJson: string;
      metadataJson: string;
      entityId: string | null;
      eventId: string | null;
    }>;
    return rows.map((row) => ({
      tenantId: row.tenantId,
      id: row.id,
      contextId: row.contextId,
      sourceSystemId: row.sourceSystemId,
      sourceDocumentId: row.sourceDocumentId,
      sourceVersion: row.sourceVersion,
      ...(row.entityId ? { entityId: row.entityId } : {}),
      ...(row.eventId ? { eventId: row.eventId } : {}),
      field: row.field,
      value: parseJson<unknown>(row.valueJson),
      valueType: row.valueType,
      locator: parseJson<V2Evidence["locator"]>(row.locatorJson),
      quote: row.quote,
      confidence: row.confidence,
      support: row.support,
      observedAt: row.observedAt,
      createdAt: row.createdAt,
      metadata: parseJson<JsonRecord>(row.metadataJson),
    }));
  }

  listEntityReferences(tenantId: string, contextId: string): EntityReference[] {
    const rows = this.db.prepare(`
      SELECT r.tenant_id as tenantId, r.id, r.entity_id as entityId,
             r.source_system_id as sourceSystemId, r.external_id as externalId,
             r.external_type as externalType, r.created_at as createdAt
      FROM entity_references r
      JOIN business_entities e
        ON e.tenant_id = r.tenant_id AND e.id = r.entity_id
      WHERE r.tenant_id = ? AND e.context_id = ?
      ORDER BY r.external_type, r.external_id, r.id
    `).all(tenantId, contextId) as EntityReference[];
    return rows;
  }

  listInvolvedSourceSystems(tenantId: string, contextId: string): SourceSystem[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT s.tenant_id as tenantId, s.id, s.name, s.system_type as systemType,
             s.authority_level as authorityLevel, s.status, s.metadata_json as metadataJson
      FROM source_systems s
      WHERE s.tenant_id = ? AND s.id IN (
        SELECT source_system_id FROM source_documents WHERE tenant_id = ? AND context_id = ?
        UNION
        SELECT source_system_id FROM fulfillment_events WHERE tenant_id = ? AND context_id = ?
        UNION
        SELECT source_system_id FROM v2_evidence WHERE tenant_id = ? AND context_id = ?
        UNION
        SELECT r.source_system_id
        FROM entity_references r
        JOIN business_entities e ON e.tenant_id = r.tenant_id AND e.id = r.entity_id
        WHERE r.tenant_id = ? AND e.context_id = ?
      )
      ORDER BY s.id
    `).all(tenantId, tenantId, contextId, tenantId, contextId, tenantId, contextId, tenantId, contextId) as Array<Omit<SourceSystem, "metadata"> & { metadataJson: string }>;
    return rows.map((row) => ({
      tenantId: row.tenantId,
      id: row.id,
      name: row.name,
      systemType: row.systemType,
      authorityLevel: row.authorityLevel,
      status: row.status,
      metadata: parseJson<JsonRecord>(row.metadataJson),
    }));
  }

  replayContext(tenantId: string, contextId: string) {
    return {
      context: this.getContext(tenantId, contextId),
      entities: this.listEntities(tenantId, contextId),
      entityReferences: this.listEntityReferences(tenantId, contextId),
      sourceSystems: this.listInvolvedSourceSystems(tenantId, contextId),
      documents: this.listDocuments(tenantId, contextId),
      events: this.listEvents(tenantId, contextId),
      evidence: this.listEvidence(tenantId, contextId),
    };
  }

  private getSourceDocumentByIdentity(tenantId: string, sourceSystemId: string, externalDocumentId: string, version: string): SourceDocument | undefined {
    const row = this.db.prepare(`
      SELECT tenant_id as tenantId, id, source_system_id as sourceSystemId,
             external_document_id as externalDocumentId, document_type as documentType,
             content_hash as contentHash, received_at as receivedAt, effective_at as effectiveAt,
             version, context_id as contextId, entity_id as entityId, file_name as fileName,
             mime_type as mimeType, metadata_json as metadataJson
      FROM source_documents
      WHERE tenant_id = ? AND source_system_id = ? AND external_document_id = ? AND version = ?
    `).get(tenantId, sourceSystemId, externalDocumentId, version) as (Omit<SourceDocument, "metadata"> & { metadataJson: string }) | undefined;
    if (!row) return undefined;
    return {
      tenantId: row.tenantId,
      id: row.id,
      sourceSystemId: row.sourceSystemId,
      externalDocumentId: row.externalDocumentId,
      documentType: row.documentType,
      contentHash: row.contentHash,
      receivedAt: row.receivedAt,
      effectiveAt: row.effectiveAt,
      version: row.version,
      ...(row.contextId ? { contextId: row.contextId } : {}),
      ...(row.entityId ? { entityId: row.entityId } : {}),
      ...(optional(row.fileName) ? { fileName: row.fileName } : {}),
      ...(optional(row.mimeType) ? { mimeType: row.mimeType } : {}),
      metadata: parseJson<JsonRecord>(row.metadataJson),
    };
  }

  private getEventByIdempotency(tenantId: string, sourceSystemId: string, idempotencyKey: string): FulfillmentEvent | undefined {
    const row = this.db.prepare(`
      SELECT tenant_id as tenantId, id, context_id as contextId, entity_id as entityId,
             event_type as eventType, occurred_at as occurredAt, recorded_at as recordedAt,
             source_system_id as sourceSystemId, source_document_id as sourceDocumentId,
             payload_json as payloadJson, idempotency_key as idempotencyKey
      FROM fulfillment_events
      WHERE tenant_id = ? AND source_system_id = ? AND idempotency_key = ?
    `).get(tenantId, sourceSystemId, idempotencyKey) as (Omit<FulfillmentEvent, "payload" | "sourceDocumentId"> & { sourceDocumentId: string | null; payloadJson: string }) | undefined;
    if (!row) return undefined;
    return {
      tenantId: row.tenantId,
      id: row.id,
      contextId: row.contextId,
      entityId: row.entityId,
      eventType: row.eventType,
      occurredAt: row.occurredAt,
      recordedAt: row.recordedAt,
      sourceSystemId: row.sourceSystemId,
      ...(row.sourceDocumentId ? { sourceDocumentId: row.sourceDocumentId } : {}),
      payload: parseJson<JsonRecord>(row.payloadJson),
      idempotencyKey: row.idempotencyKey,
    };
  }

  private getEvidence(tenantId: string, evidenceId: string): V2Evidence | undefined {
    const row = this.db.prepare(`
      SELECT tenant_id as tenantId, id, context_id as contextId, source_system_id as sourceSystemId,
             source_document_id as sourceDocumentId, source_version as sourceVersion, entity_id as entityId,
             event_id as eventId, field, value_json as valueJson, value_type as valueType,
             locator_json as locatorJson, quote, confidence, support, observed_at as observedAt,
             created_at as createdAt, metadata_json as metadataJson
      FROM v2_evidence WHERE tenant_id = ? AND id = ?
    `).get(tenantId, evidenceId) as (Omit<V2Evidence, "value" | "locator" | "metadata" | "entityId" | "eventId"> & {
      valueJson: string;
      locatorJson: string;
      metadataJson: string;
      entityId: string | null;
      eventId: string | null;
    }) | undefined;
    if (!row) return undefined;
    return {
      tenantId: row.tenantId,
      id: row.id,
      contextId: row.contextId,
      sourceSystemId: row.sourceSystemId,
      sourceDocumentId: row.sourceDocumentId,
      sourceVersion: row.sourceVersion,
      ...(row.entityId ? { entityId: row.entityId } : {}),
      ...(row.eventId ? { eventId: row.eventId } : {}),
      field: row.field,
      value: parseJson<unknown>(row.valueJson),
      valueType: row.valueType,
      locator: parseJson<V2Evidence["locator"]>(row.locatorJson),
      quote: row.quote,
      confidence: row.confidence,
      support: row.support,
      observedAt: row.observedAt,
      createdAt: row.createdAt,
      metadata: parseJson<JsonRecord>(row.metadataJson),
    };
  }
}
