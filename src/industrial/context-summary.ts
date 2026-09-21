/**
 * Industrial Context Summary + Traceability。
 *
 * 两件事：
 *   1. 把一个业务 Context 的工业归属「摊平」成可消费字段：
 *      enterprise / site / area / line / sourceSystems[] / entities[] / eventCount / evidenceCount / exceptionCount。
 *      现有 Context 页面直接消费这些字段即可，不需要理解 ISA-95。
 *   2. 建立**可查询**的履约链（不引入图数据库）：
 *      SalesOrder → ProductionOrder → QualityInspection → Shipment → Invoice → Receivable → Payment → Complaint。
 *      链条靠既有 Context model 的实体 + 事件 + 证据 + 来源引用推导，
 *      因此「一个 Exception 向前能追到哪条原始事实」是查出来的，不是写死的。
 */
import type {
  BusinessEntityType,
  FulfillmentContext,
  SourceDocument,
  SourceSystem,
  V2Evidence,
  V2SqliteStore,
} from "../domain/v2/index.js";
import { IndustrialSemanticError, type IndustrialContextSummary, type IndustrialHierarchy, type IndustrialSpace, type IndustrialTraceNode } from "./types.js";
import { DEMO_MANUFACTURING_HIERARCHY, industrialSpaceRootPath, parseIndustrialSpace, resolveIndustrialSpace } from "./hierarchy.js";
import { DOMAIN_FOR_ENTITY_TYPE } from "./uns-topic.js";

/** 履约链顺序：与 workbench 的 thread 顺序一致，唯一一处定义。 */
export const INDUSTRIAL_TRACE_ORDER: BusinessEntityType[] = [
  "quote",
  "sales_order",
  "production_order",
  "quality_event",
  "shipment",
  "invoice",
  "receivable",
  "payment",
  "complaint",
];

export function industrialSpaceOfContext(context: FulfillmentContext): IndustrialSpace | null {
  return parseIndustrialSpace(context.metadata.unsSpace);
}

function latestOccurredAt(events: Array<{ occurredAt: string }>) {
  return [...events].map((item) => item.occurredAt).sort().at(-1) ?? null;
}

function buildTrace(input: {
  entities: ReturnType<V2SqliteStore["replayContext"]>["entities"];
  events: ReturnType<V2SqliteStore["replayContext"]>["events"];
  evidence: V2Evidence[];
  entityReferences: ReturnType<V2SqliteStore["replayContext"]>["entityReferences"];
  sourceSystems: SourceSystem[];
}): IndustrialTraceNode[] {
  const sourceSystemById = new Map(input.sourceSystems.map((item) => [item.id, item]));
  return INDUSTRIAL_TRACE_ORDER.flatMap((entityType, position) => {
    const entity = input.entities.find((item) => item.entityType === entityType);
    if (!entity) return [];
    const events = input.events.filter((item) => item.entityId === entity.id);
    const evidence = input.evidence.filter((item) => item.entityId === entity.id);
    // 来源系统优先取 entityReference（fixture 路径），否则回落到证据的 sourceSystemId
    // （connector 摄取路径不落 entityReference，但每条证据都带来源系统，二者都不会编造来源）。
    const referenced = input.entityReferences.find((item) => item.entityId === entity.id)?.sourceSystemId;
    const sourceSystemIds = referenced
      ? [referenced]
      : [...new Set(evidence.map((item) => item.sourceSystemId))].sort();
    const sourceSystemId = sourceSystemIds.length === 1 ? sourceSystemIds[0]! : null;
    return [{
      position,
      entityType,
      entityId: entity.id,
      businessKey: entity.businessKey,
      sourceSystemId,
      sourceSystemIds,
      sourceSystemType: sourceSystemId ? sourceSystemById.get(sourceSystemId)?.systemType ?? null : null,
      domain: DOMAIN_FOR_ENTITY_TYPE[entityType] ?? null,
      occurredAt: latestOccurredAt(events),
      eventCount: events.length,
      evidenceIds: evidence.map((item) => item.id).sort(),
    }];
  });
}

/** 从摄取账本的 locator 里读出本 Context 实际涉及到的设备（逐事件记录，不猜设备）。 */
function ledgerFactsForEvidence(store: V2SqliteStore, tenantId: string, evidenceIds: Set<string>) {
  const mappingVersions = new Set<string>();
  const equipmentIds = new Set<string>();
  for (const installation of store.listConnectorInstallations(tenantId)) {
    for (const record of store.listConnectorSourceRecords(tenantId, installation.id)) {
      if (!record.evidenceRefs.some((id) => evidenceIds.has(id))) continue;
      mappingVersions.add(`${record.mappingId}@${record.mappingVersion}`);
      const equipmentId = record.locator.equipmentId;
      if (typeof equipmentId === "string" && equipmentId) equipmentIds.add(equipmentId);
    }
  }
  return { mappingVersions: [...mappingVersions].sort(), equipmentIds: [...equipmentIds].sort() };
}

export function buildIndustrialContextSummary(
  store: V2SqliteStore,
  tenantId: string,
  contextId: string,
  hierarchy: IndustrialHierarchy = DEMO_MANUFACTURING_HIERARCHY,
): IndustrialContextSummary | undefined {
  const replay = store.replayContext(tenantId, contextId);
  if (!replay.context) return undefined;
  const boundSpace = industrialSpaceOfContext(replay.context);
  // Context 级空间只声明到 Line：一个 Context 会跨加工中心/质检工位/包装工位，
  // 声明到某台设备就是编造。设备粒度由每条事件的 Canonical Event 与账本 locator 承载。
  const space: IndustrialSpace | null = boundSpace
    ? { enterpriseId: boundSpace.enterpriseId, siteId: boundSpace.siteId, areaId: boundSpace.areaId, lineId: boundSpace.lineId }
    : null;
  if (space) resolveIndustrialSpace(hierarchy, space);
  const evaluations = store.listRuleEvaluations(tenantId, contextId);
  const exceptions = store.listExceptions(tenantId, contextId);
  const trace = buildTrace({
    entities: replay.entities,
    events: replay.events,
    evidence: replay.evidence,
    entityReferences: replay.entityReferences,
    sourceSystems: replay.sourceSystems,
  });
  const ledgerFacts = ledgerFactsForEvidence(store, tenantId, new Set(replay.evidence.map((item) => item.id)));
  return {
    schemaVersion: "industrial-context-summary/v1",
    tenantId,
    contextId,
    businessKey: replay.context.businessKey,
    space,
    unsRootPath: space ? industrialSpaceRootPath(space) : null,
    equipmentIds: ledgerFacts.equipmentIds,
    environment: "SIMULATED INDUSTRIAL ENVIRONMENT",
    sourceSystems: replay.sourceSystems
      .map((item) => ({ id: item.id, name: item.name, systemType: item.systemType, authorityLevel: item.authorityLevel }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    entities: replay.entities
      .map((item) => ({
        id: item.id,
        entityType: item.entityType,
        businessKey: item.businessKey,
        eventCount: replay.events.filter((event) => event.entityId === item.id).length,
      }))
      .sort((left, right) => left.entityType.localeCompare(right.entityType) || left.businessKey.localeCompare(right.businessKey)),
    eventCount: replay.events.length,
    evidenceCount: replay.evidence.length,
    exceptionCount: exceptions.length,
    evaluationCount: evaluations.length,
    trace,
    mappingVersions: ledgerFacts.mappingVersions,
    truthfulness: {
      environment: "simulated_industrial_environment",
      realFactory: false,
      realMes: false,
      realErp: false,
      realQms: false,
      realWms: false,
    },
  };
}

export type IndustrialFactTrace = {
  exceptionId: string;
  contextId: string;
  code: string;
  nodes: Array<IndustrialTraceNode & {
    facts: Array<{
      field: string;
      value: V2Evidence["value"];
      valueType: V2Evidence["valueType"];
      evidenceId: string;
      observedAt: string;
      role: string;
      sourceSystemId: string;
      sourceDocument: { id: string; externalDocumentId: string; documentType: string; version: string } | null;
      locator: Record<string, unknown>;
    }>;
  }>;
};

/**
 * 「这个结论的数据来自哪个模拟工业系统」——一条 Exception 的前向追溯。
 * 输出严格来自证据包（ExceptionEvidenceBundle），不含任何推断值。
 */
export function buildIndustrialExceptionTrace(
  store: V2SqliteStore,
  tenantId: string,
  contextId: string,
  exceptionId: string,
): IndustrialFactTrace | undefined {
  const exception = store.listExceptions(tenantId, contextId).find((item) => item.id === exceptionId);
  if (!exception) return undefined;
  const bundle = store.getExceptionEvidenceBundle(tenantId, exceptionId);
  if (!bundle) throw new IndustrialSemanticError("EXCEPTION_EVIDENCE_BUNDLE_MISSING", exceptionId);
  const replay = store.replayContext(tenantId, contextId);
  const documentById = new Map<string, SourceDocument>(replay.documents.map((item) => [item.id, item]));
  const entityTypeById = new Map(replay.entities.map((item) => [item.id, item.entityType]));
  const trace = buildTrace({
    entities: replay.entities,
    events: replay.events,
    evidence: replay.evidence,
    entityReferences: replay.entityReferences,
    sourceSystems: replay.sourceSystems,
  });
  const nodes = trace.flatMap((node) => {
    const bundleEvidence = bundle.evidence.filter((item) => item.entityId === node.entityId);
    if (!bundleEvidence.length) return [];
    return [{
      ...node,
      facts: bundleEvidence
        .map((item) => {
          const document = documentById.get(item.sourceDocumentId) ?? null;
          return {
            field: item.field,
            value: item.value,
            valueType: item.valueType,
            evidenceId: item.id,
            observedAt: item.observedAt,
            role: String((item as { role?: string }).role ?? "context"),
            sourceSystemId: item.sourceSystemId,
            sourceDocument: document
              ? { id: document.id, externalDocumentId: document.externalDocumentId, documentType: document.documentType, version: document.version }
              : null,
            locator: item.locator as unknown as Record<string, unknown>,
          };
        })
        .sort((left, right) => left.field.localeCompare(right.field)),
    }];
  });
  if (!nodes.some((node) => node.entityId && entityTypeById.has(node.entityId))) {
    throw new IndustrialSemanticError("EXCEPTION_TRACE_UNRESOLVED", exceptionId);
  }
  return { exceptionId, contextId, code: exception.code, nodes };
}
