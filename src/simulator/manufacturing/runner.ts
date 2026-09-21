/**
 * 仿真运行器：把 Factory Simulator 接到既有 Connector Runtime 上。
 *
 * 全链路（不新增 ingestion framework、不改 Core）：
 *
 *   1. provision：安装 manufacturing pack + 7 条规则版本（与 open-supos A/B 契约同一套规则）
 *   2. build context：按场景 businessKey 建 Context，并绑定 pack（规则解析需要显式绑定）
 *   3. emit：emitter 生成带时间的多系统原始记录 → mapping manifest → UNS 信封 + topic
 *   4. transport：local / inmem / mqtt 三种方式送进 `OpenSupOSUnsQueue`
 *   5. ingest：既有 `runInboundSync` 负责 Source Ledger / cursor / 幂等 / 重放
 *   6. canonical：SourceRecordEnvelope → CanonicalIndustrialEvent（补工业空间 + 字段翻译清单）
 *   7. domain：既有 `OpenSuposSourceAdapter` 产出 BusinessEntity / Event / Evidence
 *   8. rules：`evaluateContextRules` → Rule Evaluation
 *   9. exception：异常候选落库（异常数量与编码由规则引擎决定，不由本模块决定）
 */
import { createHash } from "node:crypto";
import {
  MANUFACTURING_RULE_DEFINITIONS,
  MANUFACTURING_RULE_VERSIONS,
  evaluateContextRules,
  type V2SqliteStore,
} from "../../domain/v2/index.js";
import { installConnector, runInboundSync } from "../../connectors/index.js";
import type { AdaptedSourceRecord, SourceAdapter, SourceRecordEnvelope } from "../../connectors/core/types.js";
import { bindPackContext, manufacturingFulfillmentPack, registerBuiltInSolutionPacks } from "../../solution-packs/index.js";
import {
  INDUSTRIAL_MAPPING_ID,
  INDUSTRIAL_MAPPING_MANIFEST,
  INDUSTRIAL_MAPPING_VERSION,
  buildCanonicalIndustrialEvent,
  canonicalEventLedgerKey,
  joinCanonicalEventsWithLedger,
  type CanonicalEventSource,
  type CanonicalIndustrialEvent,
  type IndustrialContextSummary,
  type IndustrialHierarchy,
  type IndustrialMappingManifest,
  type IndustrialSpace,
} from "../../industrial/index.js";
import { DEMO_MANUFACTURING_HIERARCHY, industrialSpaceRootPath } from "../../industrial/hierarchy.js";
import { buildIndustrialContextSummary } from "../../industrial/context-summary.js";
import { parseOpenSupOSUnsEnvelope } from "../../integrations/open-supos/envelope.js";
import {
  OPEN_SUPOS_INBOUND_MANIFEST,
  OPEN_SUPOS_RECORD_TYPE,
  OpenSuposInboundConnector,
  OpenSuposSourceAdapter,
  OpenSupOSUnsQueue,
} from "../../integrations/open-supos/connector.js";
import type { OpenSupOSUnsEnvelope } from "../../integrations/open-supos/types.js";
import { DEMO_SIMULATION_TENANT, buildSimulationMessageStream, type SimulatedUnsMessage } from "./emitter.js";
import type { SimulationScenario } from "./scenarios.js";
import { DEFAULT_SIMULATION_SEED } from "./scenarios.js";
import type { SimulatorTransport, TransportDelivery } from "./transport.js";

export const SIMULATOR_INSTALLATION_ID = "industrial-simulator-uns-installation";

export const DEMO_PHASES = [
  "reset_isolated_demo_workspace",
  "start_simulator",
  "emit_events",
  "ingest",
  "build_context",
  "create_evidence",
  "evaluate_rules",
  "generate_exception",
  "resolution_capability",
  "analytics_projection",
] as const;

export type DemoPhase = (typeof DEMO_PHASES)[number];

export function provisionSimulationTenant(store: V2SqliteStore, tenantId: string, actor: string) {
  registerBuiltInSolutionPacks();
  manufacturingFulfillmentPack.install(store, tenantId, actor, { ruleProfile: "manufacturing" });
  for (const definition of MANUFACTURING_RULE_DEFINITIONS) store.saveRuleDefinition({ ...definition, tenantId });
  for (const version of MANUFACTURING_RULE_VERSIONS) {
    store.saveRuleVersion({ ...version, tenantId });
    store.retireRuleVersionsExcept(tenantId, version.ruleId, version.id);
  }
  return {
    packId: manufacturingFulfillmentPack.manifest.id,
    ruleDefinitions: MANUFACTURING_RULE_DEFINITIONS.length,
    ruleVersions: MANUFACTURING_RULE_VERSIONS.length,
  };
}

export function registerIndustrialMappingVersion(
  store: V2SqliteStore,
  tenantId: string,
  manifest: IndustrialMappingManifest = INDUSTRIAL_MAPPING_MANIFEST,
) {
  return store.saveConnectorMappingVersion({
    tenantId,
    connectorId: OPEN_SUPOS_INBOUND_MANIFEST.id,
    mappingId: INDUSTRIAL_MAPPING_ID,
    version: INDUSTRIAL_MAPPING_VERSION,
    effectiveAt: "2026-09-01T00:00:00.000Z",
    definitionHash: manifest.contentHash,
    description: "Industrial Mapping Manifest（来源系统原始字段 → 统一工业语义 → UNS/规范字段）",
    createdAt: "2026-09-01T00:00:00.000Z",
  });
}

export function canonicalSourceFromEnvelope(envelope: OpenSupOSUnsEnvelope): CanonicalEventSource {
  return {
    tenantKey: envelope.tenantKey,
    messageId: envelope.messageId,
    businessContextKey: envelope.context.businessKey,
    sourceSystemKey: envelope.source.systemKey,
    sourceSystemType: envelope.source.systemType,
    entityType: envelope.entity.entityType,
    entityBusinessKey: envelope.entity.businessKey,
    eventType: envelope.event.eventType,
    occurredAt: envelope.event.occurredAt,
    facts: Object.fromEntries(Object.entries(envelope.facts).map(([key, fact]) => [key, fact.value])),
    metadata: envelope.metadata,
  };
}

/**
 * 域适配器：在既有 `OpenSuposSourceAdapter` 之前插入 Canonical Industrial Event。
 *
 * 这里不复制领域映射逻辑：领域写计划仍然完全由既有适配器产出，
 * 本类只负责「多系统统一语义 + 工业空间 + 字段翻译清单」这一段，
 * 并把 Canonical Event 捕获下来，供账本 join 使用。
 */
export class IndustrialSimulatorAdapter implements SourceAdapter {
  private readonly base: OpenSuposSourceAdapter;
  readonly captured: Array<{ event: CanonicalIndustrialEvent; ledgerKey: string }> = [];

  constructor(
    store: V2SqliteStore,
    private readonly manifest: IndustrialMappingManifest,
    private readonly hierarchy: IndustrialHierarchy,
  ) {
    this.base = new OpenSuposSourceAdapter(store);
  }

  contextForEnvelope(envelope: OpenSupOSUnsEnvelope) {
    return this.base.contextForEnvelope(envelope);
  }

  adapt(envelope: SourceRecordEnvelope): AdaptedSourceRecord {
    const parsed = parseOpenSupOSUnsEnvelope(envelope.payload);
    const event = buildCanonicalIndustrialEvent({
      envelope,
      source: canonicalSourceFromEnvelope(parsed),
      manifest: this.manifest,
      hierarchy: this.hierarchy,
    });
    this.captured.push({
      event,
      ledgerKey: canonicalEventLedgerKey({
        externalRecordId: envelope.externalRecordId,
        sourceVersion: envelope.sourceVersion,
        rawHash: envelope.rawHash,
        mappingId: envelope.mappingId,
        mappingVersion: envelope.mappingVersion,
      }),
    });
    return this.base.adapt(envelope);
  }
}

export type SimulationRunOptions = {
  store: V2SqliteStore;
  scenario: SimulationScenario;
  transport: SimulatorTransport;
  seed?: string;
  speed?: number;
  tenantId?: string;
  installationId?: string;
  pageSize?: number;
  hierarchy?: IndustrialHierarchy;
  manifest?: IndustrialMappingManifest;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  onMessage?: (message: { topic: string; envelope: OpenSupOSUnsEnvelope }) => void;
  /** MQTT 连接参数（仅 mqtt transport 使用，绝不打印凭据） */
  transportOptions?: {
    url?: string;
    username?: string;
    password?: string;
    clientId?: string;
    connectionTimeoutMs?: number;
    ackTimeoutMs?: number;
  };
};

export type SimulationRunResult = {
  scenario: string;
  scenarioLabel: string;
  seed: string;
  businessKey: string;
  contextId: string;
  space: IndustrialSpace | null;
  unsRootPath: string | null;
  transport: TransportDelivery;
  sync: {
    status: string;
    recordsRead: number;
    recordsAccepted: number;
    recordsCommitted: number;
    recordsDuplicate: number;
    ledgerRecords: number;
  };
  messageCount: number;
  topics: string[];
  /** 实际发布出去的那一串 UNS 消息（原始载荷留存的来源） */
  emittedMessages: Array<{ topic: string; payload: string }>;
  canonicalEvents: CanonicalIndustrialEvent[];
  sourceSystems: string[];
  eventCount: number;
  evidenceCount: number;
  evaluationCount: number;
  matchedRuleCount: number;
  notMatchedRuleCount: number;
  exceptionCount: number;
  exceptionCodes: string[];
  exceptionIds: string[];
  summary: IndustrialContextSummary;
  timing: {
    firstOccurredAt: string | null;
    lastOccurredAt: string | null;
    spanMinutes: number;
    wallClockMs: number;
  };
};

function dedupe(values: string[]) {
  return [...new Set(values)];
}

export async function runIndustrialSimulation(options: SimulationRunOptions): Promise<SimulationRunResult> {
  const tenantId = options.tenantId ?? DEMO_SIMULATION_TENANT;
  const installationId = options.installationId ?? SIMULATOR_INSTALLATION_ID;
  const seed = options.seed ?? DEFAULT_SIMULATION_SEED;
  const hierarchy = options.hierarchy ?? DEMO_MANUFACTURING_HIERARCHY;
  const manifest = options.manifest ?? INDUSTRIAL_MAPPING_MANIFEST;
  const now = options.now ?? (() => new Date());
  const pageSize = options.pageSize ?? 100;

  provisionSimulationTenant(options.store, tenantId, "industrial-simulator");
  registerIndustrialMappingVersion(options.store, tenantId, manifest);

  const stream = buildSimulationMessageStream({ scenario: options.scenario, seed, manifest, hierarchy });
  const messages = stream.messages;
  const first = messages[0];
  if (!first) throw new Error("SIMULATION_PRODUCED_NO_MESSAGES");

  const adapter = new IndustrialSimulatorAdapter(options.store, manifest, hierarchy);
  const context = adapter.contextForEnvelope(first.envelope);
  if (!options.store.getContext(context.tenantId, context.id)) options.store.saveContext(context);
  bindPackContext(options.store, manufacturingFulfillmentPack, tenantId, context.id, "industrial-simulator");

  const queue = new OpenSupOSUnsQueue();
  const connector = new OpenSuposInboundConnector(queue);
  installConnector(options.store, connector, {
    tenantId,
    installationId,
    config: { topicPrefix: "enterprise" },
    actor: "industrial-simulator",
  });

  const startedAt = Date.now();
  const delivery = await options.transport.deliver({
    messages,
    queue,
    speed: options.speed ?? 0,
    ...(options.sleep ? { sleep: options.sleep } : {}),
    ...(options.onMessage ? { onMessage: options.onMessage } : {}),
    ...(options.transportOptions ? { mqtt: options.transportOptions } : {}),
  });

  let evaluationCount = 0;
  let matchedRuleCount = 0;
  let notMatchedRuleCount = 0;
  const sync = await runInboundSync(options.store, connector, {
    tenantId,
    connectorInstallationId: installationId,
    recordType: OPEN_SUPOS_RECORD_TYPE,
    mappingId: INDUSTRIAL_MAPPING_ID,
    mappingVersion: INDUSTRIAL_MAPPING_VERSION,
    adapter,
    cursor: null,
    pageSize,
    now,
    afterPageCommit: ({ contextIds }) => {
      for (const id of contextIds) {
        const evaluated = evaluateContextRules(options.store, tenantId, id);
        if (!evaluated) continue;
        evaluationCount += evaluated.results.length;
        matchedRuleCount += evaluated.results.filter((item) => item.evaluation.status === "matched").length;
        notMatchedRuleCount += evaluated.results.filter((item) => item.evaluation.status === "not_matched").length;
      }
    },
  });

  const canonicalEvents = joinCanonicalEventsWithLedger({
    store: options.store,
    tenantId,
    connectorInstallationId: installationId,
    recordType: OPEN_SUPOS_RECORD_TYPE,
    captured: adapter.captured,
  })
    .map((event) => ({
      ...event,
      eventId: event.eventId,
      sourceRecordId: event.sourceRecordId,
    }))
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.entityType.localeCompare(right.entityType));

  const replay = options.store.replayContext(tenantId, context.id);
  const exceptions = options.store.listExceptions(tenantId, context.id);
  const summary = buildIndustrialContextSummary(options.store, tenantId, context.id, hierarchy);
  if (!summary) throw new Error("INDUSTRIAL_CONTEXT_SUMMARY_UNAVAILABLE");
  const occurredAtValues = messages.map((item) => item.record.occurredAt).sort();
  const firstOccurredAt = occurredAtValues[0] ?? null;
  const lastOccurredAt = occurredAtValues.at(-1) ?? null;

  return {
    scenario: options.scenario.id,
    scenarioLabel: options.scenario.label,
    seed,
    businessKey: options.scenario.businessKey,
    contextId: context.id,
    space: summary.space,
    unsRootPath: summary.space ? industrialSpaceRootPath(summary.space) : null,
    transport: delivery,
    sync: {
      status: sync.run.status,
      recordsRead: sync.run.recordsRead,
      recordsAccepted: sync.run.recordsAccepted,
      recordsCommitted: sync.run.recordsCommitted,
      recordsDuplicate: sync.run.recordsDuplicate,
      ledgerRecords: options.store.listConnectorSourceRecords(tenantId, installationId, OPEN_SUPOS_RECORD_TYPE).length,
    },
    messageCount: messages.length,
    topics: dedupe(messages.map((item) => item.topic)),
    emittedMessages: messages.map((item) => ({ topic: item.topic, payload: item.payload })),
    canonicalEvents,
    sourceSystems: dedupe(replay.evidence.map((item) => item.sourceSystemId)).sort(),
    eventCount: replay.events.length,
    evidenceCount: replay.evidence.length,
    evaluationCount,
    matchedRuleCount,
    notMatchedRuleCount,
    exceptionCount: exceptions.length,
    exceptionCodes: dedupe(exceptions.map((item) => item.code)).sort(),
    exceptionIds: exceptions.map((item) => item.id).sort(),
    summary,
    timing: {
      firstOccurredAt,
      lastOccurredAt,
      spanMinutes: firstOccurredAt && lastOccurredAt
        ? Math.round((Date.parse(lastOccurredAt) - Date.parse(firstOccurredAt)) / 60_000)
        : 0,
      wallClockMs: Date.now() - startedAt,
    },
  };
}

export type SimulationReplayResult = {
  duplicateMessages: number;
  duplicateLedgerRecords: number;
  newEvents: number;
  newExceptions: number;
  exceptionsBefore: number;
  exceptionsAfter: number;
  checkpointRecordsRead: number;
  idempotent: boolean;
  failures: string[];
};

/**
 * 重放：把同一批 UNS 消息按「broker 重新投递」再次送入（cursor=null）。
 * 期望：新账本 = 0、新事件 = 0、新异常 = 0；沿用已提交 cursor 再跑一次则不应重复读取。
 */
export async function replayIndustrialSimulation(input: {
  store: V2SqliteStore;
  scenario: SimulationScenario;
  transport: SimulatorTransport;
  seed?: string;
  speed?: number;
  tenantId?: string;
  installationId?: string;
  pageSize?: number;
  hierarchy?: IndustrialHierarchy;
  manifest?: IndustrialMappingManifest;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}): Promise<SimulationReplayResult> {
  const tenantId = input.tenantId ?? DEMO_SIMULATION_TENANT;
  const installationId = input.installationId ?? SIMULATOR_INSTALLATION_ID;
  const seed = input.seed ?? DEFAULT_SIMULATION_SEED;
  const hierarchy = input.hierarchy ?? DEMO_MANUFACTURING_HIERARCHY;
  const manifest = input.manifest ?? INDUSTRIAL_MAPPING_MANIFEST;
  const now = input.now ?? (() => new Date());
  const pageSize = input.pageSize ?? 100;

  const stream = buildSimulationMessageStream({ scenario: input.scenario, seed, manifest, hierarchy });
  const adapter = new IndustrialSimulatorAdapter(input.store, manifest, hierarchy);
  const context = adapter.contextForEnvelope(stream.messages[0]!.envelope);
  const before = snapshot(input.store, tenantId, installationId, context.id);

  const queue = new OpenSupOSUnsQueue();
  const connector = new OpenSuposInboundConnector(queue);
  const replayDelivery = await input.transport.deliver({
    messages: stream.messages,
    queue,
    speed: input.speed ?? 0,
    ...(input.sleep ? { sleep: input.sleep } : {}),
  });
  const replaySync = await runInboundSync(input.store, connector, {
    tenantId,
    connectorInstallationId: installationId,
    recordType: OPEN_SUPOS_RECORD_TYPE,
    mappingId: INDUSTRIAL_MAPPING_ID,
    mappingVersion: INDUSTRIAL_MAPPING_VERSION,
    adapter,
    cursor: null,
    pageSize,
    now,
    afterPageCommit: ({ contextIds }) => {
      for (const id of contextIds) evaluateContextRules(input.store, tenantId, id);
    },
  });
  const after = snapshot(input.store, tenantId, installationId, context.id);

  // checkpoint：沿用已提交 cursor 再跑一次，不应重复读取任何记录
  const checkpointSync = await runInboundSync(input.store, connector, {
    tenantId,
    connectorInstallationId: installationId,
    recordType: OPEN_SUPOS_RECORD_TYPE,
    mappingId: INDUSTRIAL_MAPPING_ID,
    mappingVersion: INDUSTRIAL_MAPPING_VERSION,
    adapter,
    pageSize,
    now,
  });

  const failures: string[] = [];
  if (replaySync.run.recordsRead !== stream.messages.length) failures.push(`duplicateMessages=${replaySync.run.recordsRead}`);
  if (after.ledgerRecords - before.ledgerRecords !== 0) failures.push(`newLedgerRecords=${after.ledgerRecords - before.ledgerRecords}`);
  if (after.events - before.events !== 0) failures.push(`newEvents=${after.events - before.events}`);
  if (after.exceptions - before.exceptions !== 0) failures.push(`newExceptions=${after.exceptions - before.exceptions}`);
  if (checkpointSync.run.recordsRead !== 0) failures.push(`checkpointRecordsRead=${checkpointSync.run.recordsRead}`);
  void replayDelivery;

  return {
    duplicateMessages: replaySync.run.recordsRead,
    duplicateLedgerRecords: after.ledgerRecords - before.ledgerRecords,
    newEvents: after.events - before.events,
    newExceptions: after.exceptions - before.exceptions,
    exceptionsBefore: before.exceptions,
    exceptionsAfter: after.exceptions,
    checkpointRecordsRead: checkpointSync.run.recordsRead,
    idempotent: failures.length === 0,
    failures,
  };
}

function snapshot(store: V2SqliteStore, tenantId: string, installationId: string, contextId: string) {
  const replay = store.replayContext(tenantId, contextId);
  return {
    ledgerRecords: store.listConnectorSourceRecords(tenantId, installationId, OPEN_SUPOS_RECORD_TYPE).length,
    events: replay.events.length,
    exceptions: store.listExceptions(tenantId, contextId).length,
  };
}

/** 仿真工作区指纹：用于把「同一份仿真」与「同一份产物」对应起来（可复核）。 */
export function simulationFingerprint(input: { scenario: string; seed: string; messages: SimulatedUnsMessage[] }) {
  return createHash("sha256")
    .update(JSON.stringify({
      scenario: input.scenario,
      seed: input.seed,
      stream: input.messages.map((item) => ({ topic: item.topic, payload: item.payload })),
    }))
    .digest("hex");
}
