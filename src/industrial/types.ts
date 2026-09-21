/**
 * 工业语义层（Industrial Semantic Layer）类型。
 *
 * 这一层回答五个不同的问题，边界必须保持清晰：
 *
 *   UNS hierarchy        → 「这些数据发生在哪个工业空间/资产上」（Enterprise/Site/Area/Line/Equipment）
 *   Business Context      → 「这是哪一条业务履约链」（SO-IND-001 的一次履约过程）
 *   Canonical Industrial Event → 「跨系统统一之后，这一件事到底是什么」
 *   SourceRecordEnvelope → 「这条数据是从哪个连接器的哪一条原始记录读到的」（Connector Core 契约）
 *   Evidence             → 「这个结论具体依据哪一份材料里的哪一个字段」
 *
 * 五者不可互相替代：UNS 是空间，Context 是业务链，Canonical Event 是语义，
 * Envelope 是摄取证据，Evidence 是结论依据。
 */
import type { SourceSystemType } from "../domain/v2/index.js";

/** ISA-95 风格层级。这里只实现到「足够挂载业务对象」的程度，不是完整 ISA-95 标准实现。 */
export type IndustrialLevel = "enterprise" | "site" | "area" | "line" | "equipment";

export const INDUSTRIAL_LEVELS: IndustrialLevel[] = ["enterprise", "site", "area", "line", "equipment"];

/**
 * 工业空间引用：一条数据的工业时空坐标。
 *
 * `equipmentId` 可选——Topic 约定只到 Line（见 uns-topic.ts），设备粒度留在事件元数据里，
 * 这样既不放大 Topic 维度，又保留到具体机台的可追溯性。
 */
export type IndustrialSpace = {
  enterpriseId: string;
  siteId: string;
  areaId: string;
  lineId: string;
  equipmentId?: string;
};

export type IndustrialNode = {
  id: string;
  level: IndustrialLevel;
  parentId: string | null;
  name: string;
  metadata: Record<string, unknown>;
};

export type IndustrialHierarchy = {
  hierarchyId: string;
  tenantId: string;
  nodes: IndustrialNode[];
};

/** UNS domain 段：用业务域而不是系统名，保证多系统接入时 Topic 稳定。 */
export type IndustrialDomain =
  | "sales"
  | "production"
  | "quality"
  | "shipment"
  | "finance"
  | "service";

export type IndustrialEventTypeBinding = {
  canonicalEventType: string;
  domain: IndustrialDomain;
  topicEventType: string;
};

/**
 * Canonical Industrial Event：MES / ERP / QMS / WMS / Finance 最终都映射成同一种事件语言。
 *
 * 位置严格在 `SourceRecordEnvelope`（摄取证据）与 Domain Event（领域事实）之间：
 * 它比 Envelope 多了工业空间与语义映射版本，比 Domain Event 少了领域投影的裁剪。
 */
export type CanonicalIndustrialEvent = {
  schemaVersion: "canonical-industrial-event/v1";
  eventId: string;
  tenantId: string;
  enterpriseId: string;
  siteId: string;
  areaId: string;
  lineId: string;
  equipmentId: string | null;
  sourceSystem: string;
  sourceRecordId: string;
  entityType: string;
  entityId: string;
  eventType: string;
  occurredAt: string;
  observedAt: string;
  payload: Record<string, unknown>;
  mappingVersion: string;
  sourceLocator: Record<string, unknown>;
  rawHash: string;
  unsTopic: string;
  businessContextKey: string;
  provenance: CanonicalIndustrialProvenance;
};

export type CanonicalIndustrialProvenance = {
  connectorId: string;
  connectorInstallationId: string;
  externalRecordId: string;
  recordType: string;
  sourceVersion: string;
  sourceSystemType: SourceSystemType;
  /** 原始系统字段名 → 规范字段名（来自 Mapping Manifest） */
  fieldMapping: Array<{ sourceField: string; canonicalField: string; semanticField: string; unit: string | null }>;
};

export type IndustrialMappingDataType = "number" | "currency" | "string" | "boolean" | "datetime";

export type IndustrialMappingEntry = {
  id: string;
  /** 来源系统的原始字段名，例如 MES 的 `completed_qty` */
  sourceSystem: SourceSystemType;
  sourceField: string;
  semantic: {
    /** 语义对象（PascalCase），例如 ProductionOrder */
    entityType: string;
    /** 本 pack 领域模型里的实体类型，例如 production_order */
    entityTypeCanonical: string;
    /** 语义字段名，例如 completedQuantity */
    field: string;
    dataType: IndustrialMappingDataType;
    unit: string | null;
  };
  target: {
    /** UNS 路径表达式 */
    unsPath: string;
    domain: IndustrialDomain;
    /** CanonicalIndustrialEvent.payload 与下游 Evidence 使用的字段名，例如 completedQty */
    canonicalField: string;
  };
  provenance: {
    mappingVersion: string;
    owner: string;
    description: string;
  };
};

export type IndustrialMappingManifest = {
  schemaVersion: "industrial-mapping-manifest/v1";
  id: string;
  version: string;
  contentHash: string;
  generatedAt: string;
  entries: IndustrialMappingEntry[];
};

export type IndustrialTraceNode = {
  position: number;
  entityType: string;
  entityId: string;
  businessKey: string;
  /** 唯一来源系统；当同一实体确实由多个系统写入时为 null（不猜一个） */
  sourceSystemId: string | null;
  /** 该实体的全部来源系统（有序去重） */
  sourceSystemIds: string[];
  sourceSystemType: SourceSystemType | null;
  domain: IndustrialDomain | null;
  occurredAt: string | null;
  eventCount: number;
  evidenceIds: string[];
};

export type IndustrialContextSummary = {
  schemaVersion: "industrial-context-summary/v1";
  tenantId: string;
  contextId: string;
  businessKey: string;
  /** Context 级工业空间：到 Line 粒度（一个 Context 会跨多台设备，不该被钉死在某台设备上） */
  space: IndustrialSpace | null;
  unsRootPath: string | null;
  /** 本 Context 实际涉及到的设备（来自摄取账本的 locator，按事件逐条记录） */
  equipmentIds: string[];
  environment: "SIMULATED INDUSTRIAL ENVIRONMENT";
  sourceSystems: Array<{ id: string; name: string; systemType: SourceSystemType; authorityLevel: string }>;
  entities: Array<{ id: string; entityType: string; businessKey: string; eventCount: number }>;
  eventCount: number;
  evidenceCount: number;
  exceptionCount: number;
  evaluationCount: number;
  trace: IndustrialTraceNode[];
  mappingVersions: string[];
  truthfulness: {
    environment: "simulated_industrial_environment";
    realFactory: false;
    realMes: false;
    realErp: false;
    realQms: false;
    realWms: false;
  };
};

export class IndustrialSemanticError extends Error {
  constructor(public readonly code: string, detail?: string) {
    super(detail ? `${code}:${detail}` : code);
    this.name = "IndustrialSemanticError";
  }
}
