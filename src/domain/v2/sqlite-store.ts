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
import type {
  ExceptionEvidenceBundle,
  ExceptionEvidenceRole,
  RuleDefinition,
  RuleEvaluation,
  RuleExecutionResult,
  RuleVersion,
  V2Exception,
} from "./rule-types.js";
import { ruleVersionContentHash } from "./rule-engine.js";
import type { ResolutionCase, ResolutionReceipt } from "./resolution/types.js";
import type { GroundedExplanationRecord } from "./grounded-types.js";
import type { DecisionRecommendationDisposition, DecisionRecommendationRecord } from "./decision-types.js";
import type { RootCauseAnalysisRecord, RootCauseHypothesisReview } from "./root-cause-types.js";
import type { PolicyDefinitionRecord, PolicyEvaluationRecord } from "./policy-types.js";
import type {
  AutomationReceiptRecord,
  AutomationRunRecord,
  InternalWorkItemKind,
  InternalWorkItemRecord,
  InternalWorkItemStatus,
} from "./automation-types.js";
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

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* preserve original failure */ }
      throw error;
    }
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

  saveRuleDefinition(input: RuleDefinition): RuleDefinition {
    if (!input.id || !input.tenantId || !input.code) throw new DomainError("DOMAIN_ID_REQUIRED");
    this.db.prepare(`
      INSERT INTO rule_definitions
        (tenant_id, id, code, name, description, exception_type, enabled, created_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, id) DO UPDATE SET
        code = excluded.code,
        name = excluded.name,
        description = excluded.description,
        exception_type = excluded.exception_type,
        enabled = excluded.enabled,
        created_at = excluded.created_at,
        metadata_json = excluded.metadata_json
    `).run(input.tenantId, input.id, input.code, input.name, input.description, input.exceptionType, input.enabled ? 1 : 0, input.createdAt, json(input.metadata));
    return input;
  }

  saveRuleVersion(input: RuleVersion): RuleVersion {
    const expectedHash = ruleVersionContentHash(input.config);
    if (input.contentHash !== expectedHash) throw new DomainError("DOMAIN_RULE_VERSION_CONTENT_HASH_MISMATCH", input.id);
    const existing = this.getRuleVersion(input.tenantId, input.ruleId, input.version);
    if (existing) {
      if (existing.contentHash !== input.contentHash || stableJson(existing.config) !== stableJson(input.config)) {
        throw new DomainError("DOMAIN_RULE_VERSION_IMMUTABILITY_CONFLICT", input.id);
      }
      return existing;
    }
    const definition = this.getRuleDefinition(input.tenantId, input.ruleId);
    if (!definition || definition.tenantId !== input.tenantId) throw new DomainError("DOMAIN_RULE_TENANT_MISMATCH", input.id);
    this.db.prepare(`
      INSERT INTO rule_versions
        (tenant_id, id, rule_id, version, status, config_json, content_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.tenantId, input.id, input.ruleId, input.version, input.status, json(input.config), input.contentHash, input.createdAt);
    return input;
  }

  listEnabledRuleDefinitions(tenantId: string): RuleDefinition[] {
    const rows = this.db.prepare(`
      SELECT tenant_id as tenantId, id, code, name, description,
             exception_type as exceptionType, enabled, created_at as createdAt,
             metadata_json as metadataJson
      FROM rule_definitions
      WHERE tenant_id = ? AND enabled = 1
      ORDER BY id
    `).all(tenantId) as Array<Omit<RuleDefinition, "metadata" | "enabled"> & { enabled: number; metadataJson: string }>;
    return rows.map((row) => ({
      tenantId: row.tenantId,
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      exceptionType: row.exceptionType,
      enabled: Boolean(row.enabled),
      createdAt: row.createdAt,
      metadata: parseJson<JsonRecord>(row.metadataJson),
    }));
  }

  listActiveRuleVersions(tenantId: string): RuleVersion[] {
    const rows = this.db.prepare(`
      SELECT tenant_id as tenantId, id, rule_id as ruleId, version, status,
             config_json as configJson, content_hash as contentHash, created_at as createdAt
      FROM rule_versions
      WHERE tenant_id = ? AND status = 'active'
      ORDER BY rule_id, version
    `).all(tenantId) as Array<Omit<RuleVersion, "config"> & { configJson: string }>;
    return rows.map((row) => ({
      tenantId: row.tenantId,
      id: row.id,
      ruleId: row.ruleId,
      version: row.version,
      status: row.status,
      config: parseJson<RuleVersion["config"]>(row.configJson),
      contentHash: row.contentHash,
      createdAt: row.createdAt,
    }));
  }

  retireRuleVersionsExcept(tenantId: string, ruleId: string, activeVersionId: string) {
    this.db.prepare(`
      UPDATE rule_versions
      SET status = 'retired'
      WHERE tenant_id = ? AND rule_id = ? AND id <> ? AND status = 'active'
    `).run(tenantId, ruleId, activeVersionId);
  }

  recordRuleExecution(result: RuleExecutionResult) {
    const { evaluation, exception } = result;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        INSERT OR IGNORE INTO rule_evaluations
          (tenant_id, id, context_id, rule_id, rule_version_id, status, observations_json, metrics_json, input_hash, match_key, evaluated_at, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        evaluation.tenantId,
        evaluation.id,
        evaluation.contextId,
        evaluation.ruleId,
        evaluation.ruleVersionId,
        evaluation.status,
        json(evaluation.observations),
        json(evaluation.metrics),
        evaluation.inputHash,
        evaluation.matchKey,
        evaluation.evaluatedAt,
        json(evaluation.metadata),
      );
      if (!exception) {
        this.db.exec("COMMIT");
        return this.getRuleEvaluationByInput(evaluation.tenantId, evaluation.contextId, evaluation.ruleVersionId, evaluation.inputHash);
      }
      const existing = this.getStableException(exception.tenantId, exception.contextId, exception.ruleId, exception.matchKey);
      const exceptionId = existing?.id ?? exception.id;
      const isNewEvaluation = !existing || existing.latestRuleEvaluationId !== exception.latestRuleEvaluationId;
      if (!existing) {
        this.db.prepare(`
          INSERT INTO exceptions
            (tenant_id, id, context_id, rule_id, rule_version_id, rule_evaluation_id, latest_rule_evaluation_id,
             exception_type, status, severity, title, summary, metrics_json, match_key, created_at, last_detected_at, metadata_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          exception.tenantId,
          exceptionId,
          exception.contextId,
          exception.ruleId,
          exception.ruleVersionId,
          exception.latestRuleEvaluationId,
          exception.latestRuleEvaluationId,
          exception.code,
          exception.status,
          exception.severity,
          exception.title,
          exception.summary,
          json(exception.metrics),
          exception.matchKey,
          exception.createdAt,
          exception.lastDetectedAt,
          json(exception.metadata),
        );
      } else if (isNewEvaluation) {
        this.db.prepare(`
          UPDATE exceptions SET
            rule_version_id = ?,
            rule_evaluation_id = ?,
            latest_rule_evaluation_id = ?,
            severity = ?,
            title = ?,
            summary = ?,
            metrics_json = ?,
            last_detected_at = ?
          WHERE tenant_id = ? AND id = ?
        `).run(
          exception.ruleVersionId,
          exception.latestRuleEvaluationId,
          exception.latestRuleEvaluationId,
          exception.severity,
          exception.title,
          exception.summary,
          json(exception.metrics),
          exception.lastDetectedAt,
          exception.tenantId,
          exceptionId,
        );
        this.db.prepare("DELETE FROM exception_evidence WHERE tenant_id = ? AND exception_id = ?").run(exception.tenantId, exceptionId);
        this.db.prepare("DELETE FROM exception_entities WHERE tenant_id = ? AND exception_id = ?").run(exception.tenantId, exceptionId);
      }
      if (isNewEvaluation) {
        for (const evidenceId of exception.evidenceIds) {
          const role = result.evidenceBundle?.evidence.find((item) => item.evidenceId === evidenceId)?.role ?? "context";
          this.db.prepare(`
            INSERT INTO exception_evidence (tenant_id, exception_id, evidence_id, role)
            VALUES (?, ?, ?, ?)
          `).run(exception.tenantId, exceptionId, evidenceId, role);
        }
        for (const entityId of exception.entityIds) {
          this.db.prepare("INSERT INTO exception_entities (tenant_id, exception_id, entity_id) VALUES (?, ?, ?)").run(exception.tenantId, exceptionId, entityId);
        }
      }
      this.db.exec("COMMIT");
      return this.getRuleEvaluationByInput(evaluation.tenantId, evaluation.contextId, evaluation.ruleVersionId, evaluation.inputHash);
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* preserve original failure */ }
      throw error;
    }
  }

  listRuleEvaluations(tenantId: string, contextId: string): RuleEvaluation[] {
    const rows = this.db.prepare(`
      SELECT tenant_id as tenantId, id, context_id as contextId, rule_id as ruleId,
             rule_version_id as ruleVersionId, status, observations_json as observationsJson,
             metrics_json as metricsJson, input_hash as inputHash, match_key as matchKey,
             evaluated_at as evaluatedAt, metadata_json as metadataJson
      FROM rule_evaluations
      WHERE tenant_id = ? AND context_id = ?
      ORDER BY evaluated_at, id
    `).all(tenantId, contextId) as Array<{
      tenantId: string;
      id: string;
      contextId: string;
      ruleId: string;
      ruleVersionId: string;
      status: RuleEvaluation["status"];
      observationsJson: string;
      metricsJson: string;
      inputHash: string;
      matchKey: string;
      evaluatedAt: string;
      metadataJson: string;
    }>;
    return rows.map((row) => ({
      tenantId: row.tenantId,
      id: row.id,
      contextId: row.contextId,
      ruleId: row.ruleId,
      ruleVersionId: row.ruleVersionId,
      status: row.status,
      observations: parseJson<RuleEvaluation["observations"]>(row.observationsJson),
      metrics: parseJson<RuleEvaluation["metrics"]>(row.metricsJson),
      inputHash: row.inputHash,
      matchKey: row.matchKey,
      evaluatedAt: row.evaluatedAt,
      metadata: parseJson<JsonRecord>(row.metadataJson),
    }));
  }

  listExceptions(tenantId: string, contextId: string): V2Exception[] {
    const rows = this.db.prepare(`
      SELECT e.tenant_id as tenantId, e.id, e.context_id as contextId, e.rule_id as ruleId,
             e.rule_version_id as ruleVersionId, e.rule_evaluation_id as ruleEvaluationId,
             e.latest_rule_evaluation_id as latestRuleEvaluationId,
             e.exception_type as code, e.status, e.severity, e.title, e.summary,
             e.metrics_json as metricsJson, e.match_key as matchKey,
             e.created_at as createdAt, e.last_detected_at as lastDetectedAt,
             e.metadata_json as metadataJson
      FROM exceptions e
      WHERE e.tenant_id = ? AND e.context_id = ?
      ORDER BY e.created_at, e.id
    `).all(tenantId, contextId) as Array<Omit<V2Exception, "entityIds" | "evidenceIds" | "metadata" | "metrics"> & { metricsJson: string; metadataJson: string }>;
    return rows.map((row) => ({
      tenantId: row.tenantId,
      id: row.id,
      contextId: row.contextId,
      ruleId: row.ruleId,
      ruleVersionId: row.ruleVersionId,
      ruleEvaluationId: row.ruleEvaluationId,
      latestRuleEvaluationId: row.latestRuleEvaluationId,
      code: row.code,
      status: row.status,
      severity: row.severity,
      title: row.title,
      summary: row.summary,
      metrics: parseJson<V2Exception["metrics"]>(row.metricsJson),
      entityIds: (this.db.prepare("SELECT entity_id as entityId FROM exception_entities WHERE tenant_id = ? AND exception_id = ? ORDER BY entity_id").all(tenantId, row.id) as Array<{ entityId: string }>).map((item) => item.entityId),
      evidenceIds: (this.db.prepare("SELECT evidence_id as evidenceId FROM exception_evidence WHERE tenant_id = ? AND exception_id = ? ORDER BY evidence_id").all(tenantId, row.id) as Array<{ evidenceId: string }>).map((item) => item.evidenceId),
      matchKey: row.matchKey,
      createdAt: row.createdAt,
      lastDetectedAt: row.lastDetectedAt,
      metadata: parseJson<JsonRecord>(row.metadataJson),
    }));
  }

  getExceptionEvidenceBundle(tenantId: string, exceptionId: string): ExceptionEvidenceBundle | undefined {
    const exception = this.listExceptions(tenantId, (this.db.prepare("SELECT context_id as contextId FROM exceptions WHERE tenant_id = ? AND id = ?").get(tenantId, exceptionId) as { contextId: string } | undefined)?.contextId ?? "")
      .find((item) => item.id === exceptionId);
    if (!exception) return undefined;
    const evaluation = this.listRuleEvaluations(tenantId, exception.contextId).find((item) => item.id === exception.ruleEvaluationId);
    if (!evaluation) return undefined;
    const allEvidence = this.listEvidence(tenantId, exception.contextId);
    const roles = new Map(
      (this.db.prepare("SELECT evidence_id as evidenceId, role FROM exception_evidence WHERE tenant_id = ? AND exception_id = ?").all(tenantId, exceptionId) as Array<{ evidenceId: string; role: ExceptionEvidenceRole }>)
        .map((item) => [item.evidenceId, item.role]),
    );
    const evidence = exception.evidenceIds.flatMap((id) => allEvidence
      .filter((item) => item.id === id)
      .map((item) => ({ ...item, evidenceId: item.id, role: roles.get(item.id) ?? "context" as const })));
    const sourceDocumentIds = new Set(evidence.map((item) => item.sourceDocumentId));
    const sourceSystemIds = new Set(evidence.map((item) => item.sourceSystemId));
    return {
      id: `bundle-${exception.id}`,
      tenantId,
      contextId: exception.contextId,
      exceptionId,
      observations: evaluation.observations,
      evidenceIds: evidence.map((item) => item.id),
      evidence,
      sourceDocuments: this.listDocuments(tenantId, exception.contextId).filter((item) => sourceDocumentIds.has(item.id)),
      sourceSystems: this.listInvolvedSourceSystems(tenantId, exception.contextId).filter((item) => sourceSystemIds.has(item.id)),
    };
  }

  saveResolutionCase(resolution: ResolutionCase): ResolutionCase {
    const exception = this.listExceptions(resolution.tenantId, resolution.contextId).find((item) => item.id === resolution.exceptionId);
    if (!exception) throw new DomainError("DOMAIN_EXCEPTION_NOT_FOUND", resolution.exceptionId);
    const existing = this.getResolutionCaseByException(resolution.tenantId, resolution.exceptionId);
    if (existing && existing.id !== resolution.id) throw new Error("resolution_case_identity_conflict");
    this.db.prepare(`
      INSERT INTO resolution_cases
        (tenant_id, id, context_id, exception_id, status, owner_role, origin_json, review_json, proposed_by, runtime_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, id) DO UPDATE SET
        status = excluded.status,
        owner_role = excluded.owner_role,
        origin_json = excluded.origin_json,
        review_json = excluded.review_json,
        proposed_by = excluded.proposed_by,
        runtime_json = excluded.runtime_json,
        updated_at = excluded.updated_at
    `).run(
      resolution.tenantId,
      resolution.id,
      resolution.contextId,
      resolution.exceptionId,
      resolution.status,
      resolution.ownerRole,
      json(resolution.origin),
      resolution.review ? json(resolution.review) : null,
      resolution.proposedBy ?? null,
      json(resolution.runtime),
      resolution.createdAt,
      resolution.updatedAt,
    );
    return this.getResolutionCase(resolution.tenantId, resolution.id) ?? resolution;
  }

  getResolutionCase(tenantId: string, caseId: string): ResolutionCase | undefined {
    const row = this.db.prepare(`
      SELECT tenant_id as tenantId, id, context_id as contextId, exception_id as exceptionId,
             status, owner_role as ownerRole, origin_json as originJson, review_json as reviewJson,
             proposed_by as proposedBy, runtime_json as runtimeJson,
             created_at as createdAt, updated_at as updatedAt
      FROM resolution_cases WHERE tenant_id = ? AND id = ?
    `).get(tenantId, caseId) as {
      tenantId: string;
      id: string;
      contextId: string;
      exceptionId: string;
      status: ResolutionCase["status"];
      ownerRole: string;
      originJson: string;
      reviewJson: string | null;
      proposedBy: string | null;
      runtimeJson: string;
      createdAt: string;
      updatedAt: string;
    } | undefined;
    if (!row) return undefined;
    return {
      tenantId: row.tenantId,
      id: row.id,
      contextId: row.contextId,
      exceptionId: row.exceptionId,
      status: row.status,
      ownerRole: row.ownerRole,
      origin: parseJson<ResolutionCase["origin"]>(row.originJson),
      ...(row.reviewJson ? { review: parseJson<ResolutionCase["review"]>(row.reviewJson) } : {}),
      ...(row.proposedBy ? { proposedBy: row.proposedBy } : {}),
      runtime: parseJson<ResolutionCase["runtime"]>(row.runtimeJson),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  getResolutionCaseByException(tenantId: string, exceptionId: string): ResolutionCase | undefined {
    const row = this.db.prepare("SELECT id FROM resolution_cases WHERE tenant_id = ? AND exception_id = ?").get(tenantId, exceptionId) as { id: string } | undefined;
    return row ? this.getResolutionCase(tenantId, row.id) : undefined;
  }

  listResolutionCases(tenantId: string, contextId: string): ResolutionCase[] {
    const rows = this.db.prepare(`
      SELECT id FROM resolution_cases
      WHERE tenant_id = ? AND context_id = ?
      ORDER BY created_at, id
    `).all(tenantId, contextId) as Array<{ id: string }>;
    return rows.flatMap((row) => {
      const resolution = this.getResolutionCase(tenantId, row.id);
      return resolution ? [resolution] : [];
    });
  }

  recordResolutionReceipt(input: Omit<ResolutionReceipt, "externalRequestId" | "receipt" | "receiptSource" | "status" | "createdAt">) {
    const existing = this.getResolutionReceiptByOperation(input.tenantId, input.resolutionCaseId, input.actionId, input.operationKey);
    if (existing) {
      if (existing.payloadHash !== input.payloadHash) throw new DomainError("RESOLUTION_EXECUTION_IDEMPOTENCY_CONFLICT", input.actionId);
      return existing;
    }
    const createdAt = new Date().toISOString();
    const externalRequestId = `resolution-${input.actionId}-${input.operationKey}`;
    const receipt: ResolutionReceipt = {
      ...input,
      externalRequestId,
      receipt: `local-ledger:${externalRequestId}`,
      receiptSource: "local-ledger",
      status: "succeeded",
      createdAt,
    };
    this.db.prepare(`
      INSERT OR IGNORE INTO resolution_action_receipts
        (tenant_id, resolution_case_id, action_id, operation_key, external_request_id, receipt, receipt_source, status, payload_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      receipt.tenantId,
      receipt.resolutionCaseId,
      receipt.actionId,
      receipt.operationKey,
      receipt.externalRequestId,
      receipt.receipt,
      receipt.receiptSource,
      receipt.status,
      receipt.payloadHash,
      receipt.createdAt,
    );
    return this.getResolutionReceiptByOperation(input.tenantId, input.resolutionCaseId, input.actionId, input.operationKey) ?? receipt;
  }

  listResolutionReceipts(tenantId: string, resolutionCaseId: string): ResolutionReceipt[] {
    const rows = this.db.prepare(`
      SELECT tenant_id as tenantId, resolution_case_id as resolutionCaseId, action_id as actionId,
             operation_key as operationKey, external_request_id as externalRequestId,
             receipt, receipt_source as receiptSource, status, payload_hash as payloadHash,
             created_at as createdAt
      FROM resolution_action_receipts
      WHERE tenant_id = ? AND resolution_case_id = ?
      ORDER BY created_at, action_id
    `).all(tenantId, resolutionCaseId) as ResolutionReceipt[];
    return rows;
  }

  saveGroundedExplanation(input: GroundedExplanationRecord): GroundedExplanationRecord {
    const existing = this.getGroundedExplanationBySnapshot(
      input.tenantId,
      input.exceptionId,
      input.inputSnapshotHash,
      input.provider,
      input.model,
    );
    if (existing) {
      return existing;
    }
    this.db.prepare(`
      INSERT INTO grounded_ai_explanations
        (tenant_id, id, context_id, exception_id, rule_evaluation_id, input_snapshot_hash,
         provider, model, status, output_json, validation_json, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, exception_id, input_snapshot_hash, provider, model) DO NOTHING
    `).run(
      input.tenantId,
      input.id,
      input.contextId,
      input.exceptionId,
      input.ruleEvaluationId,
      input.inputSnapshotHash,
      input.provider,
      input.model,
      input.status,
      json(input.output),
      json(input.validation),
      input.createdBy,
      input.createdAt,
    );
    return this.getGroundedExplanationBySnapshot(
      input.tenantId,
      input.exceptionId,
      input.inputSnapshotHash,
      input.provider,
      input.model,
    ) ?? input;
  }

  getGroundedExplanation(tenantId: string, explanationId: string): GroundedExplanationRecord | undefined {
    const row = this.db.prepare(`
      SELECT tenant_id as tenantId, id, context_id as contextId, exception_id as exceptionId,
             rule_evaluation_id as ruleEvaluationId, input_snapshot_hash as inputSnapshotHash,
             provider, model, status, output_json as outputJson, validation_json as validationJson,
             created_by as createdBy, created_at as createdAt
      FROM grounded_ai_explanations
      WHERE tenant_id = ? AND id = ?
    `).get(tenantId, explanationId) as {
      tenantId: string;
      id: string;
      contextId: string;
      exceptionId: string;
      ruleEvaluationId: string;
      inputSnapshotHash: string;
      provider: string;
      model: string;
      status: GroundedExplanationRecord["status"];
      outputJson: string;
      validationJson: string;
      createdBy: string;
      createdAt: string;
    } | undefined;
    if (!row) return undefined;
    return {
      tenantId: row.tenantId,
      id: row.id,
      contextId: row.contextId,
      exceptionId: row.exceptionId,
      ruleEvaluationId: row.ruleEvaluationId,
      inputSnapshotHash: row.inputSnapshotHash,
      provider: row.provider,
      model: row.model,
      status: row.status,
      output: parseJson<unknown>(row.outputJson),
      validation: parseJson<unknown>(row.validationJson),
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    };
  }

  getGroundedExplanationBySnapshot(
    tenantId: string,
    exceptionId: string,
    inputSnapshotHash: string,
    provider: string,
    model: string,
  ): GroundedExplanationRecord | undefined {
    const row = this.db.prepare(`
      SELECT id
      FROM grounded_ai_explanations
      WHERE tenant_id = ? AND exception_id = ? AND input_snapshot_hash = ? AND provider = ? AND model = ?
    `).get(tenantId, exceptionId, inputSnapshotHash, provider, model) as { id: string } | undefined;
    return row ? this.getGroundedExplanation(tenantId, row.id) : undefined;
  }

  listGroundedExplanations(tenantId: string, contextId: string, exceptionId: string): GroundedExplanationRecord[] {
    const rows = this.db.prepare(`
      SELECT id
      FROM grounded_ai_explanations
      WHERE tenant_id = ? AND context_id = ? AND exception_id = ?
      ORDER BY created_at, id
    `).all(tenantId, contextId, exceptionId) as Array<{ id: string }>;
    return rows.flatMap((row) => {
      const explanation = this.getGroundedExplanation(tenantId, row.id);
      return explanation ? [explanation] : [];
    });
  }

  saveDecisionRecommendation(input: DecisionRecommendationRecord): DecisionRecommendationRecord {
    const existing = this.getDecisionRecommendationBySnapshot(
      input.tenantId,
      input.exceptionId,
      input.inputSnapshotHash,
      input.provider,
      input.model,
    );
    if (existing) return existing;
    this.db.prepare(`
      INSERT INTO decision_recommendations
        (tenant_id, id, context_id, exception_id, rule_evaluation_id, input_snapshot_hash,
         provider, model, status, output_json, validation_json, history_snapshot_json,
         eligibility_json, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, exception_id, input_snapshot_hash, provider, model) DO NOTHING
    `).run(
      input.tenantId,
      input.id,
      input.contextId,
      input.exceptionId,
      input.ruleEvaluationId,
      input.inputSnapshotHash,
      input.provider,
      input.model,
      input.status,
      json(input.output),
      json(input.validation),
      json(input.historySnapshot),
      json(input.eligibility),
      input.createdBy,
      input.createdAt,
    );
    return this.getDecisionRecommendationBySnapshot(
      input.tenantId,
      input.exceptionId,
      input.inputSnapshotHash,
      input.provider,
      input.model,
    ) ?? input;
  }

  getDecisionRecommendation(tenantId: string, recommendationId: string): DecisionRecommendationRecord | undefined {
    const row = this.db.prepare(`
      SELECT tenant_id as tenantId, id, context_id as contextId, exception_id as exceptionId,
             rule_evaluation_id as ruleEvaluationId, input_snapshot_hash as inputSnapshotHash,
             provider, model, status, output_json as outputJson, validation_json as validationJson,
             history_snapshot_json as historySnapshotJson, eligibility_json as eligibilityJson,
             created_by as createdBy, created_at as createdAt
      FROM decision_recommendations
      WHERE tenant_id = ? AND id = ?
    `).get(tenantId, recommendationId) as {
      tenantId: string;
      id: string;
      contextId: string;
      exceptionId: string;
      ruleEvaluationId: string;
      inputSnapshotHash: string;
      provider: string;
      model: string;
      status: DecisionRecommendationRecord["status"];
      outputJson: string;
      validationJson: string;
      historySnapshotJson: string;
      eligibilityJson: string;
      createdBy: string;
      createdAt: string;
    } | undefined;
    if (!row) return undefined;
    return {
      tenantId: row.tenantId,
      id: row.id,
      contextId: row.contextId,
      exceptionId: row.exceptionId,
      ruleEvaluationId: row.ruleEvaluationId,
      inputSnapshotHash: row.inputSnapshotHash,
      provider: row.provider,
      model: row.model,
      status: row.status,
      output: parseJson<unknown>(row.outputJson),
      validation: parseJson<unknown>(row.validationJson),
      historySnapshot: parseJson<unknown>(row.historySnapshotJson),
      eligibility: parseJson<unknown>(row.eligibilityJson),
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    };
  }

  getDecisionRecommendationBySnapshot(
    tenantId: string,
    exceptionId: string,
    inputSnapshotHash: string,
    provider: string,
    model: string,
  ): DecisionRecommendationRecord | undefined {
    const row = this.db.prepare(`
      SELECT id FROM decision_recommendations
      WHERE tenant_id = ? AND exception_id = ? AND input_snapshot_hash = ? AND provider = ? AND model = ?
    `).get(tenantId, exceptionId, inputSnapshotHash, provider, model) as { id: string } | undefined;
    return row ? this.getDecisionRecommendation(tenantId, row.id) : undefined;
  }

  listDecisionRecommendations(tenantId: string, contextId: string, exceptionId: string): DecisionRecommendationRecord[] {
    const rows = this.db.prepare(`
      SELECT id FROM decision_recommendations
      WHERE tenant_id = ? AND context_id = ? AND exception_id = ?
      ORDER BY created_at, id
    `).all(tenantId, contextId, exceptionId) as Array<{ id: string }>;
    return rows.flatMap((row) => {
      const record = this.getDecisionRecommendation(tenantId, row.id);
      return record ? [record] : [];
    });
  }

  saveDecisionRecommendationDisposition(input: DecisionRecommendationDisposition): DecisionRecommendationDisposition {
    this.db.prepare(`
      INSERT INTO decision_recommendation_dispositions
        (tenant_id, id, recommendation_id, exception_id, decision, selected_option_id, rationale, actor, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.tenantId,
      input.id,
      input.recommendationId,
      input.exceptionId,
      input.decision,
      input.selectedOptionId ?? null,
      input.rationale,
      input.actor,
      input.createdAt,
    );
    return input;
  }

  listDecisionRecommendationDispositions(tenantId: string, recommendationId: string): DecisionRecommendationDisposition[] {
    const rows = this.db.prepare(`
      SELECT tenant_id as tenantId, id, recommendation_id as recommendationId,
             exception_id as exceptionId, decision, selected_option_id as selectedOptionId,
             rationale, actor, created_at as createdAt
      FROM decision_recommendation_dispositions
      WHERE tenant_id = ? AND recommendation_id = ?
      ORDER BY created_at, id
    `).all(tenantId, recommendationId) as Array<Omit<DecisionRecommendationDisposition, "selectedOptionId"> & { selectedOptionId: string | null }>;
    return rows.map((row) => ({
      tenantId: row.tenantId,
      id: row.id,
      recommendationId: row.recommendationId,
      exceptionId: row.exceptionId,
      decision: row.decision,
      ...(row.selectedOptionId ? { selectedOptionId: row.selectedOptionId } : {}),
      rationale: row.rationale,
      actor: row.actor,
      createdAt: row.createdAt,
    }));
  }

  saveRootCauseAnalysis(input: RootCauseAnalysisRecord): RootCauseAnalysisRecord {
    const existing = this.getRootCauseAnalysisBySnapshot(
      input.tenantId,
      input.exceptionId,
      input.inputSnapshotHash,
      input.provider,
      input.model,
    );
    if (existing) return existing;
    this.db.prepare(`
      INSERT INTO root_cause_analyses
        (tenant_id, id, context_id, exception_id, rule_evaluation_id, input_snapshot_hash,
         provider, model, status, output_json, validation_json, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, exception_id, input_snapshot_hash, provider, model) DO NOTHING
    `).run(
      input.tenantId,
      input.id,
      input.contextId,
      input.exceptionId,
      input.ruleEvaluationId,
      input.inputSnapshotHash,
      input.provider,
      input.model,
      input.status,
      json(input.output),
      json(input.validation),
      input.createdBy,
      input.createdAt,
    );
    return this.getRootCauseAnalysisBySnapshot(
      input.tenantId,
      input.exceptionId,
      input.inputSnapshotHash,
      input.provider,
      input.model,
    ) ?? input;
  }

  getRootCauseAnalysis(tenantId: string, analysisId: string): RootCauseAnalysisRecord | undefined {
    const row = this.db.prepare(`
      SELECT tenant_id as tenantId, id, context_id as contextId, exception_id as exceptionId,
             rule_evaluation_id as ruleEvaluationId, input_snapshot_hash as inputSnapshotHash,
             provider, model, status, output_json as outputJson, validation_json as validationJson,
             created_by as createdBy, created_at as createdAt
      FROM root_cause_analyses
      WHERE tenant_id = ? AND id = ?
    `).get(tenantId, analysisId) as {
      tenantId: string;
      id: string;
      contextId: string;
      exceptionId: string;
      ruleEvaluationId: string;
      inputSnapshotHash: string;
      provider: string;
      model: string;
      status: RootCauseAnalysisRecord["status"];
      outputJson: string;
      validationJson: string;
      createdBy: string;
      createdAt: string;
    } | undefined;
    if (!row) return undefined;
    return {
      tenantId: row.tenantId,
      id: row.id,
      contextId: row.contextId,
      exceptionId: row.exceptionId,
      ruleEvaluationId: row.ruleEvaluationId,
      inputSnapshotHash: row.inputSnapshotHash,
      provider: row.provider,
      model: row.model,
      status: row.status,
      output: parseJson<unknown>(row.outputJson),
      validation: parseJson<unknown>(row.validationJson),
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    };
  }

  getRootCauseAnalysisBySnapshot(
    tenantId: string,
    exceptionId: string,
    inputSnapshotHash: string,
    provider: string,
    model: string,
  ): RootCauseAnalysisRecord | undefined {
    const row = this.db.prepare(`
      SELECT id FROM root_cause_analyses
      WHERE tenant_id = ? AND exception_id = ? AND input_snapshot_hash = ? AND provider = ? AND model = ?
    `).get(tenantId, exceptionId, inputSnapshotHash, provider, model) as { id: string } | undefined;
    return row ? this.getRootCauseAnalysis(tenantId, row.id) : undefined;
  }

  listRootCauseAnalyses(tenantId: string, contextId: string, exceptionId: string): RootCauseAnalysisRecord[] {
    const rows = this.db.prepare(`
      SELECT id FROM root_cause_analyses
      WHERE tenant_id = ? AND context_id = ? AND exception_id = ?
      ORDER BY created_at, id
    `).all(tenantId, contextId, exceptionId) as Array<{ id: string }>;
    return rows.flatMap((row) => {
      const record = this.getRootCauseAnalysis(tenantId, row.id);
      return record ? [record] : [];
    });
  }

  saveRootCauseHypothesisReview(input: RootCauseHypothesisReview): RootCauseHypothesisReview {
    this.db.prepare(`
      INSERT INTO root_cause_hypothesis_reviews
        (tenant_id, id, analysis_id, hypothesis_id, exception_id, decision, rationale, actor, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.tenantId,
      input.id,
      input.analysisId,
      input.hypothesisId,
      input.exceptionId,
      input.decision,
      input.rationale,
      input.actor,
      input.createdAt,
    );
    return input;
  }

  listRootCauseHypothesisReviews(tenantId: string, analysisId: string, hypothesisId?: string): RootCauseHypothesisReview[] {
    const rows = this.db.prepare(`
      SELECT tenant_id as tenantId, id, analysis_id as analysisId, hypothesis_id as hypothesisId,
             exception_id as exceptionId, decision, rationale, actor, created_at as createdAt
      FROM root_cause_hypothesis_reviews
      WHERE tenant_id = ? AND analysis_id = ? ${hypothesisId ? "AND hypothesis_id = ?" : ""}
      ORDER BY created_at, id
    `).all(...(hypothesisId ? [tenantId, analysisId, hypothesisId] : [tenantId, analysisId])) as RootCauseHypothesisReview[];
    return rows;
  }

  savePolicyDefinition(input: PolicyDefinitionRecord): PolicyDefinitionRecord {
    const existing = this.getPolicyDefinition(input.tenantId, input.id, input.version);
    if (existing) {
      if (existing.contentHash !== input.contentHash) throw new Error("POLICY_DEFINITION_IMMUTABLE");
      return existing;
    }
    this.db.prepare(`
      INSERT INTO policy_definitions
        (tenant_id, id, version, name, priority, enabled, conditions_json, decision_json, content_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.tenantId,
      input.id,
      input.version,
      input.name,
      input.priority,
      input.enabled ? 1 : 0,
      json(input.conditions),
      json(input.decision),
      input.contentHash,
      input.createdAt,
    );
    return this.getPolicyDefinition(input.tenantId, input.id, input.version) ?? input;
  }

  getPolicyDefinition(tenantId: string, policyId: string, version: string): PolicyDefinitionRecord | undefined {
    const row = this.db.prepare(`
      SELECT tenant_id as tenantId, id, version, name, priority, enabled,
             conditions_json as conditionsJson, decision_json as decisionJson,
             content_hash as contentHash, created_at as createdAt
      FROM policy_definitions
      WHERE tenant_id = ? AND id = ? AND version = ?
    `).get(tenantId, policyId, version) as {
      tenantId: string;
      id: string;
      version: string;
      name: string;
      priority: number;
      enabled: number;
      conditionsJson: string;
      decisionJson: string;
      contentHash: string;
      createdAt: string;
    } | undefined;
    if (!row) return undefined;
    return {
      tenantId: row.tenantId,
      id: row.id,
      version: row.version,
      name: row.name,
      priority: row.priority,
      enabled: row.enabled === 1,
      conditions: parseJson<unknown>(row.conditionsJson),
      decision: parseJson<unknown>(row.decisionJson),
      contentHash: row.contentHash,
      createdAt: row.createdAt,
    };
  }

  listPolicyDefinitions(tenantId: string, enabledOnly = false): PolicyDefinitionRecord[] {
    const rows = this.db.prepare(`
      SELECT tenant_id as tenantId, id, version, name, priority, enabled,
             conditions_json as conditionsJson, decision_json as decisionJson,
             content_hash as contentHash, created_at as createdAt
      FROM policy_definitions
      WHERE tenant_id = ? ${enabledOnly ? "AND enabled = 1" : ""}
      ORDER BY priority, id, version
    `).all(tenantId) as Array<{
      tenantId: string;
      id: string;
      version: string;
      name: string;
      priority: number;
      enabled: number;
      conditionsJson: string;
      decisionJson: string;
      contentHash: string;
      createdAt: string;
    }>;
    return rows.map((row) => ({
      tenantId: row.tenantId,
      id: row.id,
      version: row.version,
      name: row.name,
      priority: row.priority,
      enabled: row.enabled === 1,
      conditions: parseJson<unknown>(row.conditionsJson),
      decision: parseJson<unknown>(row.decisionJson),
      contentHash: row.contentHash,
      createdAt: row.createdAt,
    }));
  }

  savePolicyEvaluation(input: PolicyEvaluationRecord): PolicyEvaluationRecord {
    const existing = this.getPolicyEvaluationBySnapshot(
      input.tenantId,
      input.exceptionId,
      input.candidateActionType,
      input.candidateSource,
      input.policySnapshotHash,
      input.sourceRecommendationId,
      input.sourceOptionId,
    );
    if (existing) return existing;
    this.db.prepare(`
      INSERT INTO policy_evaluations
        (tenant_id, id, context_id, exception_id, candidate_action_type, candidate_source,
         source_recommendation_id, source_option_id, policy_snapshot_hash, decision_json, evaluated_by, evaluated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING
    `).run(
      input.tenantId,
      input.id,
      input.contextId,
      input.exceptionId,
      input.candidateActionType,
      input.candidateSource,
      input.sourceRecommendationId ?? null,
      input.sourceOptionId ?? null,
      input.policySnapshotHash,
      json(input.decision),
      input.evaluatedBy,
      input.evaluatedAt,
    );
    return this.getPolicyEvaluationBySnapshot(
      input.tenantId,
      input.exceptionId,
      input.candidateActionType,
      input.candidateSource,
      input.policySnapshotHash,
      input.sourceRecommendationId,
      input.sourceOptionId,
    ) ?? input;
  }

  getPolicyEvaluation(tenantId: string, evaluationId: string): PolicyEvaluationRecord | undefined {
    const row = this.db.prepare(`
      SELECT tenant_id as tenantId, id, context_id as contextId, exception_id as exceptionId,
             candidate_action_type as candidateActionType, candidate_source as candidateSource,
             source_recommendation_id as sourceRecommendationId, source_option_id as sourceOptionId,
             policy_snapshot_hash as policySnapshotHash, decision_json as decisionJson,
             evaluated_by as evaluatedBy, evaluated_at as evaluatedAt
      FROM policy_evaluations
      WHERE tenant_id = ? AND id = ?
    `).get(tenantId, evaluationId) as {
      tenantId: string;
      id: string;
      contextId: string;
      exceptionId: string;
      candidateActionType: PolicyEvaluationRecord["candidateActionType"];
      candidateSource: PolicyEvaluationRecord["candidateSource"];
      sourceRecommendationId: string | null;
      sourceOptionId: string | null;
      policySnapshotHash: string;
      decisionJson: string;
      evaluatedBy: string;
      evaluatedAt: string;
    } | undefined;
    if (!row) return undefined;
    return {
      tenantId: row.tenantId,
      id: row.id,
      contextId: row.contextId,
      exceptionId: row.exceptionId,
      candidateActionType: row.candidateActionType,
      candidateSource: row.candidateSource,
      ...(row.sourceRecommendationId ? { sourceRecommendationId: row.sourceRecommendationId } : {}),
      ...(row.sourceOptionId ? { sourceOptionId: row.sourceOptionId } : {}),
      policySnapshotHash: row.policySnapshotHash,
      decision: parseJson<unknown>(row.decisionJson),
      evaluatedBy: row.evaluatedBy,
      evaluatedAt: row.evaluatedAt,
    };
  }

  getPolicyEvaluationBySnapshot(
    tenantId: string,
    exceptionId: string,
    candidateActionType: PolicyEvaluationRecord["candidateActionType"],
    candidateSource: PolicyEvaluationRecord["candidateSource"],
    policySnapshotHash: string,
    sourceRecommendationId?: string,
    sourceOptionId?: string,
  ): PolicyEvaluationRecord | undefined {
    const row = this.db.prepare(`
      SELECT id FROM policy_evaluations
      WHERE tenant_id = ? AND exception_id = ? AND candidate_action_type = ? AND candidate_source = ?
        AND policy_snapshot_hash = ?
        AND source_recommendation_id IS ?
        AND source_option_id IS ?
    `).get(
      tenantId,
      exceptionId,
      candidateActionType,
      candidateSource,
      policySnapshotHash,
      sourceRecommendationId ?? null,
      sourceOptionId ?? null,
    ) as { id: string } | undefined;
    return row ? this.getPolicyEvaluation(tenantId, row.id) : undefined;
  }

  listPolicyEvaluations(tenantId: string, contextId: string, exceptionId: string): PolicyEvaluationRecord[] {
    const rows = this.db.prepare(`
      SELECT id FROM policy_evaluations
      WHERE tenant_id = ? AND context_id = ? AND exception_id = ?
      ORDER BY evaluated_at, id
    `).all(tenantId, contextId, exceptionId) as Array<{ id: string }>;
    return rows.flatMap((row) => {
      const record = this.getPolicyEvaluation(tenantId, row.id);
      return record ? [record] : [];
    });
  }

  saveAutomationRun(input: AutomationRunRecord): AutomationRunRecord {
    const existing = this.getAutomationRunByOperationKey(input.tenantId, input.operationKey);
    if (existing) return existing;
    this.db.prepare(`
      INSERT INTO automation_runs
        (tenant_id, id, context_id, exception_id, policy_evaluation_id, candidate_action_type,
         source_recommendation_id, source_option_id, executor, executor_version, operation_key,
         status, effect_id, receipt_id, trigger_source, triggered_by, created_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING
    `).run(
      input.tenantId,
      input.id,
      input.contextId,
      input.exceptionId,
      input.policyEvaluationId,
      input.candidateActionType,
      input.sourceRecommendationId ?? null,
      input.sourceOptionId ?? null,
      input.executor,
      input.executorVersion,
      input.operationKey,
      input.status,
      input.effectId ?? null,
      input.receiptId ?? null,
      input.triggerSource,
      input.triggeredBy,
      input.createdAt,
      input.completedAt,
    );
    return this.getAutomationRunByOperationKey(input.tenantId, input.operationKey) ?? input;
  }

  getAutomationRun(tenantId: string, runId: string): AutomationRunRecord | undefined {
    const row = this.db.prepare(`
      SELECT tenant_id as tenantId, id, context_id as contextId, exception_id as exceptionId,
             policy_evaluation_id as policyEvaluationId, candidate_action_type as candidateActionType,
             source_recommendation_id as sourceRecommendationId, source_option_id as sourceOptionId,
             executor, executor_version as executorVersion, operation_key as operationKey,
             status, effect_id as effectId, receipt_id as receiptId,
             trigger_source as triggerSource, triggered_by as triggeredBy,
             created_at as createdAt, completed_at as completedAt
      FROM automation_runs
      WHERE tenant_id = ? AND id = ?
    `).get(tenantId, runId) as {
      tenantId: string;
      id: string;
      contextId: string;
      exceptionId: string;
      policyEvaluationId: string;
      candidateActionType: AutomationRunRecord["candidateActionType"];
      sourceRecommendationId: string | null;
      sourceOptionId: string | null;
      executor: string;
      executorVersion: string;
      operationKey: string;
      status: AutomationRunRecord["status"];
      effectId: string | null;
      receiptId: string | null;
      triggerSource: AutomationRunRecord["triggerSource"];
      triggeredBy: string;
      createdAt: string;
      completedAt: string;
    } | undefined;
    if (!row) return undefined;
    return {
      tenantId: row.tenantId,
      id: row.id,
      contextId: row.contextId,
      exceptionId: row.exceptionId,
      policyEvaluationId: row.policyEvaluationId,
      candidateActionType: row.candidateActionType,
      ...(row.sourceRecommendationId ? { sourceRecommendationId: row.sourceRecommendationId } : {}),
      ...(row.sourceOptionId ? { sourceOptionId: row.sourceOptionId } : {}),
      executor: row.executor,
      executorVersion: row.executorVersion,
      operationKey: row.operationKey,
      status: row.status,
      ...(row.effectId ? { effectId: row.effectId } : {}),
      ...(row.receiptId ? { receiptId: row.receiptId } : {}),
      triggerSource: row.triggerSource,
      triggeredBy: row.triggeredBy,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
    };
  }

  getAutomationRunByOperationKey(tenantId: string, operationKey: string): AutomationRunRecord | undefined {
    const row = this.db.prepare("SELECT id FROM automation_runs WHERE tenant_id = ? AND operation_key = ?").get(tenantId, operationKey) as { id: string } | undefined;
    return row ? this.getAutomationRun(tenantId, row.id) : undefined;
  }

  listAutomationRuns(tenantId: string, contextId: string, exceptionId: string): AutomationRunRecord[] {
    const rows = this.db.prepare(`
      SELECT id FROM automation_runs
      WHERE tenant_id = ? AND context_id = ? AND exception_id = ?
      ORDER BY created_at, id
    `).all(tenantId, contextId, exceptionId) as Array<{ id: string }>;
    return rows.flatMap((row) => {
      const record = this.getAutomationRun(tenantId, row.id);
      return record ? [record] : [];
    });
  }

  saveAutomationReceipt(input: AutomationReceiptRecord): AutomationReceiptRecord {
    const existing = this.getAutomationReceiptByRun(input.tenantId, input.automationRunId);
    if (existing) return existing;
    this.db.prepare(`
      INSERT INTO automation_receipts
        (tenant_id, id, automation_run_id, effect_id, receipt_source, status, payload_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING
    `).run(
      input.tenantId,
      input.id,
      input.automationRunId,
      input.effectId,
      input.receiptSource,
      input.status,
      input.payloadHash,
      input.createdAt,
    );
    return this.getAutomationReceiptByRun(input.tenantId, input.automationRunId) ?? input;
  }

  getAutomationReceipt(tenantId: string, receiptId: string): AutomationReceiptRecord | undefined {
    return this.db.prepare(`
      SELECT tenant_id as tenantId, id, automation_run_id as automationRunId,
             effect_id as effectId, receipt_source as receiptSource, status,
             payload_hash as payloadHash, created_at as createdAt
      FROM automation_receipts
      WHERE tenant_id = ? AND id = ?
    `).get(tenantId, receiptId) as AutomationReceiptRecord | undefined;
  }

  getAutomationReceiptByRun(tenantId: string, automationRunId: string): AutomationReceiptRecord | undefined {
    return this.db.prepare(`
      SELECT tenant_id as tenantId, id, automation_run_id as automationRunId,
             effect_id as effectId, receipt_source as receiptSource, status,
             payload_hash as payloadHash, created_at as createdAt
      FROM automation_receipts
      WHERE tenant_id = ? AND automation_run_id = ?
    `).get(tenantId, automationRunId) as AutomationReceiptRecord | undefined;
  }

  listAutomationReceipts(tenantId: string, contextId: string, exceptionId: string): AutomationReceiptRecord[] {
    return this.db.prepare(`
      SELECT receipt.tenant_id as tenantId, receipt.id, receipt.automation_run_id as automationRunId,
             receipt.effect_id as effectId, receipt.receipt_source as receiptSource, receipt.status,
             receipt.payload_hash as payloadHash, receipt.created_at as createdAt
      FROM automation_receipts receipt
      JOIN automation_runs run
        ON run.tenant_id = receipt.tenant_id AND run.id = receipt.automation_run_id
      WHERE receipt.tenant_id = ? AND run.context_id = ? AND run.exception_id = ?
      ORDER BY receipt.created_at, receipt.id
    `).all(tenantId, contextId, exceptionId) as AutomationReceiptRecord[];
  }

  saveInternalWorkItem(input: InternalWorkItemRecord): InternalWorkItemRecord {
    const existing = this.getInternalWorkItem(input.tenantId, input.id);
    if (existing) return existing;
    this.db.prepare(`
      INSERT INTO internal_work_items
        (tenant_id, id, context_id, exception_id, kind, source, action_type,
         title, description, status, created_by, created_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING
    `).run(
      input.tenantId,
      input.id,
      input.contextId,
      input.exceptionId,
      input.kind,
      input.source,
      input.actionType,
      input.title,
      input.description,
      input.status,
      input.createdBy,
      input.createdAt,
      json(input.metadata),
    );
    return this.getInternalWorkItem(input.tenantId, input.id) ?? input;
  }

  getInternalWorkItem(tenantId: string, workItemId: string): InternalWorkItemRecord | undefined {
    const row = this.db.prepare(`
      SELECT tenant_id as tenantId, id, context_id as contextId, exception_id as exceptionId,
             kind, source, action_type as actionType, title, description, status,
             created_by as createdBy, created_at as createdAt, metadata_json as metadataJson
      FROM internal_work_items
      WHERE tenant_id = ? AND id = ?
    `).get(tenantId, workItemId) as {
      tenantId: string;
      id: string;
      contextId: string;
      exceptionId: string;
      kind: InternalWorkItemRecord["kind"];
      source: InternalWorkItemRecord["source"];
      actionType: InternalWorkItemRecord["actionType"];
      title: string;
      description: string;
      status: InternalWorkItemRecord["status"];
      createdBy: string;
      createdAt: string;
      metadataJson: string;
    } | undefined;
    return row ? {
      tenantId: row.tenantId,
      id: row.id,
      contextId: row.contextId,
      exceptionId: row.exceptionId,
      kind: row.kind,
      source: row.source,
      actionType: row.actionType,
      title: row.title,
      description: row.description,
      status: row.status,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      metadata: parseJson<Record<string, unknown>>(row.metadataJson),
    } : undefined;
  }

  listInternalWorkItems(
    tenantId: string,
    filters: { status?: InternalWorkItemStatus; kind?: InternalWorkItemKind; contextId?: string; exceptionId?: string } = {},
  ): InternalWorkItemRecord[] {
    const conditions = ["tenant_id = ?"];
    const params: unknown[] = [tenantId];
    if (filters.status) { conditions.push("status = ?"); params.push(filters.status); }
    if (filters.kind) { conditions.push("kind = ?"); params.push(filters.kind); }
    if (filters.contextId) { conditions.push("context_id = ?"); params.push(filters.contextId); }
    if (filters.exceptionId) { conditions.push("exception_id = ?"); params.push(filters.exceptionId); }
    const rows = this.db.prepare(`
      SELECT id FROM internal_work_items
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at, id
    `).all(...params) as Array<{ id: string }>;
    return rows.flatMap((row) => {
      const item = this.getInternalWorkItem(tenantId, row.id);
      return item ? [item] : [];
    });
  }

  getResolutionReceiptByOperation(tenantId: string, resolutionCaseId: string, actionId: string, operationKey: string): ResolutionReceipt | undefined {
    return this.db.prepare(`
      SELECT tenant_id as tenantId, resolution_case_id as resolutionCaseId, action_id as actionId,
             operation_key as operationKey, external_request_id as externalRequestId,
             receipt, receipt_source as receiptSource, status, payload_hash as payloadHash,
             created_at as createdAt
      FROM resolution_action_receipts
      WHERE tenant_id = ? AND resolution_case_id = ? AND action_id = ? AND operation_key = ?
    `).get(tenantId, resolutionCaseId, actionId, operationKey) as ResolutionReceipt | undefined;
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

  listContexts(tenantId: string): FulfillmentContext[] {
    const rows = this.db.prepare(`
      SELECT tenant_id as tenantId, id, business_key as businessKey, context_type as contextType,
             status, opened_at as openedAt, updated_at as updatedAt, metadata_json as metadataJson
      FROM fulfillment_contexts
      WHERE tenant_id = ?
      ORDER BY opened_at, id
    `).all(tenantId) as Array<Omit<FulfillmentContext, "metadata"> & { metadataJson: string }>;
    return rows.map((row) => ({
      tenantId: row.tenantId,
      id: row.id,
      businessKey: row.businessKey,
      contextType: row.contextType,
      status: row.status,
      openedAt: row.openedAt,
      updatedAt: row.updatedAt,
      metadata: parseJson<JsonRecord>(row.metadataJson),
    }));
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

  private getStableException(tenantId: string, contextId: string, ruleId: string, matchKey: string): V2Exception | undefined {
    const row = this.db.prepare(`
      SELECT id FROM exceptions
      WHERE tenant_id = ? AND context_id = ? AND rule_id = ? AND match_key = ?
    `).get(tenantId, contextId, ruleId, matchKey) as { id: string } | undefined;
    return row ? this.listExceptions(tenantId, contextId).find((item) => item.id === row.id) : undefined;
  }

  getRuleDefinition(tenantId: string, ruleId: string): RuleDefinition | undefined {
    const row = this.db.prepare(`
      SELECT tenant_id as tenantId, id, code, name, description,
             exception_type as exceptionType, enabled, created_at as createdAt,
             metadata_json as metadataJson
      FROM rule_definitions WHERE tenant_id = ? AND id = ?
    `).get(tenantId, ruleId) as (Omit<RuleDefinition, "metadata" | "enabled"> & { enabled: number; metadataJson: string }) | undefined;
    return row ? {
      tenantId: row.tenantId,
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      exceptionType: row.exceptionType,
      enabled: Boolean(row.enabled),
      createdAt: row.createdAt,
      metadata: parseJson<JsonRecord>(row.metadataJson),
    } : undefined;
  }

  getRuleVersionById(tenantId: string, ruleVersionId: string): RuleVersion | undefined {
    const row = this.db.prepare(`
      SELECT tenant_id as tenantId, id, rule_id as ruleId, version, status,
             config_json as configJson, content_hash as contentHash, created_at as createdAt
      FROM rule_versions WHERE tenant_id = ? AND id = ?
    `).get(tenantId, ruleVersionId) as (Omit<RuleVersion, "config"> & { configJson: string }) | undefined;
    return row ? {
      tenantId: row.tenantId,
      id: row.id,
      ruleId: row.ruleId,
      version: row.version,
      status: row.status,
      config: parseJson<RuleVersion["config"]>(row.configJson),
      contentHash: row.contentHash,
      createdAt: row.createdAt,
    } : undefined;
  }

  private getRuleVersion(tenantId: string, ruleId: string, version: string): RuleVersion | undefined {
    const row = this.db.prepare(`
      SELECT tenant_id as tenantId, id, rule_id as ruleId, version, status,
             config_json as configJson, content_hash as contentHash, created_at as createdAt
      FROM rule_versions WHERE tenant_id = ? AND rule_id = ? AND version = ?
    `).get(tenantId, ruleId, version) as (Omit<RuleVersion, "config"> & { configJson: string }) | undefined;
    return row ? {
      tenantId: row.tenantId,
      id: row.id,
      ruleId: row.ruleId,
      version: row.version,
      status: row.status,
      config: parseJson<RuleVersion["config"]>(row.configJson),
      contentHash: row.contentHash,
      createdAt: row.createdAt,
    } : undefined;
  }

  private getRuleEvaluationByInput(tenantId: string, contextId: string, ruleVersionId: string, inputHash: string): RuleEvaluation | undefined {
    const row = this.db.prepare(`
      SELECT tenant_id as tenantId, id, context_id as contextId, rule_id as ruleId,
             rule_version_id as ruleVersionId, status, observations_json as observationsJson,
             metrics_json as metricsJson, input_hash as inputHash, match_key as matchKey,
             evaluated_at as evaluatedAt, metadata_json as metadataJson
      FROM rule_evaluations
      WHERE tenant_id = ? AND context_id = ? AND rule_version_id = ? AND input_hash = ?
    `).get(tenantId, contextId, ruleVersionId, inputHash) as {
      tenantId: string;
      id: string;
      contextId: string;
      ruleId: string;
      ruleVersionId: string;
      status: RuleEvaluation["status"];
      observationsJson: string;
      metricsJson: string;
      inputHash: string;
      matchKey: string;
      evaluatedAt: string;
      metadataJson: string;
    } | undefined;
    return row ? {
      tenantId: row.tenantId,
      id: row.id,
      contextId: row.contextId,
      ruleId: row.ruleId,
      ruleVersionId: row.ruleVersionId,
      status: row.status,
      observations: parseJson<RuleEvaluation["observations"]>(row.observationsJson),
      metrics: parseJson<RuleEvaluation["metrics"]>(row.metricsJson),
      inputHash: row.inputHash,
      matchKey: row.matchKey,
      evaluatedAt: row.evaluatedAt,
      metadata: parseJson<JsonRecord>(row.metadataJson),
    } : undefined;
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

  getEventByIdempotency(tenantId: string, sourceSystemId: string, idempotencyKey: string): FulfillmentEvent | undefined {
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
