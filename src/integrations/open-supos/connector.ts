/**
 * open supOS → Connector Core 的桥接（push 语义映射到既有 InboundConnector 契约）。
 *
 * 不新增 ingestion framework：这里只做两件事
 *   1. `OpenSupOSUnsQueue` 把 MQTT/UNS 推来的消息缓冲成 `readPage` 能消费的页，
 *      并给出**我们自己的 checkpoint cursor**（occurredAt#messageId，不是 provider cursor）；
 *   2. `OpenSuposInboundConnector` 把每条消息映射成 Connector Core 的 `InboundRecord`，
 *      交给既有 `runInboundSync` 去负责 Source Ledger / cursor / 重放 / 幂等 / 下游完成标记。
 *
 * 领域适配复用既有 `mapUnsEnvelopeToDomainPlan`：Core 侧拿到的只是
 * SourceRecordEnvelope（tenantId/installationId/externalRecordId/recordType/occurredAt/
 * observedAt/sourceVersion/locator/rawHash/mappingId/mappingVersion/payload），
 * 不感知任何 open supOS 特有字段。
 */
import type { V2SqliteStore } from "../../domain/v2/index.js";
import {
  ConnectorError,
  type AdaptedSourceRecord,
  type ConnectorManifest,
  type InboundConnector,
  type InboundReadPageInput,
  type InboundReadPageResult,
  type InboundRecord,
  type SourceAdapter,
  type SourceRecordEnvelope,
} from "../../connectors/core/types.js";
import { parseOpenSupOSUnsEnvelope } from "./envelope.js";
import { mapUnsEnvelopeToDomainPlan } from "./mapper.js";
import { parseIndustrialSpace } from "../../industrial/hierarchy.js";
import type { OpenSupOSUnsEnvelope } from "./types.js";

export const OPEN_SUPOS_INBOUND_MANIFEST: ConnectorManifest = {
  id: "open-supos-uns-inbound",
  version: "1.0.0",
  name: "open supOS UNS Inbound",
  description: "Reads open supOS UNS/MQTT messages through the shared inbound connector runtime.",
  direction: "inbound",
  capabilities: ["read_records"],
  audience: "internal_operations",
  effects: {
    customerFacing: false,
    financialMovement: false,
    legalEffect: false,
  },
  compatibility: { coreApiVersion: "1" },
};

export const OPEN_SUPOS_MAPPING_ID = "open-supos-uns";
export const OPEN_SUPOS_MAPPING_VERSION = "1.0.0";
export const OPEN_SUPOS_RECORD_TYPE = "OPEN_SUPOS.UNS.EVENT";

/**
 * 允许的 topic 前缀：legacy `fulfillment` 与正式 UNS 式子 `enterprise/*`。
 * 两者都集中定义在 src/industrial/uns-topic.ts，这里只做白名单。
 */
export const UNS_TOPIC_PREFIXES = ["fulfillment", "enterprise"] as const;

export type OpenSupOSUnsMessage = {
  topic: string;
  payload: string;
  envelope: OpenSupOSUnsEnvelope;
};

/**
 * 我们自己的 checkpoint cursor：`occurredAt#messageId`。
 *
 * 官方 README 没有为 UNS/MQTT 提供 offset/cursor，因此这里显式声明是
 * 「调用方 checkpoint」，不是 provider cursor：按 (occurredAt, messageId) 单调排序，
 * 重放同一条消息不会越过 checkpoint，也不会跳读。
 */
export function openSupOSCheckpointCursor(envelope: OpenSupOSUnsEnvelope) {
  return `${envelope.event.occurredAt}#${envelope.messageId}`;
}

export class OpenSupOSUnsQueue {
  private readonly buffered: Array<{ cursor: string; record: InboundRecord }> = [];

  push(message: OpenSupOSUnsMessage) {
    const { envelope, topic } = message;
    const cursor = openSupOSCheckpointCursor(envelope);
    if (this.buffered.some((item) => item.cursor === cursor)) return false;
    const space = parseIndustrialSpace(envelope.metadata?.unsSpace);
    this.buffered.push({
      cursor,
      record: {
        externalRecordId: envelope.messageId,
        recordType: OPEN_SUPOS_RECORD_TYPE,
        occurredAt: envelope.event.occurredAt,
        observedAt: new Date().toISOString(),
        sourceVersion: envelope.source.sourceVersion,
        locator: {
          // provenance：这条记录来自哪个 open supOS namespace / topic / 对象
          namespace: space ? `enterprise/${space.enterpriseId}` : `fulfillment/${envelope.tenantKey}`,
          topic,
          contextBusinessKey: envelope.context.businessKey,
          entityType: envelope.entity.entityType,
          entityBusinessKey: envelope.entity.businessKey,
          eventType: envelope.event.eventType,
          messageId: envelope.messageId,
          // 工业空间坐标：只有带 unsSpace 绑定的信封才有（UNS 原生式子的产品）
          ...(space
            ? {
              enterpriseId: space.enterpriseId,
              siteId: space.siteId,
              areaId: space.areaId,
              lineId: space.lineId,
              ...(space.equipmentId ? { equipmentId: space.equipmentId } : {}),
            }
            : {}),
        },
        payload: envelope as unknown as Record<string, unknown>,
      },
    });
    this.buffered.sort((left, right) => (left.cursor < right.cursor ? -1 : left.cursor > right.cursor ? 1 : 0));
    return true;
  }

  get pending() {
    return this.buffered.length;
  }

  readAfter(cursor: string | null, pageSize: number): { records: InboundRecord[]; nextCursor: string | null; hasMore: boolean } {
    const remaining = cursor ? this.buffered.filter((item) => item.cursor > cursor) : [...this.buffered];
    const page = remaining.slice(0, Math.max(1, pageSize));
    const nextCursor = page.length > 0 ? page[page.length - 1]!.cursor : cursor;
    return {
      records: page.map((item) => item.record),
      nextCursor,
      hasMore: remaining.length > page.length,
    };
  }
}

export function validateOpenSuposInboundConfig(config: Record<string, unknown>) {
  const topicPrefix = typeof config.topicPrefix === "string" ? config.topicPrefix.trim() : "";
  if (topicPrefix && !UNS_TOPIC_PREFIXES.includes(topicPrefix as (typeof UNS_TOPIC_PREFIXES)[number])) {
    throw new ConnectorError("CONNECTOR_TOPIC_PREFIX_INVALID", 422, { retryable: false });
  }
  return { topicPrefix: topicPrefix || "fulfillment" };
}

export class OpenSuposInboundConnector implements InboundConnector {
  readonly manifest = OPEN_SUPOS_INBOUND_MANIFEST;

  constructor(private readonly queue: OpenSupOSUnsQueue) {}

  validateConfig(config: Record<string, unknown>) {
    return validateOpenSuposInboundConfig(config);
  }

  async readPage(input: InboundReadPageInput): Promise<InboundReadPageResult> {
    validateOpenSuposInboundConfig(input.installation.config);
    const page = this.queue.readAfter(input.cursor, input.pageSize);
    return {
      records: page.records,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      observedAt: input.now?.().toISOString() ?? new Date().toISOString(),
    };
  }
}

/**
 * SourceRecordEnvelope → 领域写计划。
 * payload 里承载的是原始 open supOS UNS 信封，适配只做既有映射，不改写数值。
 */
export class OpenSuposSourceAdapter implements SourceAdapter {
  constructor(private readonly store: V2SqliteStore) {}

  /** 由 UNS 信封声明派生出的业务上下文（connector 不发明上下文，只按 businessKey 对齐） */
  contextForEnvelope(envelope: OpenSupOSUnsEnvelope) {
    return mapUnsEnvelopeToDomainPlan(envelope).context;
  }

  /** 由 base/topic 派生出的业务上下文（connector 不发明上下文，只按信封声明的 businessKey 对齐） */
  contextFor(envelope: SourceRecordEnvelope) {
    return this.contextForEnvelope(parseOpenSupOSUnsEnvelope(envelope.payload));
  }

  adapt(envelope: SourceRecordEnvelope): AdaptedSourceRecord {
    const plan = mapUnsEnvelopeToDomainPlan(parseOpenSupOSUnsEnvelope(envelope.payload));
    return {
      contextId: plan.context.id,
      sourceSystems: [plan.sourceSystem],
      sourceDocuments: [plan.sourceDocument],
      entities: [plan.businessEntity],
      events: [plan.event],
      evidence: plan.evidence,
    };
  }
}
