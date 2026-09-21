/**
 * Judge Trace —— 从 Exception 一路回源到原始系统。
 *
 *   Exception
 *     ↓  这条异常由哪次规则评估产生
 *   Rule Evaluation
 *     ↓  评估引用了哪些证据、各自扮演什么角色
 *   Evidence
 *     ↓  这条证据来自账本里的哪一条摄取记录
 *   Source Ledger
 *     ↓  摄取时记录的载荷哈希，与留存载荷重算的哈希是否一致
 *   rawHash
 *     ↓  用哪个 mapping 版本翻译的，该版本是否仍可解析
 *   Mapping Version
 *     ↓  这条记录是在哪个 UNS topic / 哪个外部对象上读到的
 *   Source Locator / UNS Topic
 *     ↓  规范化之后是哪一条工业事件
 *   Canonical Industrial Event
 *     ↓
 *   Original Source System
 *
 * 关键取舍：**拿不到留存载荷就不算通过**。没有载荷就没有"rawHash 与内容一致"这句话，
 * 因此不允许把"未检查"当成"已验证"。
 */
import { connectorRawHash } from "../connectors/index.js";
import {
  INDUSTRIAL_MAPPING_ID,
  INDUSTRIAL_MAPPING_VERSION,
  canonicalIndustrialEventId,
  industrialSpaceOfContext,
} from "../industrial/index.js";
import type { V2SqliteStore } from "../domain/v2/index.js";
import { parseUnsTopic } from "../integrations/open-supos/topic-mapper.js";
import { canonicalEventTypeForTopicEvent } from "../industrial/uns-topic.js";
import {
  emptyUnsPayloadSource,
  lookupUnsPayload,
  readUnsStream,
  type UnsPayloadSource,
} from "./payload-source.js";
import {
  EVIDENCE_TRACE_HOPS,
  EVIDENCE_TRACE_SCHEMA_VERSION,
  type EvidenceTraceHop,
  type EvidenceTraceReport,
  type TraceCheck,
  type TraceEvidenceLink,
  type TraceabilityProvenanceMode,
} from "./types.js";

export type BuildEvidenceTraceInput = {
  store: V2SqliteStore;
  tenantId: string;
  contextId: string;
  /** 缺省时对整个 Context 的全部证据做回源检查（evidence:verify --context） */
  exceptionId?: string | null;
  /** 留存载荷路径（judge workspace 的 uns-stream.jsonl） */
  payloadSourcePath?: string | null;
  payloadSource?: UnsPayloadSource;
  now?: () => Date;
};

function check(hop: EvidenceTraceHop, id: string, label: string, ok: boolean, detail: string): TraceCheck {
  return { id, hop, label, status: ok ? "pass" : "fail", detail };
}

function provenanceModeOf(store: V2SqliteStore, tenantId: string, contextId: string): TraceabilityProvenanceMode {
  const context = store.getContext(tenantId, contextId);
  if (context && industrialSpaceOfContext(context)) return "connector_required";
  return "legacy_fixture";
}

function ledgerRecordsForEvidence(store: V2SqliteStore, tenantId: string, evidenceId: string) {
  return store.listConnectorInstallations(tenantId).flatMap((installation) =>
    store.listConnectorSourceRecords(tenantId, installation.id)
      .filter((record) => record.evidenceRefs.includes(evidenceId)));
}

function mappingVersionRegistered(store: V2SqliteStore, tenantId: string, mappingId: string, version: string) {
  return store.listConnectorMappingVersions(tenantId).some((item) => item.mappingId === mappingId && item.version === version);
}

export function buildEvidenceTrace(input: BuildEvidenceTraceInput): EvidenceTraceReport {
  const { store, tenantId, contextId } = input;
  const now = input.now ?? (() => new Date());
  const replay = store.replayContext(tenantId, contextId);
  const provenanceMode = provenanceModeOf(store, tenantId, contextId);
  const payloadSource = input.payloadSource
    ?? (input.payloadSourcePath ? readUnsStream(input.payloadSourcePath) : emptyUnsPayloadSource(null));

  const exception = input.exceptionId
    ? store.listExceptions(tenantId, contextId).find((item) => item.id === input.exceptionId)
    : undefined;
  if (input.exceptionId && !exception) {
    return {
      schemaVersion: EVIDENCE_TRACE_SCHEMA_VERSION,
      tenantId,
      contextId,
      exceptionId: input.exceptionId,
      exceptionCode: null,
      provenanceMode,
      status: "EVIDENCE_NOT_VERIFIABLE",
      payloadSource: payloadSourceSummary(payloadSource, input.payloadSourcePath ?? null),
      hops: [...EVIDENCE_TRACE_HOPS],
      evidence: [],
      failures: [`EXCEPTION_NOT_FOUND:${input.exceptionId}`],
      platformObservedCount: 0,
      checkedAt: now().toISOString(),
    };
  }

  const bundle = exception ? store.getExceptionEvidenceBundle(tenantId, exception.id) : undefined;
  const evidenceRows = exception
    ? (bundle?.evidence ?? [])
    : replay.evidence;
  const roleByEvidenceId = new Map((bundle?.evidence ?? []).map((item) => [item.evidenceId, item.role]));
  const entityById = new Map(replay.entities.map((item) => [item.id, item]));
  const documentById = new Map(replay.documents.map((item) => [item.id, item]));
  const sourceSystemById = new Map(replay.sourceSystems.map((item) => [item.id, item]));

  const links: TraceEvidenceLink[] = evidenceRows.map((evidence) => {
    const checks: TraceCheck[] = [];
    const entity = evidence.entityId ? entityById.get(evidence.entityId) : undefined;
    const document = documentById.get(evidence.sourceDocumentId);
    checks.push(check("evidence", "evidence.exists", "Evidence 记录存在", true,
      `${evidence.field}=${String(evidence.value)} (${evidence.valueType})`));
    checks.push(check("evidence", "evidence.source_document", "来源材料可定位", Boolean(document),
      document ? `${document.externalDocumentId}@${document.version} (${document.documentType})` : "来源材料缺失"));

    const ledgerRecords = ledgerRecordsForEvidence(store, tenantId, evidence.id);
    const ledger = ledgerRecords.length === 1 ? ledgerRecords[0]! : null;
    // 明确声明的平台自观测（例如执行后回读）不主张连接器来源，因此不算"断链"，
    // 但也**永远不会**被当成源系统证据：闸门只接受 provenanceClass === "connector"。
    const declaredPlatformObserved = evidence.metadata.source === "execution_readback";
    const provenanceClass: TraceEvidenceLink["provenanceClass"] = ledger
      ? "connector"
      : declaredPlatformObserved
        ? "platform_observed"
        : "unknown";
    const ledgerCheckOk = Boolean(ledger) || provenanceClass === "platform_observed";
    checks.push(check("source_ledger", "ledger.record", ledger
      ? "Source Ledger 记录唯一可定位"
      : provenanceClass === "platform_observed"
        ? "平台自观测（未声明连接器来源，不作为源系统证据）"
        : `缺少 Source Ledger 记录（无法回源，且未声明来源类别）`,
      ledgerCheckOk,
      ledger ? ledger.id : `matches=${ledgerRecords.length} provenance=${provenanceClass}`));

    const payloadEntry = ledger
      ? lookupUnsPayload(payloadSource, { externalRecordId: ledger.externalRecordId })
      : null;
    const payloadAvailable = Boolean(payloadEntry);
    if (ledger) {
      checks.push(check("raw_hash", "payload.retained", "留存载荷可用", payloadAvailable,
        payloadAvailable
          ? `${payloadSource.path}`
          : `未找到 externalRecordId=${ledger.externalRecordId} 的留存载荷`));
    }

    const recomputed = payloadEntry ? connectorRawHash(payloadEntry.envelope) : null;
    if (ledger) {
      checks.push(check("raw_hash", "raw_hash.match", "rawHash 与留存载荷一致",
        Boolean(recomputed) && recomputed === ledger.rawHash,
        recomputed ? `ledger=${ledger.rawHash.slice(0, 16)}… recomputed=${recomputed.slice(0, 16)}…` : "无法重算 rawHash"));
    }

    const mappingOk = ledger
      ? mappingVersionRegistered(store, tenantId, ledger.mappingId, ledger.mappingVersion)
      : false;
    if (ledger) {
      checks.push(check("mapping_version", "mapping.registered", "mapping 版本可解析", mappingOk,
        `${ledger.mappingId}@${ledger.mappingVersion}${mappingOk ? "" : " 未注册"}`));
    }

    const topic = typeof ledger?.locator.topic === "string" ? ledger.locator.topic : null;
    const locatorOk = Boolean(ledger?.locator && Object.keys(ledger.locator).length > 0);
    if (ledger) {
      checks.push(check("source_locator", "locator.present", "来源位置可复核", locatorOk,
        locatorOk ? `${Object.keys(ledger.locator).length} 个定位字段` : "locator 为空"));
      checks.push(check("uns_topic", "uns.topic", "UNS topic 存在且可解析", Boolean(topic), topic ?? "缺少 topic"));
      if (topic) {
        let parsedId: string | null = null;
        let parsedEvent: string | null = null;
        let canonicalFromTopic: string | null = null;
        let parseError: string | null = null;
        try {
          const parsed = parseUnsTopic(topic);
          if (parsed.form === "industrial") {
            parsedId = parsed.entityId;
            parsedEvent = parsed.eventType;
            // topic 段用的是点分小写事件名，账本里存的是规范事件类型；
            // 必须用同一张映射表回查，而不是自己拼字符串。
            canonicalFromTopic = canonicalEventTypeForTopicEvent(parsed.domain, parsed.topicEventType);
          } else {
            parsedId = parsed.entityBusinessKey;
            parsedEvent = parsed.eventType;
            canonicalFromTopic = parsed.eventType;
          }
        } catch (error) {
          parseError = error instanceof Error ? error.message : "parse_failed";
        }
        const locatorEntity = String(ledger.locator.entityBusinessKey ?? "");
        const ledgerEventType = String(ledger.locator.eventType ?? "");
        const topicMatches = !parseError
          && parsedId === locatorEntity
          && canonicalFromTopic === ledgerEventType;
        checks.push(check("uns_topic", "uns.topic.consistency", "topic 与账本对象/事件一致", topicMatches,
          parseError ?? `topic=${parsedId}/${parsedEvent}→${canonicalFromTopic ?? "?"} ledger=${locatorEntity}/${ledgerEventType}`));
      }
    }

    const canonicalEventId = ledger
      ? canonicalIndustrialEventId({
        tenantId: ledger.tenantId,
        connectorId: ledger.connectorId,
        externalRecordId: ledger.externalRecordId,
        sourceVersion: ledger.sourceVersion,
        rawHash: ledger.rawHash,
        mappingVersion: ledger.mappingVersion,
      })
      : null;
    if (ledger) {
      checks.push(check("canonical_industrial_event", "canonical.event_id", "Canonical Industrial Event 可重算",
        Boolean(canonicalEventId), canonicalEventId ?? "无法重算"));
    }

    const payloadSourceSystemKey = typeof payloadEntry?.envelope.source === "object" && payloadEntry.envelope.source
      ? String((payloadEntry.envelope.source as Record<string, unknown>).systemKey ?? "")
      : "";
    const sourceSystemType = sourceSystemById.get(evidence.sourceSystemId)?.systemType ?? null;
    if (ledger) {
      // 只有连接器摄取的证据才有可比对的载荷来源；平台自观测不参与这项检查。
      checks.push(check("source_system", "source_system.match", "来源系统与证据一致",
        Boolean(payloadSourceSystemKey) && payloadSourceSystemKey === evidence.sourceSystemId,
        payloadSourceSystemKey
          ? `payload=${payloadSourceSystemKey} evidence=${evidence.sourceSystemId}`
          : "载荷中缺少 source.systemKey"));
    }

    return {
      evidenceId: evidence.id,
      provenanceClass,
      field: evidence.field,
      value: evidence.value,
      valueType: evidence.valueType,
      quote: evidence.quote,
      observedAt: evidence.observedAt,
      entityType: entity?.entityType ?? null,
      entityId: evidence.entityId ?? null,
      entityBusinessKey: entity?.businessKey ?? null,
      sourceSystemId: evidence.sourceSystemId,
      sourceDocumentId: evidence.sourceDocumentId,
      sourceVersion: evidence.sourceVersion,
      role: roleByEvidenceId.get(evidence.id) ?? "context",
      ledger: ledger
        ? {
          recordId: ledger.id,
          externalRecordId: ledger.externalRecordId,
          rawHash: ledger.rawHash,
          rawHashRecomputed: recomputed,
          mappingId: ledger.mappingId,
          mappingVersion: ledger.mappingVersion,
          observedAt: ledger.observedAt,
          canonicalRefs: ledger.canonicalRefs.length,
          evidenceRefs: ledger.evidenceRefs.length,
        }
        : null,
      locator: ledger?.locator ?? {},
      unsTopic: topic,
      unsNamespace: typeof ledger?.locator.namespace === "string" ? ledger.locator.namespace : null,
      canonicalEventId,
      sourceSystemKey: payloadSourceSystemKey || null,
      sourceSystemType,
      checks,
    };
  });

  const failures = links.flatMap((link) =>
    link.checks.filter((item) => item.status === "fail").map((item) => `${link.evidenceId}:${item.id}`));
  const platformObservedCount = links.filter((link) => link.provenanceClass === "platform_observed").length;

  if (provenanceMode === "legacy_fixture" && !links.some((link) => link.ledger)) {
    // 历史合成 fixture 不主张连接器来源：闸门明确 not_applicable，而不是假称已验证。
    return {
      schemaVersion: EVIDENCE_TRACE_SCHEMA_VERSION,
      tenantId,
      contextId,
      exceptionId: input.exceptionId ?? null,
      exceptionCode: exception?.code ?? null,
      provenanceMode,
      status: "EVIDENCE_TRACE_NOT_APPLICABLE",
      payloadSource: payloadSourceSummary(payloadSource, input.payloadSourcePath ?? null),
      hops: [...EVIDENCE_TRACE_HOPS],
      evidence: links,
      failures: [...failures, "LEGACY_FIXTURE_PROVENANCE:no_connector_ledger"],
      platformObservedCount,
      checkedAt: now().toISOString(),
    };
  }

  if (!links.length) failures.push("NO_EVIDENCE_TO_TRACE");
  const status = failures.length === 0 ? "EVIDENCE_TRACE_VERIFIED" : "EVIDENCE_NOT_VERIFIABLE";
  return {
    schemaVersion: EVIDENCE_TRACE_SCHEMA_VERSION,
    tenantId,
    contextId,
    exceptionId: input.exceptionId ?? null,
    exceptionCode: exception?.code ?? null,
    provenanceMode,
    status,
    payloadSource: payloadSourceSummary(payloadSource, input.payloadSourcePath ?? null),
    hops: [...EVIDENCE_TRACE_HOPS],
    evidence: links,
    failures,
    platformObservedCount,
    checkedAt: now().toISOString(),
  };
}

function normalizedEvent(value: string | null) {
  return (value ?? "").replace(/\./g, "_").toUpperCase();
}

function payloadSourceSummary(source: UnsPayloadSource, path: string | null) {
  return {
    path: source.path ?? path,
    available: source.available,
    entries: source.entries,
    unparsable: source.unparsable,
  };
}

/** 只用真值回源：期望/实际两个关键事实必须各自落到明确的来源系统上（不合成、不推断）。 */
export function keyFactsFromTrace(report: EvidenceTraceReport) {
  const expected = report.evidence.find((item) => item.role === "expected");
  const actual = report.evidence.find((item) => item.role === "actual");
  return {
    expected: expected ?? null,
    actual: actual ?? null,
    sourceSystems: [...new Set(report.evidence.map((item) => item.sourceSystemId))].sort(),
  };
}

/** 供 `evidence:verify` 与 judge manifest 复用的默认 mapping 标识。 */
export const TRACE_DEFAULT_MAPPING = {
  mappingId: INDUSTRIAL_MAPPING_ID,
  mappingVersion: INDUSTRIAL_MAPPING_VERSION,
} as const;
