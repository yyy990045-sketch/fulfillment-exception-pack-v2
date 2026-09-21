/**
 * Industrial Mapping Manifest（声明式，无 UI 编辑器）。
 *
 * 它把「来源系统的原始字段名」翻译成「统一工业语义」：
 *
 *   sourceSystem MES / sourceField `completed_qty`
 *     → semantic  ProductionOrder.completedQuantity (number, pcs)
 *     → target    UNS path + canonicalField `completedQty`
 *     → provenance mappingVersion
 *
 * 为什么需要它：
 *   真实 MES/ERP/QMS/WMS 的字段名互不相同（`completed_qty` / `finish_qty` / `产出数`）。
 *   如果不把「翻译」显式声明出来，跨系统异常治理就只能靠代码里的 if，
 *   一线业务与甲方 IT 都无法复核「这个结论用的是哪个系统的哪个字段」。
 *   Manifest 让这条翻译链可评审、可版本化、可 diff。
 *
 * 纪律：Manifest 只做声明与解析，不发明数值、不做单位换算之外的计算。
 */
import { createHash } from "node:crypto";
import type { EvidenceValueType, SourceSystemType } from "../domain/v2/index.js";
import { IndustrialSemanticError, type IndustrialDomain, type IndustrialMappingEntry, type IndustrialMappingManifest } from "./types.js";

export const INDUSTRIAL_MAPPING_ID = "industrial-mapping";
export const INDUSTRIAL_MAPPING_VERSION = "1.0.0";

function unsPath(domain: IndustrialDomain, topicEventType: string) {
  return `enterprise/{enterpriseId}/site/{siteId}/area/{areaId}/line/{lineId}/${domain}/{entityId}/${topicEventType}`;
}

function entry(input: {
  id: string;
  sourceSystem: SourceSystemType;
  sourceField: string;
  semanticEntityType: string;
  semanticEntityTypeCanonical: string;
  semanticField: string;
  dataType: IndustrialMappingEntry["semantic"]["dataType"];
  unit: string | null;
  domain: IndustrialDomain;
  topicEventType: string;
  canonicalField: string;
  description: string;
}): IndustrialMappingEntry {
  return {
    id: input.id,
    sourceSystem: input.sourceSystem,
    sourceField: input.sourceField,
    semantic: {
      entityType: input.semanticEntityType,
      entityTypeCanonical: input.semanticEntityTypeCanonical,
      field: input.semanticField,
      dataType: input.dataType,
      unit: input.unit,
    },
    target: {
      unsPath: unsPath(input.domain, input.topicEventType),
      domain: input.domain,
      canonicalField: input.canonicalField,
    },
    provenance: {
      mappingVersion: `industrial-mapping/v${INDUSTRIAL_MAPPING_VERSION}`,
      owner: "company-ai-platform / industrial-semantic-layer",
      description: input.description,
    },
  };
}

/** 被 §5 要求覆盖的最小业务对象：Order / Production / Quality / Shipment / Payment。 */
export const REQUIRED_MAPPING_TARGETS = [
  { entityTypeCanonical: "sales_order", canonicalField: "qty" },
  { entityTypeCanonical: "production_order", canonicalField: "plannedQty" },
  { entityTypeCanonical: "production_order", canonicalField: "completedQty" },
  { entityTypeCanonical: "quality_event", canonicalField: "inspectedQty" },
  { entityTypeCanonical: "quality_event", canonicalField: "passedQty" },
  { entityTypeCanonical: "quality_event", canonicalField: "failedQty" },
  { entityTypeCanonical: "shipment", canonicalField: "qty" },
  { entityTypeCanonical: "receivable", canonicalField: "amount" },
  { entityTypeCanonical: "payment", canonicalField: "amount" },
] as const;

const ENTRIES: IndustrialMappingEntry[] = [
  // ── Order（CRM 报价 / ERP 销售订单）
  entry({
    id: "crm.quote.qty", sourceSystem: "crm", sourceField: "quote_qty",
    semanticEntityType: "Quote", semanticEntityTypeCanonical: "quote", semanticField: "quotedQuantity", dataType: "number", unit: "pcs",
    domain: "sales", topicEventType: "quote.created", canonicalField: "qty",
    description: "CRM 报价数量 → 报价实体 qty",
  }),
  entry({
    id: "erp.sales_order.qty", sourceSystem: "erp", sourceField: "order_qty",
    semanticEntityType: "SalesOrder", semanticEntityTypeCanonical: "sales_order", semanticField: "orderedQuantity", dataType: "number", unit: "pcs",
    domain: "sales", topicEventType: "order.created", canonicalField: "qty",
    description: "ERP 销售订单数量 → 销售订单实体 qty（跨系统比对的基准量）",
  }),
  // ── Production（MES 工单）
  entry({
    id: "mes.production_order.planned", sourceSystem: "mes", sourceField: "plan_qty",
    semanticEntityType: "ProductionOrder", semanticEntityTypeCanonical: "production_order", semanticField: "plannedQuantity", dataType: "number", unit: "pcs",
    domain: "production", topicEventType: "production.started", canonicalField: "plannedQty",
    description: "MES 工单计划数量 → 生产订单 plannedQty",
  }),
  entry({
    id: "mes.production_order.progressed", sourceSystem: "mes", sourceField: "report_qty",
    semanticEntityType: "ProductionOrder", semanticEntityTypeCanonical: "production_order", semanticField: "reportedQuantity", dataType: "number", unit: "pcs",
    domain: "production", topicEventType: "production.progressed", canonicalField: "completedQty",
    description: "MES 报工数量 → 生产订单累计完成数量（同一实体多报工取最新）",
  }),
  entry({
    id: "mes.production_order.completed", sourceSystem: "mes", sourceField: "completed_qty",
    semanticEntityType: "ProductionOrder", semanticEntityTypeCanonical: "production_order", semanticField: "completedQuantity", dataType: "number", unit: "pcs",
    domain: "production", topicEventType: "production.completed", canonicalField: "completedQty",
    description: "MES 工单完工数量 → 生产订单 completedQty（订单履约比对的实际量）",
  }),
  // ── Quality（QMS 检验单）
  entry({
    id: "qms.inspection.inspected", sourceSystem: "qms", sourceField: "inspected_qty",
    semanticEntityType: "QualityInspection", semanticEntityTypeCanonical: "quality_event", semanticField: "inspectedQuantity", dataType: "number", unit: "pcs",
    domain: "quality", topicEventType: "quality.inspected", canonicalField: "inspectedQty",
    description: "QMS 送检数量 → 质检实体 inspectedQty",
  }),
  entry({
    id: "qms.inspection.passed", sourceSystem: "qms", sourceField: "passed_qty",
    semanticEntityType: "QualityInspection", semanticEntityTypeCanonical: "quality_event", semanticField: "passedQuantity", dataType: "number", unit: "pcs",
    domain: "quality", topicEventType: "quality.passed", canonicalField: "passedQty",
    description: "QMS 合格数量 → 质检实体 passedQty（可发货量的上限）",
  }),
  entry({
    id: "qms.inspection.failed", sourceSystem: "qms", sourceField: "rejected_qty",
    semanticEntityType: "QualityInspection", semanticEntityTypeCanonical: "quality_event", semanticField: "rejectedQuantity", dataType: "number", unit: "pcs",
    domain: "quality", topicEventType: "quality.failed", canonicalField: "failedQty",
    description: "QMS 不合格数量 → 质检实体 failedQty",
  }),
  // ── Shipment（WMS 发货单）
  entry({
    id: "wms.shipment.planned", sourceSystem: "wms", sourceField: "planned_ship_qty",
    semanticEntityType: "Shipment", semanticEntityTypeCanonical: "shipment", semanticField: "plannedShipmentQuantity", dataType: "number", unit: "pcs",
    domain: "shipment", topicEventType: "shipment.created", canonicalField: "plannedQty",
    description: "WMS 计划发货数量 → 发货实体 plannedQty",
  }),
  entry({
    id: "wms.shipment.dispatched", sourceSystem: "wms", sourceField: "shipped_qty",
    semanticEntityType: "Shipment", semanticEntityTypeCanonical: "shipment", semanticField: "shippedQuantity", dataType: "number", unit: "pcs",
    domain: "shipment", topicEventType: "shipment.dispatched", canonicalField: "qty",
    description: "WMS 实发数量 → 发货实体 qty（订单发货短少的实际量）",
  }),
  entry({
    id: "wms.shipment.received", sourceSystem: "wms", sourceField: "signed_qty",
    semanticEntityType: "Shipment", semanticEntityTypeCanonical: "shipment", semanticField: "signedQuantity", dataType: "number", unit: "pcs",
    domain: "shipment", topicEventType: "shipment.received", canonicalField: "signedQty",
    description: "WMS 签收数量 → 发货实体 signedQty",
  }),
  // ── Finance（发票 / 应收 / 回款）
  entry({
    id: "finance.invoice.amount", sourceSystem: "finance", sourceField: "invoice_amount",
    semanticEntityType: "Invoice", semanticEntityTypeCanonical: "invoice", semanticField: "invoiceAmount", dataType: "currency", unit: "CNY",
    domain: "finance", topicEventType: "invoice.created", canonicalField: "amount",
    description: "财务系统开票金额 → 发票实体 amount",
  }),
  entry({
    id: "finance.receivable.amount", sourceSystem: "finance", sourceField: "ar_amount",
    semanticEntityType: "Receivable", semanticEntityTypeCanonical: "receivable", semanticField: "receivableAmount", dataType: "currency", unit: "CNY",
    domain: "finance", topicEventType: "receivable.created", canonicalField: "amount",
    description: "财务系统应收金额 → 应收实体 amount（回款比对的基准金额）",
  }),
  entry({
    id: "finance.payment.received", sourceSystem: "finance", sourceField: "received_amount",
    semanticEntityType: "Payment", semanticEntityTypeCanonical: "payment", semanticField: "receivedAmount", dataType: "currency", unit: "CNY",
    domain: "finance", topicEventType: "payment.received", canonicalField: "amount",
    description: "财务系统到账金额 → 回款实体 amount",
  }),
  // ── Service（客诉）
  entry({
    id: "service.complaint.claimed", sourceSystem: "manual", sourceField: "claimed_received_qty",
    semanticEntityType: "Complaint", semanticEntityTypeCanonical: "complaint", semanticField: "claimedReceivedQuantity", dataType: "number", unit: "pcs",
    domain: "service", topicEventType: "complaint.created", canonicalField: "claimedReceivedQty",
    description: "服务系统客户主张收到数量 → 客诉实体 claimedReceivedQty",
  }),
];

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function industrialMappingContentHash(entries: IndustrialMappingEntry[]) {
  return createHash("sha256").update(canonicalJson(entries)).digest("hex");
}

export function buildIndustrialMappingManifest(): IndustrialMappingManifest {
  return {
    schemaVersion: "industrial-mapping-manifest/v1",
    id: INDUSTRIAL_MAPPING_ID,
    version: INDUSTRIAL_MAPPING_VERSION,
    contentHash: industrialMappingContentHash(ENTRIES),
    generatedAt: "2026-09-21T00:00:00.000Z",
    entries: ENTRIES.map((item) => structuredClone(item)),
  };
}

export const INDUSTRIAL_MAPPING_MANIFEST: IndustrialMappingManifest = buildIndustrialMappingManifest();

export function resolveMappingEntry(
  manifest: IndustrialMappingManifest,
  sourceSystem: SourceSystemType,
  sourceField: string,
) {
  return manifest.entries.find((item) => item.sourceSystem === sourceSystem && item.sourceField === sourceField) ?? null;
}

export function resolveMappingEntryByCanonicalField(
  manifest: IndustrialMappingManifest,
  entityTypeCanonical: string,
  canonicalField: string,
) {
  return manifest.entries.find(
    (item) => item.semantic.entityTypeCanonical === entityTypeCanonical && item.target.canonicalField === canonicalField,
  ) ?? null;
}

/**
 * 反查：规范字段属于哪一条 UNS 事件路径。
 *
 * 同一个规范字段可能来自多个人事时点（例如 `production_order.completedQty` 既来自
 * `production.progressed` 的报工，也来自 `production.completed` 的完工），
 * 因此反查必须带 topic 事件名，否则「这条证据到底来自报工还是完工」就说不清。
 */
export function resolveMappingEntryForEvent(
  manifest: IndustrialMappingManifest,
  input: { entityTypeCanonical: string; canonicalField: string; topicEventType: string },
) {
  return manifest.entries.find(
    (item) =>
      item.semantic.entityTypeCanonical === input.entityTypeCanonical &&
      item.target.canonicalField === input.canonicalField &&
      item.target.unsPath.endsWith(`/${input.topicEventType}`),
  ) ?? null;
}

export function industrialMappingEvidenceValueType(dataType: IndustrialMappingEntry["semantic"]["dataType"]): EvidenceValueType {
  if (dataType === "number" || dataType === "currency" || dataType === "boolean" || dataType === "datetime" || dataType === "string") return dataType;
  return "string";
}

/**
 * 原始系统字段 → 规范事实。未声明字段 **fail-closed**：
 * 宁可直接报错，也不让「没人复核过的字段」悄悄进入证据链。
 *
 * 输出的 valueType 直接来自 Manifest 的 `semantic.dataType` —— 这是刻意的：
 * 「金额是 currency 而不是 number」这种口径必须由声明决定，
 * 不能让 `typeof 100000 === "number"` 顺手决定，否则规则选不到该证据。
 */
export function mapSourceFields(input: {
  manifest: IndustrialMappingManifest;
  sourceSystem: SourceSystemType;
  entityTypeCanonical: string;
  topicEventType: string;
  fields: Record<string, unknown>;
}) {
  const facts: Record<string, { value: unknown; valueType: EvidenceValueType }> = {};
  const fieldMapping: Array<{ sourceField: string; canonicalField: string; semanticField: string; unit: string | null }> = [];
  for (const [sourceField, value] of Object.entries(input.fields)) {
    const mapping = resolveMappingEntry(input.manifest, input.sourceSystem, sourceField);
    if (!mapping) throw new IndustrialSemanticError("UNMAPPED_SOURCE_FIELD", `${input.sourceSystem}.${sourceField}`);
    if (mapping.semantic.entityTypeCanonical !== input.entityTypeCanonical) {
      throw new IndustrialSemanticError(
        "MAPPING_ENTITY_TYPE_MISMATCH",
        `${sourceField}:mapped=${mapping.semantic.entityTypeCanonical}:event=${input.entityTypeCanonical}`,
      );
    }
    if (!mapping.target.unsPath.endsWith(`/${input.topicEventType}`)) {
      throw new IndustrialSemanticError(
        "MAPPING_EVENT_PATH_MISMATCH",
        `${sourceField}:path=${mapping.target.unsPath}:event=${input.topicEventType}`,
      );
    }
    if (mapping.target.canonicalField in facts) {
      throw new IndustrialSemanticError("MAPPING_CANONICAL_FIELD_COLLISION", mapping.target.canonicalField);
    }
    const valueType = industrialMappingEvidenceValueType(mapping.semantic.dataType);
    if ((valueType === "number" || valueType === "currency") && typeof value !== "number") {
      throw new IndustrialSemanticError("MAPPING_VALUE_TYPE_MISMATCH", `${sourceField}:expected=${valueType}:actual=${typeof value}`);
    }
    facts[mapping.target.canonicalField] = { value, valueType };
    fieldMapping.push({
      sourceField,
      canonicalField: mapping.target.canonicalField,
      semanticField: mapping.semantic.field,
      unit: mapping.semantic.unit,
    });
  }
  return { facts, fieldMapping };
}

/**
 * 规范事实 → (来源系统字段, 语义字段)。Canonical Industrial Event 的 provenance 走这一支：
 * UNS 信封承载的是规范字段（这是连接器契约），Manifest 负责把它翻译回
 * 「哪个系统的哪个字段、语义上叫什么」。
 */
export function resolveCanonicalFieldMapping(input: {
  manifest: IndustrialMappingManifest;
  sourceSystem: SourceSystemType;
  entityTypeCanonical: string;
  topicEventType: string;
  facts: Record<string, unknown>;
}) {
  const fieldMapping: Array<{ sourceField: string; canonicalField: string; semanticField: string; unit: string | null }> = [];
  for (const [canonicalField, value] of Object.entries(input.facts)) {
    const mapping = resolveMappingEntryForEvent(input.manifest, {
      entityTypeCanonical: input.entityTypeCanonical,
      canonicalField,
      topicEventType: input.topicEventType,
    });
    if (!mapping) throw new IndustrialSemanticError("UNMAPPED_CANONICAL_FIELD", `${input.entityTypeCanonical}.${canonicalField}`);
    if (mapping.sourceSystem !== input.sourceSystem) {
      throw new IndustrialSemanticError(
        "MAPPING_SOURCE_SYSTEM_MISMATCH",
        `${canonicalField}:declared=${mapping.sourceSystem}:event=${input.sourceSystem}`,
      );
    }
    const expectedType = industrialMappingEvidenceValueType(mapping.semantic.dataType);
    if ((expectedType === "number" || expectedType === "currency") && typeof value !== "number") {
      throw new IndustrialSemanticError("MAPPING_VALUE_TYPE_MISMATCH", `${canonicalField}:${typeof value}`);
    }
    fieldMapping.push({
      sourceField: mapping.sourceField,
      canonicalField,
      semanticField: mapping.semantic.field,
      unit: mapping.semantic.unit,
    });
  }
  return { facts: input.facts, fieldMapping };
}

export function mappingCoverageReport(manifest: IndustrialMappingManifest) {
  const covered = REQUIRED_MAPPING_TARGETS.filter((required) =>
    manifest.entries.some((item) =>
      item.semantic.entityTypeCanonical === required.entityTypeCanonical && item.target.canonicalField === required.canonicalField,
    ),
  );
  const missing = REQUIRED_MAPPING_TARGETS.filter((required) => !covered.includes(required));
  return {
    id: manifest.id,
    version: manifest.version,
    contentHash: manifest.contentHash,
    entryCount: manifest.entries.length,
    sourceSystems: [...new Set(manifest.entries.map((item) => item.sourceSystem))].sort(),
    domains: [...new Set(manifest.entries.map((item) => item.target.domain))].sort(),
    requiredTargetCount: REQUIRED_MAPPING_TARGETS.length,
    coveredTargetCount: covered.length,
    missingTargets: missing.map((item) => `${item.entityTypeCanonical}.${item.canonicalField}`),
    complete: missing.length === 0,
  };
}

export function assertMappingCoverage(manifest: IndustrialMappingManifest) {
  const report = mappingCoverageReport(manifest);
  if (!report.complete) throw new IndustrialSemanticError("MAPPING_COVERAGE_INCOMPLETE", report.missingTargets.join(","));
  return report;
}
