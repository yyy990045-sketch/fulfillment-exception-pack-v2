export type FulfillmentContextType = string;

export type FulfillmentContextStatus = "open" | "active" | "on_hold" | "closed" | "cancelled";

export type BusinessEntityType = string;

export type SourceSystemType = "erp" | "mes" | "qms" | "wms" | "crm" | "finance" | "manual" | "file" | "demo";

export type SourceSystemAuthorityLevel = "system_of_record" | "authoritative" | "contributing" | "reference";

export type SourceSystemStatus = "active" | "inactive";

export const KNOWN_CORE_EVENT_TYPES = [
  "QUOTE_CREATED",
  "QUOTE_CHANGED",
  "ORDER_CREATED",
  "ORDER_CHANGED",
  "PRODUCTION_STARTED",
  "PRODUCTION_COMPLETED",
  "QUALITY_INSPECTED",
  "QUALITY_PASSED",
  "QUALITY_FAILED",
  "SHIPMENT_CREATED",
  "SHIPMENT_DISPATCHED",
  "SHIPMENT_SIGNED",
  "RECEIVABLE_CREATED",
  "INVOICE_CREATED",
  "PAYMENT_RECEIVED",
  "BANK_PAYMENT_RECEIVED",
  "COMPLAINT_OPENED",
  "COMPLAINT_UPDATED",
] as const;

export const FULFILLMENT_EVENT_TYPES = KNOWN_CORE_EVENT_TYPES;

export type FulfillmentEventType = string;

export type EvidenceValueType = "string" | "number" | "boolean" | "date" | "datetime" | "currency" | "json" | "null";

export type EvidenceSupport = "supported" | "partial" | "unsupported";

/**
 * 证据在原始材料中的位置（"哪一段"）。
 *
 * 与"是哪个材料"严格分离——工件身份在 `SourceDocument`
 * （`externalDocumentId` / `contentHash` / `mimeType` / `version`），位置在本类型。
 * 两者必须能各自独立回答「这条结论依据了哪一份原始材料」与「依据了其中的哪一段」。
 *
 * 三类位置可独立或同时存在。语义与平台 Core 的 LocatorAtom 对齐，
 * 但**不 import Core 源码**：这是跨仓库语义对齐，不是源码耦合。
 *
 *   - 文档位置：fileName / sheet / row / cell / line / page
 *   - 时序位置：startMs / endMs（毫秒；对应 Core `TimeSpanLocator { startMs, endMs }`）
 *   - 转写位置：startOffset / endOffset（字符偏移；对应 Core `TextSpanLocator`）
 *
 * `fileName` **不再必填**。非文档来源（录音 / 设备日志 / 传感器窗口）不得为了通过校验而
 * 伪造 `fileName = "audio@02:14-02:21"` 这类假值——那是语义造假，会让
 * 「这条结论具体依据了哪一段原始材料」无法被可靠复核，而可复核正是 Evidence 存在的理由。
 */
export type EvidenceLocator = {
  // ---- 文档位置 ----
  fileName?: string;
  sheet?: string;
  row?: number;
  cell?: string;
  line?: number;
  page?: number;
  // ---- 时序位置（毫秒）----
  startMs?: number;
  endMs?: number;
  // ---- 转写位置（字符偏移）----
  startOffset?: number;
  endOffset?: number;
};

/** locator 实际命中的位置种类，供消费方判断证据是文档型还是时序型。 */
export type EvidenceLocatorKind = "document" | "temporal" | "transcript";

export type FulfillmentContext = {
  id: string;
  tenantId: string;
  businessKey: string;
  contextType: FulfillmentContextType;
  status: FulfillmentContextStatus;
  openedAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
};

export type BusinessEntity = {
  id: string;
  tenantId: string;
  contextId: string;
  entityType: BusinessEntityType;
  businessKey: string;
  attributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type EntityReference = {
  id: string;
  tenantId: string;
  entityId: string;
  sourceSystemId: string;
  externalId: string;
  externalType: string;
  createdAt: string;
};

export type SourceSystem = {
  id: string;
  tenantId: string;
  name: string;
  systemType: SourceSystemType;
  authorityLevel: SourceSystemAuthorityLevel;
  status: SourceSystemStatus;
  metadata: Record<string, unknown>;
};

export type SourceDocument = {
  id: string;
  tenantId: string;
  sourceSystemId: string;
  externalDocumentId: string;
  documentType: string;
  contentHash: string;
  receivedAt: string;
  effectiveAt: string | null;
  version: string;
  contextId?: string;
  entityId?: string;
  fileName?: string;
  mimeType?: string;
  metadata: Record<string, unknown>;
};

export type FulfillmentEvent = {
  id: string;
  tenantId: string;
  contextId: string;
  entityId: string;
  eventType: FulfillmentEventType;
  occurredAt: string;
  recordedAt: string;
  sourceSystemId: string;
  sourceDocumentId?: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
};

export type EvidenceBinding = {
  tenantId: string;
  contextId: string;
  sourceSystemId: string;
  sourceDocumentId: string;
  entityId?: string;
  eventId?: string;
};

export type V2Evidence = EvidenceBinding & {
  id: string;
  sourceVersion: string;
  field: string;
  value: unknown;
  valueType: EvidenceValueType;
  locator: EvidenceLocator;
  quote: string;
  confidence: number;
  support: EvidenceSupport;
  observedAt: string;
  createdAt: string;
  metadata: Record<string, unknown>;
};
