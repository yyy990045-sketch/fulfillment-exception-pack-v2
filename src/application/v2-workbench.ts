import type {
  BusinessEntityType,
  FulfillmentEvent,
  SourceDocument,
  SourceSystem,
  V2Exception,
  V2SqliteStore,
} from "../domain/v2/index.js";
import {
  v2EntityLabel,
  v2EventLabel,
  v2ExceptionLabel,
  v2FieldLabel,
} from "./v2-workbench-labels.js";

const THREAD_ORDER: BusinessEntityType[] = [
  "quote",
  "sales_order",
  "production_order",
  "quality_event",
  "shipment",
  "receivable",
  "payment",
  "complaint",
];

const STAGE_FACTS: Record<BusinessEntityType, Array<{ key: string; field: string; label?: string }>> = {
  quote: [{ key: "qty", field: "qty" }],
  contract: [],
  sales_order: [{ key: "qty", field: "qty" }],
  production_order: [
    { key: "plannedQty", field: "plannedQty", label: "计划完成" },
    { key: "completedQty", field: "completedQty", label: "生产完成" },
  ],
  quality_event: [
    { key: "inspectedQty", field: "inspectedQty", label: "检验数量" },
    { key: "passedQty", field: "passedQty", label: "合格数量" },
    { key: "failedQty", field: "failedQty", label: "未通过数量" },
  ],
  shipment: [{ key: "qty", field: "qty" }],
  receivable: [{ key: "amount", field: "amount" }],
  payment: [{ key: "amount", field: "amount" }],
  complaint: [{ key: "claimedReceivedQty", field: "claimedReceivedQty", label: "客户主张收到" }],
};

const RULE_STAGE_KEYS: Record<string, BusinessEntityType[]> = {
  "FULFILLMENT.QUOTE_ORDER_QUANTITY_MISMATCH": ["quote", "sales_order"],
  "FULFILLMENT.ORDER_PRODUCTION_COMPLETION_SHORTFALL": ["sales_order", "production_order"],
  "MANUFACTURING.ORDER_PRODUCTION_COMPLETION_SHORTFALL": ["sales_order", "production_order"],
  "FULFILLMENT.QUALITY_NONCONFORMING_QUANTITY_DETECTED": ["quality_event"],
  "MANUFACTURING.QUALITY_NONCONFORMING_QUANTITY_DETECTED": ["quality_event"],
  "FULFILLMENT.QUALITY_SHIPMENT_QUANTITY_MISMATCH": ["quality_event", "shipment"],
  "MANUFACTURING.QUALITY_SHIPMENT_QUANTITY_MISMATCH": ["quality_event", "shipment"],
  "FULFILLMENT.SHIPMENT_QUANTITY_SHORTFALL": ["sales_order", "shipment"],
  "FULFILLMENT.PAYMENT_BALANCE_OUTSTANDING": ["receivable", "payment"],
  "FULFILLMENT.CUSTOMER_RECEIPT_CLAIM_MISMATCH": ["shipment", "complaint"],
};

const RULE_RELATION_LABELS: Record<string, string> = {
  "FULFILLMENT.QUOTE_ORDER_QUANTITY_MISMATCH": "报价与订单数量一致",
  "MANUFACTURING.ORDER_PRODUCTION_COMPLETION_SHORTFALL": "订单与生产完成数量一致",
  "FULFILLMENT.ORDER_PRODUCTION_COMPLETION_SHORTFALL": "订单与生产完成数量一致",
  "MANUFACTURING.QUALITY_SHIPMENT_QUANTITY_MISMATCH": "质检合格数量与发货数量一致",
  "FULFILLMENT.QUALITY_SHIPMENT_QUANTITY_MISMATCH": "质检合格数量与发货数量一致",
};

function latestEvidence(store: V2SqliteStore, tenantId: string, contextId: string, entityId: string, field: string) {
  return store.listEvidence(tenantId, contextId)
    .filter((item) => item.entityId === entityId && item.field === field && item.support === "supported")
    .sort((left, right) =>
      right.observedAt.localeCompare(left.observedAt) ||
      right.createdAt.localeCompare(left.createdAt) ||
      right.id.localeCompare(left.id),
    )[0];
}

function latestEvent(events: FulfillmentEvent[]) {
  return [...events].sort((left, right) =>
    right.occurredAt.localeCompare(left.occurredAt) ||
    right.recordedAt.localeCompare(left.recordedAt) ||
    right.id.localeCompare(left.id),
  )[0];
}

function sourceSystemForEntity(
  entityId: string,
  references: ReturnType<V2SqliteStore["replayContext"]>["entityReferences"],
  sourceSystems: SourceSystem[],
) {
  const sourceId = references.find((item) => item.entityId === entityId)?.sourceSystemId;
  return sourceId ? sourceSystems.find((item) => item.id === sourceId) : undefined;
}

function sourceDocumentForEntity(
  entityId: string,
  documents: SourceDocument[],
) {
  return documents.find((item) => item.entityId === entityId);
}

function stageState(exceptionIds: Set<string>, entityId: string) {
  return exceptionIds.has(entityId) ? "exception" as const : "normal" as const;
}

function exceptionSummary(
  store: V2SqliteStore,
  tenantId: string,
  exception: V2Exception,
  entityTypeById: Map<string, BusinessEntityType>,
) {
  const bundle = store.getExceptionEvidenceBundle(tenantId, exception.id);
  return {
    id: exception.id,
    code: exception.code,
    label: v2ExceptionLabel(exception.code),
    severity: exception.severity,
    status: exception.status,
    title: exception.title,
    summary: exception.summary,
    metrics: exception.metrics,
    matchKey: exception.matchKey,
    ruleId: exception.ruleId,
    ruleVersionId: exception.ruleVersionId,
    latestRuleEvaluationId: exception.latestRuleEvaluationId,
    entityIds: exception.entityIds,
    stageKeys: THREAD_ORDER.filter((stage) => exception.entityIds.some((entityId) => entityTypeById.get(entityId) === stage)),
    evidenceCount: bundle?.evidence.length ?? exception.evidenceIds.length,
    sourceSystemCount: bundle?.sourceSystems.length ?? 0,
    createdAt: exception.createdAt,
    lastDetectedAt: exception.lastDetectedAt,
  };
}

export function buildV2WorkbenchView(
  store: V2SqliteStore,
  tenantId: string,
  contextId: string,
) {
  const replay = store.replayContext(tenantId, contextId);
  if (!replay.context) return undefined;

  const evaluations = store.listRuleEvaluations(tenantId, contextId);
  const exceptions = store.listExceptions(tenantId, contextId);
  const resolutionCases = store.listResolutionCases(tenantId, contextId);
  const exceptionEntityIds = new Set(exceptions.flatMap((exception) => exception.entityIds));
  const entityTypeById = new Map(replay.entities.map((entity) => [entity.id, entity.entityType]));
  const definitions = store.listEnabledRuleDefinitions(tenantId);

  const thread = THREAD_ORDER.map((stage) => {
    const entity = replay.entities.find((item) => item.entityType === stage);
    if (!entity) return undefined;
    const facts = STAGE_FACTS[stage].flatMap((fact) => {
      const evidence = latestEvidence(store, tenantId, contextId, entity.id, fact.field);
      return evidence ? [{
        key: fact.key,
        label: fact.label ?? v2FieldLabel(fact.key),
        field: fact.field,
        value: evidence.value,
        valueType: evidence.valueType,
        evidenceId: evidence.id,
        observedAt: evidence.observedAt,
      }] : [];
    });
    const sourceSystem = sourceSystemForEntity(entity.id, replay.entityReferences, replay.sourceSystems);
    const sourceDocument = sourceDocumentForEntity(entity.id, replay.documents);
    const event = latestEvent(replay.events.filter((item) => item.entityId === entity.id));
    return {
      key: stage,
      label: v2EntityLabel(stage),
      entityId: entity.id,
      businessKey: entity.businessKey,
      sourceSystem: sourceSystem ? { id: sourceSystem.id, name: sourceSystem.name, systemType: sourceSystem.systemType } : null,
      sourceDocument: sourceDocument ? {
        id: sourceDocument.id,
        externalDocumentId: sourceDocument.externalDocumentId,
        documentType: sourceDocument.documentType,
        version: sourceDocument.version,
      } : null,
      latestEvent: event ? { id: event.id, eventType: event.eventType, label: v2EventLabel(event.eventType), occurredAt: event.occurredAt } : null,
      occurredAt: event?.occurredAt ?? facts[0]?.observedAt ?? null,
      facts,
      state: stageState(exceptionEntityIds, entity.id),
    };
  }).filter((stage): stage is NonNullable<typeof stage> => Boolean(stage));

  const rules = evaluations.map((evaluation) => {
    const definition = definitions.find((item) => item.id === evaluation.ruleId);
    const version = store.getRuleVersionById(tenantId, evaluation.ruleVersionId);
    const code = definition?.code ?? evaluation.ruleId;
    const statusLabel = evaluation.status === "matched" ? "命中" : evaluation.status === "not_matched" ? "未命中" : evaluation.status;
    return {
      id: evaluation.id,
      code,
      label: evaluation.status === "not_matched"
        ? RULE_RELATION_LABELS[code] ?? definition?.name ?? code
        : v2ExceptionLabel(definition?.exceptionType ?? code),
      status: evaluation.status,
      statusLabel,
      matched: evaluation.status === "matched",
      stageKeys: RULE_STAGE_KEYS[(definition?.code ?? evaluation.ruleId)] ?? [],
      metrics: evaluation.metrics,
      observations: evaluation.observations,
      ruleId: evaluation.ruleId,
      ruleVersion: version?.version ?? evaluation.ruleVersionId,
      evaluatedAt: evaluation.evaluatedAt,
    };
  });

  const exceptionSummaries = exceptions.map((exception) => exceptionSummary(store, tenantId, exception, entityTypeById));
  const defaultException = exceptionSummaries.find((item) => item.code === "CUSTOMER_RECEIPT_CLAIM_MISMATCH")
    ?? exceptionSummaries[0]
    ?? null;

  return {
    context: {
      id: replay.context.id,
      businessKey: replay.context.businessKey,
      contextType: replay.context.contextType,
      status: replay.context.status,
      openedAt: replay.context.openedAt,
      updatedAt: replay.context.updatedAt,
    },
    stats: {
      sourceSystems: replay.sourceSystems.length,
      entities: replay.entities.length,
      documents: replay.documents.length,
      events: replay.events.length,
      evidence: replay.evidence.length,
      ruleEvaluations: evaluations.length,
      matchedRules: evaluations.filter((item) => item.status === "matched").length,
      notMatchedRules: evaluations.filter((item) => item.status === "not_matched").length,
      exceptions: exceptions.length,
      resolutionCases: resolutionCases.length,
    },
    thread,
    rules,
    exceptions: exceptionSummaries,
    resolutionCases: resolutionCases.map((item) => ({
      id: item.id,
      exceptionId: item.exceptionId,
      status: item.status,
      ownerRole: item.ownerRole,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
    truthfulness: {
      manufacturingFacts: "demo_sources",
      ruleEngine: "deterministic",
      groundedAi: "provider_dependent",
      openSupOSRuntime: "not_verified",
      openAiApi: "not_verified",
    },
    defaultExceptionId: defaultException?.id ?? null,
  };
}
