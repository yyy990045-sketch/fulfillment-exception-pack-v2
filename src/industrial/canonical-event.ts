/**
 * Canonical Industrial Event —— 多系统统一事件语言。
 *
 * 它在链路里的位置是**明确的**：
 *
 *   OpenSupOSUnsEnvelope（MQTT/UNS 载荷）
 *     → InboundRecord → SourceRecordEnvelope（Connector Core 摄取证据）
 *       → CanonicalIndustrialEvent   ← 本模块
 *         → Domain Write Plan（BusinessEntity / FulfillmentEvent / V2Evidence）
 *           → Rule → Exception → Governance
 *
 * 与 SourceRecordEnvelope 的关系：**不替换、不破坏**。
 * Envelope 回答「哪个连接器、哪条外部记录、哪个 mapping 版本」；
 * Canonical Event 在此之上补两件 Envelope 不该管的事：
 *   1. 工业空间（Enterprise/Site/Area/Line/Equipment）——这是 UNS 语义，不是连接器语义；
 *   2. 原始系统字段名 → 规范字段名的显式翻译清单（来自 Mapping Manifest）。
 *
 * 因此「MES/ERP/QMS/WMS/Finance 最终都映射成同一事件语言」这句话，
 * 在这份类型上是可检查的，而不是口号。
 */
import { createHash } from "node:crypto";
import type { V2SqliteStore } from "../domain/v2/index.js";
import type { SourceRecordEnvelope } from "../connectors/core/types.js";
import { IndustrialSemanticError, type CanonicalIndustrialEvent, type IndustrialHierarchy, type IndustrialMappingManifest, type IndustrialSpace } from "./types.js";
import { industrialEquipmentForDomain, parseIndustrialSpace } from "./hierarchy.js";
import { resolveCanonicalFieldMapping } from "./mapping-manifest.js";
import { buildIndustrialUnsTopic, industrialDomainForEntityType, topicBindingForEventType } from "./uns-topic.js";

export const CANONICAL_INDUSTRIAL_EVENT_SCHEMA_VERSION = "canonical-industrial-event/v1";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** 规范事件 ID：同一条摄取记录 + 同一 mapping 版本 → 同一个 ID（可重放、可去重）。 */
export function canonicalIndustrialEventId(input: {
  tenantId: string;
  connectorId: string;
  externalRecordId: string;
  sourceVersion: string;
  rawHash: string;
  mappingVersion: string;
}) {
  return `cie-${createHash("sha256").update(stableJson(input)).digest("hex").slice(0, 24)}`;
}

/** 已解析的 UNS 信封里，Canonical Event 需要的那些字段。 */
export type CanonicalEventSource = {
  tenantKey: string;
  messageId: string;
  businessContextKey: string;
  sourceSystemKey: string;
  sourceSystemType: import("../domain/v2/index.js").SourceSystemType;
  entityType: string;
  entityBusinessKey: string;
  eventType: string;
  occurredAt: string;
  facts: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export function buildCanonicalIndustrialEvent(input: {
  envelope: SourceRecordEnvelope;
  source: CanonicalEventSource;
  manifest: IndustrialMappingManifest;
  hierarchy: IndustrialHierarchy;
  sourceRecordId?: string | null;
}): CanonicalIndustrialEvent {
  const space = parseIndustrialSpace(input.source.metadata.unsSpace);
  if (!space) throw new IndustrialSemanticError("INDUSTRIAL_SPACE_REQUIRED", input.source.messageId);
  return buildCanonicalIndustrialEventWithSpace({
    ...input,
    space,
  });
}

export function buildCanonicalIndustrialEventWithSpace(input: {
  envelope: SourceRecordEnvelope;
  source: CanonicalEventSource;
  manifest: IndustrialMappingManifest;
  hierarchy: IndustrialHierarchy;
  space: IndustrialSpace;
  sourceRecordId?: string | null;
}): CanonicalIndustrialEvent {
  const { envelope, source, manifest, hierarchy, space } = input;
  const domain = industrialDomainForEntityType(source.entityType);
  const equipmentId = space.equipmentId ?? industrialEquipmentForDomain(hierarchy, space, domain);
  const boundSpace: IndustrialSpace = { ...space, ...(equipmentId ? { equipmentId } : {}) };
  const binding = topicBindingForEventType(source.eventType, source.entityType);
  // UNS 信封里的 facts 已经是规范字段（这是连接器契约），因此这里做的是**反查**：
  // 把每个规范字段翻译回「哪个系统的哪个原始字段、语义上叫什么」。
  const { facts, fieldMapping } = resolveCanonicalFieldMapping({
    manifest,
    sourceSystem: source.sourceSystemType,
    entityTypeCanonical: source.entityType,
    topicEventType: binding.topicEventType,
    facts: source.facts,
  });
  const unsTopic = buildIndustrialUnsTopic({
    space: boundSpace,
    entityType: source.entityType,
    entityId: source.entityBusinessKey,
    eventType: source.eventType,
  });
  return {
    schemaVersion: CANONICAL_INDUSTRIAL_EVENT_SCHEMA_VERSION,
    eventId: canonicalIndustrialEventId({
      tenantId: envelope.tenantId,
      connectorId: envelope.connectorId,
      externalRecordId: envelope.externalRecordId,
      sourceVersion: envelope.sourceVersion,
      rawHash: envelope.rawHash,
      mappingVersion: envelope.mappingVersion,
    }),
    tenantId: envelope.tenantId,
    enterpriseId: boundSpace.enterpriseId,
    siteId: boundSpace.siteId,
    areaId: boundSpace.areaId,
    lineId: boundSpace.lineId,
    equipmentId: boundSpace.equipmentId ?? null,
    sourceSystem: source.sourceSystemKey,
    sourceRecordId: input.sourceRecordId ?? envelope.externalRecordId,
    entityType: source.entityType,
    entityId: source.entityBusinessKey,
    eventType: source.eventType,
    occurredAt: source.occurredAt,
    observedAt: envelope.observedAt,
    payload: facts,
    mappingVersion: envelope.mappingVersion,
    sourceLocator: envelope.locator,
    rawHash: envelope.rawHash,
    unsTopic,
    businessContextKey: source.businessContextKey,
    provenance: {
      connectorId: envelope.connectorId,
      connectorInstallationId: envelope.connectorInstallationId,
      externalRecordId: envelope.externalRecordId,
      recordType: envelope.recordType,
      sourceVersion: envelope.sourceVersion,
      sourceSystemType: source.sourceSystemType,
      fieldMapping,
    },
  };
}

/**
 * 摄取记录的身份键：与 Connector Core 的幂等判据完全一致。
 *
 * 用它把「适配阶段构建的 Canonical Event」与「账本里的 sourceRecordId」对上，
 * 而不是各存一份真相。
 */
export function canonicalEventLedgerKey(input: {
  externalRecordId: string;
  sourceVersion: string;
  rawHash: string;
  mappingId: string;
  mappingVersion: string;
}) {
  return stableJson([input.externalRecordId, input.sourceVersion, input.rawHash, input.mappingId, input.mappingVersion]);
}

/**
 * 用来源账本（Source Ledger）给已构建的 Canonical Event 补上 sourceRecordId。
 *
 * 适配阶段已经拿到 SourceRecordEnvelope 与原始载荷，因此在那里构建 Canonical Event；
 * 账本在事务提交后才产生 record id，所以这里只做一次确定性 join。
 * 对不上账本的 Canonical Event 一律 fail-closed —— 意味着它没有真实摄取证据。
 */
export function joinCanonicalEventsWithLedger(input: {
  store: V2SqliteStore;
  tenantId: string;
  connectorInstallationId: string;
  recordType: string;
  captured: Array<{ event: CanonicalIndustrialEvent; ledgerKey: string }>;
}): CanonicalIndustrialEvent[] {
  const ledgerIds = new Map(
    input.store
      .listConnectorSourceRecords(input.tenantId, input.connectorInstallationId, input.recordType)
      .map((record) => [
        canonicalEventLedgerKey({
          externalRecordId: record.externalRecordId,
          sourceVersion: record.sourceVersion,
          rawHash: record.rawHash,
          mappingId: record.mappingId,
          mappingVersion: record.mappingVersion,
        }),
        record.id,
      ]),
  );
  return input.captured.map(({ event, ledgerKey }) => {
    const sourceRecordId = ledgerIds.get(ledgerKey);
    if (!sourceRecordId) throw new IndustrialSemanticError("CANONICAL_EVENT_WITHOUT_LEDGER_RECORD", event.eventId);
    return { ...event, sourceRecordId };
  });
}
