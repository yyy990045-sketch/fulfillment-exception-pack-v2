import type { EvidenceBundleView, WorkbenchView } from "../../features/manufacturing/types.js";

const createdAt = "2026-09-19T00:00:00.000Z";

export const workbenchFixture: WorkbenchView = {
  context: {
    id: "ctx-fixture",
    businessKey: "SO-FIXTURE-001",
    contextType: "sales_order",
    status: "active",
    openedAt: createdAt,
    updatedAt: createdAt,
  },
  stats: {
    sourceSystems: 3,
    entities: 8,
    documents: 8,
    events: 8,
    evidence: 11,
    ruleEvaluations: 7,
    matchedRules: 4,
    notMatchedRules: 3,
    exceptions: 4,
    resolutionCases: 0,
  },
  thread: [
    { key: "quote", label: "报价", entityId: "entity-quote", businessKey: "QT-FIXTURE", state: "normal", facts: [{ key: "qty", label: "数量", field: "qty", value: 12, valueType: "number", evidenceId: "e-quote", observedAt: createdAt }], occurredAt: createdAt, sourceSystem: { id: "crm", name: "CRM", systemType: "crm" }, sourceDocument: null, latestEvent: null },
    { key: "sales_order", label: "销售订单", entityId: "entity-order", businessKey: "SO-FIXTURE-001", state: "normal", facts: [{ key: "qty", label: "数量", field: "qty", value: 12, valueType: "number", evidenceId: "e-order", observedAt: createdAt }], occurredAt: createdAt, sourceSystem: { id: "erp", name: "ERP", systemType: "erp" }, sourceDocument: null, latestEvent: null },
    { key: "production_order", label: "生产", entityId: "entity-production", businessKey: "MO-FIXTURE", state: "normal", facts: [{ key: "completedQty", label: "完成数量", field: "completedQty", value: 11, valueType: "number", evidenceId: "e-production", observedAt: createdAt }], occurredAt: createdAt, sourceSystem: { id: "mes", name: "MES", systemType: "mes" }, sourceDocument: null, latestEvent: null },
    { key: "quality_event", label: "质检", entityId: "entity-quality", businessKey: "QI-FIXTURE", state: "exception", facts: [{ key: "failedQty", label: "未通过数量", field: "failedQty", value: 1, valueType: "number", evidenceId: "e-quality", observedAt: createdAt }], occurredAt: createdAt, sourceSystem: { id: "qms", name: "QMS", systemType: "qms" }, sourceDocument: null, latestEvent: null },
    { key: "shipment", label: "发货", entityId: "entity-shipment", businessKey: "SH-FIXTURE", state: "exception", facts: [{ key: "qty", label: "数量", field: "qty", value: 10, valueType: "number", evidenceId: "e-shipment", observedAt: createdAt }], occurredAt: createdAt, sourceSystem: { id: "wms", name: "WMS", systemType: "wms" }, sourceDocument: null, latestEvent: null },
    { key: "receivable", label: "应收", entityId: "entity-receivable", businessKey: "AR-FIXTURE", state: "exception", facts: [{ key: "amount", label: "金额", field: "amount", value: 1200, valueType: "currency", evidenceId: "e-receivable", observedAt: createdAt }], occurredAt: createdAt, sourceSystem: { id: "finance", name: "Finance", systemType: "finance" }, sourceDocument: null, latestEvent: null },
    { key: "payment", label: "回款", entityId: "entity-payment", businessKey: "PAY-FIXTURE", state: "exception", facts: [{ key: "amount", label: "金额", field: "amount", value: 1000, valueType: "currency", evidenceId: "e-payment", observedAt: createdAt }], occurredAt: createdAt, sourceSystem: { id: "finance", name: "Finance", systemType: "finance" }, sourceDocument: null, latestEvent: null },
    { key: "complaint", label: "客诉", entityId: "entity-complaint", businessKey: "CC-FIXTURE", state: "exception", facts: [{ key: "claimedReceivedQty", label: "客户主张收到", field: "claimedReceivedQty", value: 8, valueType: "number", evidenceId: "e-claim", observedAt: createdAt }], occurredAt: createdAt, sourceSystem: { id: "service", name: "Service", systemType: "manual" }, sourceDocument: null, latestEvent: null },
  ],
  rules: [
    { id: "rule-1", code: "QUOTE_ORDER", label: "报价与订单一致", status: "not_matched", statusLabel: "未命中", matched: false, stageKeys: ["quote", "sales_order"], metrics: {}, ruleId: "rule-1", ruleVersion: "v1", evaluatedAt: createdAt },
    { id: "rule-2", code: "ORDER_PRODUCTION", label: "订单与生产一致", status: "not_matched", statusLabel: "未命中", matched: false, stageKeys: ["sales_order", "production_order"], metrics: {}, ruleId: "rule-2", ruleVersion: "v1", evaluatedAt: createdAt },
    { id: "rule-3", code: "QUALITY_FAILED", label: "质检无未通过数量", status: "matched", statusLabel: "命中", matched: true, stageKeys: ["quality_event"], metrics: {}, ruleId: "rule-3", ruleVersion: "v1", evaluatedAt: createdAt },
    { id: "rule-4", code: "QUALITY_SHIPMENT", label: "质检与发货一致", status: "not_matched", statusLabel: "未命中", matched: false, stageKeys: ["quality_event", "shipment"], metrics: {}, ruleId: "rule-4", ruleVersion: "v1", evaluatedAt: createdAt },
    { id: "rule-5", code: "SHIPMENT_SHORTFALL", label: "发货无短少", status: "matched", statusLabel: "命中", matched: true, stageKeys: ["shipment"], metrics: {}, ruleId: "rule-5", ruleVersion: "v1", evaluatedAt: createdAt },
    { id: "rule-6", code: "PAYMENT_BALANCE", label: "应收已结清", status: "matched", statusLabel: "命中", matched: true, stageKeys: ["receivable", "payment"], metrics: {}, ruleId: "rule-6", ruleVersion: "v1", evaluatedAt: createdAt },
    { id: "rule-7", code: "CUSTOMER_CLAIM", label: "客户主张与签收一致", status: "matched", statusLabel: "命中", matched: true, stageKeys: ["shipment", "complaint"], metrics: {}, ruleId: "rule-7", ruleVersion: "v1", evaluatedAt: createdAt },
  ],
  exceptions: [
    { id: "exception-claim", code: "CUSTOMER_RECEIPT_CLAIM_MISMATCH", label: "客户签收主张差异", severity: "high", status: "open", title: "客户主张收到数量与发货记录不一致", summary: "客户主张收到数量低于当前发货记录，需要核对签收证据。", metrics: { difference: 2 }, matchKey: "SO-FIXTURE-001", ruleId: "rule-7", ruleVersionId: "rv-7", latestRuleEvaluationId: "eval-7", entityIds: ["entity-shipment", "entity-complaint"], stageKeys: ["shipment", "complaint"], evidenceCount: 2, sourceSystemCount: 2, createdAt, lastDetectedAt: createdAt },
    { id: "exception-payment", code: "PAYMENT_BALANCE_OUTSTANDING", label: "回款未结清", severity: "medium", status: "open", title: "应收与回款存在余额", summary: "当前回款记录尚未覆盖应收金额。", metrics: { outstandingAmount: 200 }, matchKey: "SO-FIXTURE-001", ruleId: "rule-6", ruleVersionId: "rv-6", latestRuleEvaluationId: "eval-6", entityIds: ["entity-receivable", "entity-payment"], stageKeys: ["receivable", "payment"], evidenceCount: 2, sourceSystemCount: 1, createdAt, lastDetectedAt: createdAt },
    { id: "exception-quality", code: "QUALITY_NONCONFORMING_QUANTITY", label: "质检未通过数量", severity: "medium", status: "open", title: "质检存在未通过数量", summary: "质检记录包含未通过数量，需要进入内部跟进。", metrics: { failedQty: 1 }, matchKey: "QI-FIXTURE", ruleId: "rule-3", ruleVersionId: "rv-3", latestRuleEvaluationId: "eval-3", entityIds: ["entity-quality"], stageKeys: ["quality_event"], evidenceCount: 2, sourceSystemCount: 1, createdAt, lastDetectedAt: createdAt },
    { id: "exception-shipment", code: "SHIPMENT_SHORTFALL", label: "发货数量短少", severity: "high", status: "open", title: "发货数量少于订单数量", summary: "发货记录少于订单数量。", metrics: { shortfall: 2 }, matchKey: "SO-FIXTURE-001", ruleId: "rule-5", ruleVersionId: "rv-5", latestRuleEvaluationId: "eval-5", entityIds: ["entity-shipment"], stageKeys: ["shipment"], evidenceCount: 2, sourceSystemCount: 2, createdAt, lastDetectedAt: createdAt },
  ],
  resolutionCases: [],
  truthfulness: {},
  defaultExceptionId: "exception-claim",
};

export const evidenceBundleFixture: EvidenceBundleView = {
  id: "bundle-fixture",
  tenantId: "demo-manufacturing",
  contextId: "ctx-fixture",
  exceptionId: "exception-claim",
  observations: {},
  evidenceIds: ["evidence-shipment", "evidence-claim"],
  evidence: [
    { evidenceId: "evidence-shipment", role: "actual", field: "qty", value: 10, valueType: "number", sourceSystemId: "wms", sourceDocumentId: "doc-shipment", sourceVersion: "v1", observedAt: createdAt, support: "supported", quote: "发货数量=10", locator: { fileName: "shipment.csv", row: 2 } },
    { evidenceId: "evidence-claim", role: "claim", field: "claimedReceivedQty", value: 8, valueType: "number", sourceSystemId: "service", sourceDocumentId: "doc-claim", sourceVersion: "v1", observedAt: createdAt, support: "supported", quote: "客户主张收到=8", locator: { fileName: "claim.csv", row: 2 } },
  ],
  sourceDocuments: [
    { id: "doc-shipment", externalDocumentId: "SH-FIXTURE", documentType: "shipment", version: "v1" },
    { id: "doc-claim", externalDocumentId: "CC-FIXTURE", documentType: "complaint", version: "v1" },
  ],
  sourceSystems: [
    { id: "wms", name: "WMS", systemType: "wms" },
    { id: "service", name: "Service", systemType: "manual" },
  ],
};
