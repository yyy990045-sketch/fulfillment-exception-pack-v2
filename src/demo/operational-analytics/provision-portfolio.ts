import { createHash } from "node:crypto";
import {
  approveResolutionCase,
  closeResolutionCase,
  createBusinessEntity,
  createEvidence,
  createFulfillmentContext,
  createFulfillmentEvent,
  createSourceDocument,
  createSourceSystem,
  acceptExceptionForResolution,
  evaluateContextRules,
  executeResolutionCase,
  proposeResolutionCase,
  reviewResolution,
  submitResolutionCase,
  type V2SqliteStore,
} from "../../domain/v2/index.js";
import { bindPackContext, manufacturingFulfillmentPack, registerBuiltInSolutionPacks } from "../../solution-packs/index.js";
import { OPERATIONAL_PORTFOLIO, type OperationalPortfolioSpec } from "./portfolio-spec.js";

const tenantId = "demo-manufacturing";
const qualityActor = { subjectId: "demo-quality-owner", displayName: "品质负责人", roles: ["品质负责人"] };
const salesDirectorActor = { subjectId: "demo-sales-director", displayName: "销售总监", roles: ["销售总监"] };
const generalManagerActor = { subjectId: "demo-general-manager", displayName: "总经理", roles: ["总经理"] };
const sourceSystems = [
  { id: "CRM-OPS", systemType: "crm" as const, authorityLevel: "authoritative" as const },
  { id: "ERP-OPS", systemType: "erp" as const, authorityLevel: "system_of_record" as const },
  { id: "MES-OPS", systemType: "mes" as const, authorityLevel: "system_of_record" as const },
  { id: "QMS-OPS", systemType: "qms" as const, authorityLevel: "system_of_record" as const },
  { id: "WMS-OPS", systemType: "wms" as const, authorityLevel: "authoritative" as const },
  { id: "FINANCE-OPS", systemType: "finance" as const, authorityLevel: "system_of_record" as const },
  { id: "SERVICE-OPS", systemType: "manual" as const, authorityLevel: "contributing" as const },
];

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function dateAt(openedAt: string, days: number) {
  return new Date(Date.parse(openedAt) + days * 86400000).toISOString();
}

function saveScenario(store: V2SqliteStore, spec: OperationalPortfolioSpec) {
  const contextId = `ctx-${spec.businessKey.toLowerCase()}`;
  const entities = [
    { type: "quote" as const, key: `QT-${spec.businessKey}`, value: spec.quoteQty, field: "qty", source: "CRM-OPS", documentType: "quote", day: 0, event: "QUOTE_CREATED" as const },
    { type: "sales_order" as const, key: spec.businessKey, value: spec.orderQty, field: "qty", source: "ERP-OPS", documentType: "sales_order", day: 0, event: "ORDER_CREATED" as const },
    { type: "production_order" as const, key: `MO-${spec.businessKey}`, value: spec.productionPlannedQty, field: "plannedQty", source: "MES-OPS", documentType: "production_order", day: 2, event: "PRODUCTION_STARTED" as const },
    { type: "quality_event" as const, key: `QC-${spec.businessKey}`, value: spec.qualityInspectedQty, field: "inspectedQty", source: "QMS-OPS", documentType: "quality_inspection", day: 4, event: "QUALITY_INSPECTED" as const },
    { type: "shipment" as const, key: `SH-${spec.businessKey}`, value: spec.shipmentQty, field: "qty", source: "WMS-OPS", documentType: "shipment", day: 5, event: "SHIPMENT_DISPATCHED" as const },
    { type: "receivable" as const, key: `AR-${spec.businessKey}`, value: spec.receivableAmount, field: "amount", source: "FINANCE-OPS", documentType: "receivable", day: 6, event: "RECEIVABLE_CREATED" as const },
    { type: "payment" as const, key: `PAY-${spec.businessKey}`, value: spec.paymentAmount, field: "amount", source: "FINANCE-OPS", documentType: "payment", day: 7, event: "PAYMENT_RECEIVED" as const },
    { type: "complaint" as const, key: `CP-${spec.businessKey}`, value: spec.claimedReceivedQty, field: "claimedReceivedQty", source: "SERVICE-OPS", documentType: "complaint", day: 8, event: "COMPLAINT_OPENED" as const },
  ];
  const context = createFulfillmentContext({
    id: contextId,
    tenantId,
    businessKey: spec.businessKey,
    contextType: "sales_order",
    status: "active",
    openedAt: spec.openedAt,
    updatedAt: spec.openedAt,
    metadata: { synthetic: true, portfolio: "operational-analytics" },
  });
  store.saveContext(context);
  for (const source of sourceSystems) {
    store.saveSourceSystem(createSourceSystem({
      id: source.id,
      tenantId,
      name: source.id,
      systemType: source.systemType,
      authorityLevel: source.authorityLevel,
      status: "active",
      metadata: { synthetic: true },
    }));
  }
  for (const item of entities) {
    const entityId = `entity-${spec.businessKey.toLowerCase()}-${item.type}`;
    const documentId = `doc-${spec.businessKey.toLowerCase()}-${item.documentType}`;
    const eventId = `event-${spec.businessKey.toLowerCase()}-${item.event.toLowerCase()}`;
    const observedAt = dateAt(spec.openedAt, item.day);
    const entity = createBusinessEntity({
      id: entityId,
      tenantId,
      contextId,
      entityType: item.type,
      businessKey: item.key,
      attributes: { [item.field]: item.value },
      createdAt: observedAt,
      updatedAt: observedAt,
    });
    store.saveBusinessEntity(entity);
    store.saveEntityReference({
      id: `ref-${spec.businessKey.toLowerCase()}-${item.type}`,
      tenantId,
      entityId,
      sourceSystemId: item.source,
      externalId: item.key,
      externalType: item.type,
      createdAt: observedAt,
    });
    const document = createSourceDocument({
      id: documentId,
      tenantId,
      sourceSystemId: item.source,
      contextId,
      entityId,
      externalDocumentId: item.key,
      documentType: item.documentType,
      contentHash: hash({ businessKey: spec.businessKey, documentType: item.documentType, value: item.value }),
      receivedAt: observedAt,
      effectiveAt: observedAt,
      version: "v1",
      metadata: { synthetic: true },
    });
    store.saveSourceDocument(document);
    store.appendEvent(createFulfillmentEvent({
      id: eventId,
      tenantId,
      contextId,
      entityId,
      eventType: item.event,
      occurredAt: observedAt,
      recordedAt: observedAt,
      sourceSystemId: item.source,
      sourceDocumentId: documentId,
      payload: { [item.field]: item.value },
      idempotencyKey: `${spec.businessKey}:${item.event}:v1`,
    }));
    store.saveEvidence(createEvidence({
      id: `evidence-${spec.businessKey.toLowerCase()}-${item.type}-${item.field}`,
      tenantId,
      contextId,
      sourceSystemId: item.source,
      sourceDocumentId: documentId,
      sourceVersion: "v1",
      entityId,
      eventId,
      field: item.field,
      value: item.value,
      valueType: item.field === "amount" ? "currency" : "number",
      locator: { fileName: `${item.key}.csv`, row: 2 },
      quote: `${item.field}=${item.value}`,
      confidence: 1,
      support: "supported",
      observedAt,
      createdAt: observedAt,
      metadata: { synthetic: true },
    }));
  }
  for (const extra of [
    { field: "completedQty", value: spec.productionCompletedQty, entityType: "production_order" as const, day: 3 },
    { field: "passedQty", value: spec.qualityPassedQty, entityType: "quality_event" as const, day: 4 },
    { field: "failedQty", value: spec.qualityInspectedQty - spec.qualityPassedQty, entityType: "quality_event" as const, day: 4 },
  ]) {
    const entityId = `entity-${spec.businessKey.toLowerCase()}-${extra.entityType}`;
    const documentId = `doc-${spec.businessKey.toLowerCase()}-${extra.entityType === "production_order" ? "production_order" : "quality_inspection"}`;
    const eventId = `event-${spec.businessKey.toLowerCase()}-${extra.field.toLowerCase()}`;
    const observedAt = dateAt(spec.openedAt, extra.day);
    store.appendEvent(createFulfillmentEvent({
      id: eventId,
      tenantId,
      contextId,
      entityId,
      eventType: extra.field === "completedQty" ? "PRODUCTION_COMPLETED" : extra.field === "passedQty" ? "QUALITY_PASSED" : "QUALITY_FAILED",
      occurredAt: observedAt,
      recordedAt: observedAt,
      sourceSystemId: extra.entityType === "production_order" ? "MES-OPS" : "QMS-OPS",
      sourceDocumentId: documentId,
      payload: { [extra.field]: extra.value },
      idempotencyKey: `${spec.businessKey}:${extra.field}:v1`,
    }));
    store.saveEvidence(createEvidence({
      id: `evidence-${spec.businessKey.toLowerCase()}-${extra.field}`,
      tenantId,
      contextId,
      sourceSystemId: extra.entityType === "production_order" ? "MES-OPS" : "QMS-OPS",
      sourceDocumentId: documentId,
      sourceVersion: "v1",
      entityId,
      eventId,
      field: extra.field,
      value: extra.value,
      valueType: "number",
      locator: { fileName: `${spec.businessKey}-${extra.field}.csv`, row: 2 },
      quote: `${extra.field}=${extra.value}`,
      confidence: 1,
      support: "supported",
      observedAt,
      createdAt: observedAt,
      metadata: { synthetic: true },
    }));
  }
  return contextId;
}

function ensureResolutionTarget(store: V2SqliteStore, contextId: string, spec: OperationalPortfolioSpec) {
  if (spec.resolutionTarget === "no_case" || !spec.resolutionExceptionCode) return;
  const exception = store.listExceptions(tenantId, contextId).find((item) => item.code === spec.resolutionExceptionCode);
  if (!exception) throw new Error(`synthetic_resolution_exception_missing:${spec.businessKey}:${spec.resolutionExceptionCode}`);
  if (store.getResolutionCaseByException(tenantId, exception.id)) return;
  let resolutionCase = acceptExceptionForResolution(store, tenantId, contextId, exception.id, {
    ownerRole: "品质负责人",
    rationale: "Synthetic governance-state example.",
    actor: qualityActor,
  });
  if (spec.resolutionTarget === "triaged") return;
  resolutionCase = reviewResolution(store, tenantId, resolutionCase.id, {
    decision: spec.resolutionTarget === "rejected" ? "reject" : "confirm",
    rationale: spec.resolutionTarget === "rejected" ? "Synthetic rejected example." : "Synthetic confirmed example.",
    actor: qualityActor,
  })!;
  if (spec.resolutionTarget === "rejected" || spec.resolutionTarget === "confirmed") return;
  resolutionCase = proposeResolutionCase(store, tenantId, resolutionCase.id, {
    actor: qualityActor,
    actions: [{ type: "supplement_evidence", summary: "补充客户签收与物流记录。" }],
  })!;
  if (spec.resolutionTarget === "proposed_draft") return;
  resolutionCase = submitResolutionCase(store, tenantId, resolutionCase.id, qualityActor)!;
  if (spec.resolutionTarget === "pending_approval") return;
  resolutionCase = approveResolutionCase(store, tenantId, resolutionCase.id, generalManagerActor)!;
  if (spec.resolutionTarget === "approved") return;
  resolutionCase = executeResolutionCase(store, tenantId, resolutionCase.id, salesDirectorActor)!;
  if (spec.resolutionTarget === "executed") return;
  closeResolutionCase(store, tenantId, resolutionCase.id, salesDirectorActor);
}

export function provisionOperationalPortfolio(store: V2SqliteStore) {
  registerBuiltInSolutionPacks();
  const contexts: string[] = [];
  for (const spec of OPERATIONAL_PORTFOLIO) {
    const contextId = saveScenario(store, spec);
    bindPackContext(store, manufacturingFulfillmentPack, tenantId, contextId, "demo-system");
    evaluateContextRules(store, tenantId, contextId);
    ensureResolutionTarget(store, contextId, spec);
    contexts.push(contextId);
  }
  return { contextCount: contexts.length, contexts };
}
