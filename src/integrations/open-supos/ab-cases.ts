/**
 * open supOS A/B 业务用例（最小真实验证数据）。
 *
 * 目的：把「任何输入都产生异常」这种假设排除掉。两个 case 结构完全一致、只有数值不同，
 * 且都走同一条 Connector 路径（见 connector.ts / contract-verify.ts）：
 *
 *   Case A `normal-order`     计划/订单/生产完成/质检合格/发货/回款/客户声明 全部一致
 *                             => 7 条规则全部执行，命中的异常规则 = 0，异常 = 0
 *   Case B `exception-order`  只有生产完成数量 96 低于订单数量 100
 *                             => 只命中 ORDER_PRODUCTION_COMPLETION_SHORTFALL，异常 = 1
 *
 * 注意：这里**不**从既有混合 fixture（SO-MFG-001）推断结果，两个 case 都是独立数据。
 * 字段口径（业务别名 → 本 pack 的领域字段）：
 *   plannedQuantity  → sales_order.qty（订单数量）
 *   deliveredQuantity→ production_order.completedQty（生产完成数量）
 */
import type { OpenSupOSUnsEnvelope } from "./types.js";
import { buildUnsTopic } from "./topic-mapper.js";

export const OPEN_SUPOS_AB_TENANT = "demo-manufacturing";

export type OpenSupOSAbCaseId = "normal-order" | "exception-order";

export type OpenSupOSAbCase = {
  caseId: OpenSupOSAbCaseId;
  label: string;
  businessKey: string;
  expectation: {
    evaluations: number;
    matchedExceptionRules: number;
    exceptions: number;
    exceptionCodes: string[];
  };
  messages: Array<{ topic: string; envelope: OpenSupOSUnsEnvelope }>;
};

type CaseDefinition = {
  caseId: OpenSupOSAbCaseId;
  label: string;
  code: string;
  businessKey: string;
  plannedQuantity: number;
  deliveredQuantity: number;
  inspectedQuantity: number;
  passedQuantity: number;
  shipmentQuantity: number;
  receivableAmount: number;
  paymentAmount: number;
  claimedReceivedQuantity: number;
  exceptionCodes: string[];
};

function message(input: {
  caseDefinition: CaseDefinition;
  messageId: string;
  systemKey: string;
  systemType: OpenSupOSUnsEnvelope["source"]["systemType"];
  externalDocumentId: string;
  documentType: string;
  entityType: OpenSupOSUnsEnvelope["entity"]["entityType"];
  entityBusinessKey: string;
  eventType: OpenSupOSUnsEnvelope["event"]["eventType"];
  occurredAt: string;
  facts: OpenSupOSUnsEnvelope["facts"];
  quote: string;
}): OpenSupOSUnsEnvelope {
  const { caseDefinition } = input;
  return {
    schemaVersion: "1.0",
    messageId: input.messageId,
    tenantKey: OPEN_SUPOS_AB_TENANT,
    context: { businessKey: caseDefinition.businessKey, contextType: "sales_order" },
    source: {
      systemKey: input.systemKey,
      systemType: input.systemType,
      externalDocumentId: input.externalDocumentId,
      documentType: input.documentType,
      sourceVersion: "v1",
    },
    entity: { entityType: input.entityType, businessKey: input.entityBusinessKey },
    event: { eventType: input.eventType, occurredAt: input.occurredAt },
    facts: input.facts,
    lineage: { quote: input.quote, confidence: 1 },
    metadata: {
      recordedAt: `${input.occurredAt.slice(0, 10)}T18:00:00.000Z`,
      abCase: caseDefinition.caseId,
      ruleProfile: "manufacturing",
      plannedQuantity: caseDefinition.plannedQuantity,
      deliveredQuantity: caseDefinition.deliveredQuantity,
    },
  };
}

function buildCase(definition: CaseDefinition): OpenSupOSAbCase {
  const { code, plannedQuantity: planned, deliveredQuantity: delivered } = definition;
  const envelopes: OpenSupOSUnsEnvelope[] = [
    message({ caseDefinition: definition, messageId: `CRM-DEMO:QT-${code}:v1:created`, systemKey: "CRM-DEMO", systemType: "crm", externalDocumentId: `QT-${code}`, documentType: "quote", entityType: "quote", entityBusinessKey: `QT-${code}`, eventType: "QUOTE_CREATED", occurredAt: "2026-09-01T00:00:00.000Z", facts: { qty: { value: planned, valueType: "number" } }, quote: `qty=${planned}` }),
    message({ caseDefinition: definition, messageId: `ERP-DEMO:SO-${code}:v1:created`, systemKey: "ERP-DEMO", systemType: "erp", externalDocumentId: `SO-${code}`, documentType: "sales_order", entityType: "sales_order", entityBusinessKey: `SO-${code}`, eventType: "ORDER_CREATED", occurredAt: "2026-09-02T00:00:00.000Z", facts: { qty: { value: planned, valueType: "number" } }, quote: `qty=${planned}` }),
    message({ caseDefinition: definition, messageId: `MES-DEMO:MO-${code}:v1:started`, systemKey: "MES-DEMO", systemType: "mes", externalDocumentId: `MO-${code}`, documentType: "production_order", entityType: "production_order", entityBusinessKey: `MO-${code}`, eventType: "PRODUCTION_STARTED", occurredAt: "2026-09-04T00:00:00.000Z", facts: { plannedQty: { value: planned, valueType: "number" } }, quote: `plannedQty=${planned}` }),
    message({ caseDefinition: definition, messageId: `MES-DEMO:MO-${code}:v1:completed`, systemKey: "MES-DEMO", systemType: "mes", externalDocumentId: `MO-${code}`, documentType: "production_order", entityType: "production_order", entityBusinessKey: `MO-${code}`, eventType: "PRODUCTION_COMPLETED", occurredAt: "2026-09-08T00:00:00.000Z", facts: { completedQty: { value: delivered, valueType: "number" } }, quote: `completedQty=${delivered}` }),
    message({ caseDefinition: definition, messageId: `QMS-DEMO:QC-${code}:v1:inspected`, systemKey: "QMS-DEMO", systemType: "qms", externalDocumentId: `QC-${code}`, documentType: "quality_inspection", entityType: "quality_event", entityBusinessKey: `QC-${code}`, eventType: "QUALITY_INSPECTED", occurredAt: "2026-09-09T09:00:00.000Z", facts: { inspectedQty: { value: definition.inspectedQuantity, valueType: "number" } }, quote: `inspectedQty=${definition.inspectedQuantity}` }),
    message({ caseDefinition: definition, messageId: `QMS-DEMO:QC-${code}:v1:passed`, systemKey: "QMS-DEMO", systemType: "qms", externalDocumentId: `QC-${code}`, documentType: "quality_inspection", entityType: "quality_event", entityBusinessKey: `QC-${code}`, eventType: "QUALITY_PASSED", occurredAt: "2026-09-09T12:00:00.000Z", facts: { passedQty: { value: definition.passedQuantity, valueType: "number" } }, quote: `passedQty=${definition.passedQuantity}` }),
    message({ caseDefinition: definition, messageId: `QMS-DEMO:QC-${code}:v1:failed`, systemKey: "QMS-DEMO", systemType: "qms", externalDocumentId: `QC-${code}`, documentType: "quality_inspection", entityType: "quality_event", entityBusinessKey: `QC-${code}`, eventType: "QUALITY_FAILED", occurredAt: "2026-09-09T12:01:00.000Z", facts: { failedQty: { value: definition.inspectedQuantity - definition.passedQuantity, valueType: "number" } }, quote: `failedQty=${definition.inspectedQuantity - definition.passedQuantity}` }),
    message({ caseDefinition: definition, messageId: `WMS-DEMO:SH-${code}:v1:dispatched`, systemKey: "WMS-DEMO", systemType: "wms", externalDocumentId: `SH-${code}`, documentType: "shipment", entityType: "shipment", entityBusinessKey: `SH-${code}`, eventType: "SHIPMENT_DISPATCHED", occurredAt: "2026-09-10T00:00:00.000Z", facts: { qty: { value: definition.shipmentQuantity, valueType: "number" } }, quote: `qty=${definition.shipmentQuantity}` }),
    message({ caseDefinition: definition, messageId: `FINANCE-DEMO:AR-${code}:v1:created`, systemKey: "FINANCE-DEMO", systemType: "finance", externalDocumentId: `AR-${code}`, documentType: "receivable", entityType: "receivable", entityBusinessKey: `AR-${code}`, eventType: "RECEIVABLE_CREATED", occurredAt: "2026-09-11T00:00:00.000Z", facts: { amount: { value: definition.receivableAmount, valueType: "currency" } }, quote: `amount=${definition.receivableAmount}` }),
    message({ caseDefinition: definition, messageId: `FINANCE-DEMO:PAY-${code}:v1:received`, systemKey: "FINANCE-DEMO", systemType: "finance", externalDocumentId: `PAY-${code}`, documentType: "payment", entityType: "payment", entityBusinessKey: `PAY-${code}`, eventType: "PAYMENT_RECEIVED", occurredAt: "2026-09-12T00:00:00.000Z", facts: { amount: { value: definition.paymentAmount, valueType: "currency" } }, quote: `amount=${definition.paymentAmount}` }),
    message({ caseDefinition: definition, messageId: `SERVICE-DEMO:CP-${code}:v1:opened`, systemKey: "SERVICE-DEMO", systemType: "manual", externalDocumentId: `CP-${code}`, documentType: "complaint", entityType: "complaint", entityBusinessKey: `CP-${code}`, eventType: "COMPLAINT_OPENED", occurredAt: "2026-09-15T00:00:00.000Z", facts: { claimedReceivedQty: { value: definition.claimedReceivedQuantity, valueType: "number" } }, quote: `claimedReceivedQty=${definition.claimedReceivedQuantity}` }),
  ];
  return {
    caseId: definition.caseId,
    label: definition.label,
    businessKey: definition.businessKey,
    expectation: {
      evaluations: 7,
      matchedExceptionRules: definition.exceptionCodes.length,
      exceptions: definition.exceptionCodes.length,
      exceptionCodes: definition.exceptionCodes,
    },
    messages: envelopes.map((envelope) => ({ topic: buildUnsTopic(envelope), envelope })),
  };
}

const CASE_A: CaseDefinition = {
  caseId: "normal-order",
  label: "正常订单：所有参与规则的字段一致",
  code: "AB-N-001",
  businessKey: "SO-AB-N-001",
  plannedQuantity: 100,
  deliveredQuantity: 100,
  inspectedQuantity: 100,
  passedQuantity: 100,
  shipmentQuantity: 100,
  receivableAmount: 100000,
  paymentAmount: 100000,
  claimedReceivedQuantity: 100,
  exceptionCodes: [],
};

const CASE_B: CaseDefinition = {
  caseId: "exception-order",
  label: "异常订单：生产完成数量低于订单数量",
  code: "AB-X-001",
  businessKey: "SO-AB-X-001",
  plannedQuantity: 100,
  deliveredQuantity: 96,
  inspectedQuantity: 100,
  passedQuantity: 100,
  shipmentQuantity: 100,
  receivableAmount: 100000,
  paymentAmount: 100000,
  claimedReceivedQuantity: 100,
  exceptionCodes: ["ORDER_PRODUCTION_COMPLETION_SHORTFALL"],
};

export function buildNormalOrderCase() {
  return buildCase(CASE_A);
}

export function buildExceptionOrderCase() {
  return buildCase(CASE_B);
}

export function buildOpenSupOSAbCases(): OpenSupOSAbCase[] {
  return [buildNormalOrderCase(), buildExceptionOrderCase()];
}
