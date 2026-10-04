/**
 * Factory Simulator 的事件发生器（emitter）。
 *
 * 它不是 fixture loader：
 *   1. 按**时间**发生——每条记录有自己的工业日历时刻（见 PHASE_TIMELINE）；
 *   2. 每条记录来自不同的来源系统角色（ERP / MES / QMS / WMS / Finance / CRM / Service），
 *      并且带的是**该系统自己的原始字段名**（`completed_qty` / `report_qty` / `ar_amount` …）；
 *   3. 原始字段经 Industrial Mapping Manifest 翻译成规范字段，再组装成
 *      与 `OpenSuposInboundConnector` 契约一致的 UNS 信封（禁止另造比赛专用协议）；
 *   4. 同 scenario + seed 必须逐字节可复现：ID、顺序、数值、时间全部由 (scenario, seed) 决定。
 */
import { createHash } from "node:crypto";
import type { EvidenceLocator, SourceSystemType } from "../../domain/v2/index.js";
import { DEMO_MANUFACTURING_HIERARCHY, DEMO_MANUFACTURING_SPACE, industrialEquipmentForDomain, resolveIndustrialSpace } from "../../industrial/hierarchy.js";
import { mapSourceFields, type IndustrialMappingManifest } from "../../industrial/index.js";
import { buildIndustrialUnsTopic, topicBindingForEventType } from "../../industrial/uns-topic.js";
import type { IndustrialHierarchy, IndustrialSpace } from "../../industrial/types.js";
import type { OpenSupOSUnsEnvelope } from "../../integrations/open-supos/types.js";
import type { SimulationScenario } from "./scenarios.js";

/** 仿真基准时刻：2026-09-01 09:00（Asia/Shanghai，以 UTC 表示以便确定性）。 */
export const SIMULATION_EPOCH_ISO = "2026-09-01T01:00:00.000Z";
/** 观测延迟：模拟数据先发生、后被系统写入并同步。 */
export const OBSERVATION_LAG_MINUTES = 5;
/** 一条工业日历分钟在 1x 速度下播放多久（毫秒）：1 天 ≈ 1 秒。 */
export const PLAYBACK_MS_PER_DAY = 1000;

export type SimulatedSourceSystem = {
  key: string;
  type: SourceSystemType;
  name: string;
};

/** 多系统来源：§17「不同事件必须模拟真实不同系统来源」。 */
export const SIMULATED_SOURCE_SYSTEMS = {
  ERP: { key: "ERP-DEMO", type: "erp", name: "ERP Demo" },
  MES: { key: "MES-DEMO", type: "mes", name: "MES Demo" },
  QMS: { key: "QMS-DEMO", type: "qms", name: "QMS Demo" },
  WMS: { key: "WMS-DEMO", type: "wms", name: "WMS Demo" },
  FINANCE: { key: "FINANCE-DEMO", type: "finance", name: "Finance Demo" },
  CRM: { key: "CRM-DEMO", type: "crm", name: "CRM Demo" },
  SERVICE: { key: "SERVICE-DEMO", type: "manual", name: "Service Demo" },
} as const satisfies Record<string, SimulatedSourceSystem>;

type SimulatedSystemName = keyof typeof SIMULATED_SOURCE_SYSTEMS;

export type SimulatedIndustrialRecord = {
  sequence: number;
  /** UNS topic 段使用的事件名，例如 production.completed */
  phase: string;
  canonicalEventType: string;
  occurredAt: string;
  observedAt: string;
  sourceSystemKey: string;
  sourceSystemType: SourceSystemType;
  businessContextKey: string;
  entityType: string;
  entityBusinessKey: string;
  externalDocumentId: string;
  documentType: string;
  sourceVersion: string;
  /** 来源系统的原始字段（Mapping Manifest 的输入），不是规范字段 */
  sourceFields: Record<string, unknown>;
  /** 明确的跨系统业务关系，不依赖各系统 entityId 相同。 */
  sourceRelations: {
    sourceOrderLineRef: string;
    workOrderRef?: string;
    productionLotRef?: string;
    shipmentSourceRef?: string;
  };
  locator: EvidenceLocator;
  quote: string;
};

type PhaseBlueprint = {
  phase: string;
  canonicalEventType: string;
  system: SimulatedSystemName;
  /** 工业日历偏移（分钟） */
  offsetMinutes: number;
  entitySuffix: string;
  sourceFields: (scenario: SimulationScenario, context: { documentKey: string }) => Record<string, unknown>;
};

/**
 * 工业日历：报价 → 订单 → 开工 → 报工 → 完工 → 检验 → 发货 → 签收 → 开票 → 应收 → 回款 → 客诉。
 * 累计 14 天，任何两条事件都不会落在同一个 timestamp。
 */
const PHASE_BLUEPRINTS: PhaseBlueprint[] = [
  {
    phase: "quote.created", canonicalEventType: "QUOTE_CREATED", system: "CRM", offsetMinutes: 0, entitySuffix: "quote",
    sourceFields: (s) => ({ quote_qty: s.parameters.orderQty }),
  },
  {
    phase: "order.created", canonicalEventType: "ORDER_CREATED", system: "ERP", offsetMinutes: 240, entitySuffix: "sales_order",
    sourceFields: (s) => ({ order_qty: s.parameters.orderQty, due_at: s.parameters.dueAt }),
  },
  {
    phase: "production.started", canonicalEventType: "PRODUCTION_STARTED", system: "MES", offsetMinutes: 1440, entitySuffix: "production_order",
    sourceFields: (s) => ({ plan_qty: s.parameters.orderQty }),
  },
  {
    phase: "production.progressed", canonicalEventType: "PRODUCTION_PROGRESSED", system: "MES", offsetMinutes: 1740, entitySuffix: "production_order",
    sourceFields: (s) => ({ report_qty: s.parameters.productionReports[0] ?? s.parameters.productionCompleted }),
  },
  {
    phase: "production.progressed", canonicalEventType: "PRODUCTION_PROGRESSED", system: "MES", offsetMinutes: 2040, entitySuffix: "production_order",
    sourceFields: (s) => ({ report_qty: s.parameters.productionReports[1] ?? s.parameters.productionCompleted }),
  },
  {
    phase: "production.completed", canonicalEventType: "PRODUCTION_COMPLETED", system: "MES", offsetMinutes: 4320, entitySuffix: "production_order",
    sourceFields: (s) => ({ completed_qty: s.parameters.productionCompleted }),
  },
  {
    phase: "quality.inspected", canonicalEventType: "QUALITY_INSPECTED", system: "QMS", offsetMinutes: 5820, entitySuffix: "quality_event",
    sourceFields: (s) => ({ inspected_qty: s.parameters.qualityInspected }),
  },
  {
    phase: "quality.passed", canonicalEventType: "QUALITY_PASSED", system: "QMS", offsetMinutes: 6060, entitySuffix: "quality_event",
    sourceFields: (s) => ({ passed_qty: s.parameters.qualityPassed }),
  },
  {
    phase: "quality.failed", canonicalEventType: "QUALITY_FAILED", system: "QMS", offsetMinutes: 6065, entitySuffix: "quality_event",
    sourceFields: (s) => ({ rejected_qty: s.parameters.qualityFailed }),
  },
  {
    phase: "shipment.created", canonicalEventType: "SHIPMENT_CREATED", system: "WMS", offsetMinutes: 7200, entitySuffix: "shipment",
    sourceFields: (s) => ({ planned_ship_qty: s.parameters.orderQty }),
  },
  {
    phase: "shipment.dispatched", canonicalEventType: "SHIPMENT_DISPATCHED", system: "WMS", offsetMinutes: 7320, entitySuffix: "shipment",
    sourceFields: (s) => ({ execution_committed_qty: s.parameters.shipmentQty }),
  },
  {
    phase: "shipment.received", canonicalEventType: "SHIPMENT_SIGNED", system: "WMS", offsetMinutes: 10080, entitySuffix: "shipment",
    sourceFields: (s) => ({ signed_qty: s.parameters.shipmentQty }),
  },
  {
    phase: "invoice.created", canonicalEventType: "INVOICE_CREATED", system: "FINANCE", offsetMinutes: 10320, entitySuffix: "invoice",
    sourceFields: (s) => ({ invoice_amount: s.parameters.invoiceAmount }),
  },
  {
    phase: "receivable.created", canonicalEventType: "RECEIVABLE_CREATED", system: "FINANCE", offsetMinutes: 10345, entitySuffix: "receivable",
    sourceFields: (s) => ({ ar_amount: s.parameters.receivableAmount }),
  },
  {
    phase: "payment.received", canonicalEventType: "PAYMENT_RECEIVED", system: "FINANCE", offsetMinutes: 17280, entitySuffix: "payment",
    sourceFields: (s) => ({ received_amount: s.parameters.paymentAmount }),
  },
  {
    phase: "complaint.created", canonicalEventType: "COMPLAINT_OPENED", system: "SERVICE", offsetMinutes: 20160, entitySuffix: "complaint",
    sourceFields: (s) => ({ claimed_received_qty: s.parameters.claimedReceivedQty }),
  },
];

const ENTITY_PREFIX: Record<string, string> = {
  quote: "QT",
  sales_order: "SO",
  production_order: "MO",
  quality_event: "QC",
  shipment: "SH",
  invoice: "INV",
  receivable: "AR",
  payment: "PAY",
  complaint: "CP",
};

/** 确定性 PRNG：同一 seed 得到同一序列，绝不依赖 Math.random。 */
export function seededRandom(seed: string) {
  const digest = createHash("sha256").update(seed).digest();
  let state = digest.readUInt32LE(0) || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type SimulationOperatorContext = {
  shift: string;
  operatorId: string;
  workstation: string;
};

/**
 * seed 只影响「不影响判定结果的现场细节」：班次、操作员、报工时刻的分钟级抖动。
 * 这是刻意的：seed 改变的是现场质感，不是业务结论。
 */
export function simulationOperatorContext(input: {
  seed: string;
  scenario: SimulationScenario;
  space: IndustrialSpace;
  hierarchy: IndustrialHierarchy;
}): SimulationOperatorContext {
  const random = seededRandom(`${input.seed}:${input.scenario.id}:context`);
  const shifts = ["day", "night"];
  const operators = ["op-1042", "op-2087", "op-3310", "op-4519"];
  const domain = input.scenario.id === "quality-failure" ? "quality" : "production";
  const workstation = industrialEquipmentForDomain(input.hierarchy, input.space, domain) ?? input.space.lineId;
  return {
    shift: shifts[Math.floor(random() * shifts.length)] ?? "day",
    operatorId: operators[Math.floor(random() * operators.length)] ?? operators[0]!,
    workstation,
  };
}

function isoFromMinutes(baseIso: string, minutes: number) {
  return new Date(Date.parse(baseIso) + minutes * 60_000).toISOString();
}

function sourceProgressAt(scenario: SimulationScenario) {
  // 模拟连接器 checkpoint：这是“截至该时间以前的数据已完整”的承诺，
  // 与单条事件的 latestEventTime 有意分开。
  return isoFromMinutes(scenario.parameters.dueAt, 360);
}

function documentKeyFor(scenario: SimulationScenario, entityType: string) {
  const index = scenario.businessKey.replace(/^SO-IND-/, "");
  return `${ENTITY_PREFIX[entityType] ?? "DOC"}-IND-${index}`;
}

/**
 * 生成一次仿真的完整记录流：按场景 + seed 完全确定。
 * 时间线单调递增，任何两条事件不会共享 timestamp。
 */
export function buildSimulatedRecords(input: {
  scenario: SimulationScenario;
  seed: string;
  space?: IndustrialSpace;
  baseIso?: string;
}): SimulatedIndustrialRecord[] {
  const space = input.space ?? deriveSpace();
  const baseIso = input.baseIso ?? SIMULATION_EPOCH_ISO;
  const random = seededRandom(`${input.seed}:${input.scenario.id}:timeline`);
  const seenPhaseCount = new Map<string, number>();
  return PHASE_BLUEPRINTS.map((blueprint, index) => {
    const system = SIMULATED_SOURCE_SYSTEMS[blueprint.system];
    // 报工时刻加入 ±90 分钟确定性抖动（不会跨过相邻事件，也不影响任何判定字段）
    const jitter = blueprint.canonicalEventType === "PRODUCTION_PROGRESSED" ? Math.round((random() - 0.5) * 180) : 0;
    const occurredAt = isoFromMinutes(baseIso, blueprint.offsetMinutes + jitter);
    const entityBusinessKey = documentKeyFor(input.scenario, blueprint.entitySuffix);
    const phaseCount = (seenPhaseCount.get(blueprint.phase) ?? 0) + 1;
    seenPhaseCount.set(blueprint.phase, phaseCount);
    const sourceFields = blueprint.sourceFields(input.scenario, { documentKey: entityBusinessKey });
    const sourceOrderLineRef = `ERP:${input.scenario.businessKey}:LINE-01`;
    return {
      sequence: index,
      phase: blueprint.phase,
      canonicalEventType: blueprint.canonicalEventType,
      occurredAt,
      observedAt: isoFromMinutes(occurredAt, OBSERVATION_LAG_MINUTES),
      sourceSystemKey: system.key,
      sourceSystemType: system.type,
      businessContextKey: input.scenario.businessKey,
      entityType: blueprint.entitySuffix,
      entityBusinessKey,
      externalDocumentId: entityBusinessKey,
      documentType: blueprint.entitySuffix,
      sourceVersion: "v1",
      sourceFields,
      sourceRelations: {
        sourceOrderLineRef,
        ...(blueprint.system === "MES" ? { workOrderRef: `MES:${entityBusinessKey}` } : {}),
        ...(blueprint.system === "QMS" ? { productionLotRef: `QMS:${entityBusinessKey}:LOT-01` } : {}),
        ...(blueprint.system === "WMS" ? { shipmentSourceRef: `WMS:${entityBusinessKey}` } : {}),
      },
      locator: { fileName: `${entityBusinessKey}.json`, row: phaseCount, line: phaseCount },
      quote: Object.entries(sourceFields).map(([key, value]) => `${key}=${String(value)}`).join(" "),
    };
  }).sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.sequence - right.sequence);
}

function deriveSpace(): IndustrialSpace {
  const space: IndustrialSpace = { ...DEMO_MANUFACTURING_SPACE };
  resolveIndustrialSpace(DEMO_MANUFACTURING_HIERARCHY, space);
  return space;
}

export type SimulatedUnsMessage = {
  record: SimulatedIndustrialRecord;
  topic: string;
  envelope: OpenSupOSUnsEnvelope;
  payload: string;
};

/**
 * 原始记录 → UNS 信封 + topic。
 *
 * 关键：`sourceFields`（原始字段名）经 Mapping Manifest 翻译成规范字段后，
 * 才进入信封的 `facts`。未在 manifest 中声明的字段会直接失败（fail-closed）。
 */
export function buildUnsMessage(input: {
  record: SimulatedIndustrialRecord;
  scenario: SimulationScenario;
  seed: string;
  manifest: IndustrialMappingManifest;
  hierarchy: IndustrialHierarchy;
  space: IndustrialSpace;
  operatorContext: SimulationOperatorContext;
}): SimulatedUnsMessage {
  const { record, scenario, manifest, hierarchy, space, operatorContext } = input;
  const binding = topicBindingForEventType(record.canonicalEventType, record.entityType);
  const { facts } = mapSourceFields({
    manifest,
    sourceSystem: record.sourceSystemType,
    entityTypeCanonical: record.entityType,
    topicEventType: binding.topicEventType,
    fields: record.sourceFields,
  });
  const equipmentId = industrialEquipmentForDomain(hierarchy, space, binding.domain);
  const boundSpace: IndustrialSpace = { ...space, ...(equipmentId ? { equipmentId } : {}) };
  const phaseOrdinal = input.record.locator.row ?? 1;
  const envelope: OpenSupOSUnsEnvelope = {
    schemaVersion: "1.0",
    messageId: `${record.sourceSystemKey}:${record.externalDocumentId}:${record.sourceVersion}:${binding.topicEventType}-${phaseOrdinal}`,
    tenantKey: DEMO_SIMULATION_TENANT,
    context: { businessKey: record.businessContextKey, contextType: "sales_order" },
    source: {
      systemKey: record.sourceSystemKey,
      systemType: record.sourceSystemType,
      externalDocumentId: record.externalDocumentId,
      documentType: record.documentType,
      sourceVersion: record.sourceVersion,
    },
    entity: { entityType: record.entityType, businessKey: record.entityBusinessKey },
    event: { eventType: record.canonicalEventType, occurredAt: record.occurredAt },
    facts: Object.fromEntries(Object.entries(facts).map(([field, fact]) => [field, {
      value: fact.value as OpenSupOSUnsEnvelope["facts"][string]["value"],
      valueType: fact.valueType,
    }])),
    lineage: { locator: record.locator, quote: record.quote, confidence: 1 },
    metadata: {
      recordedAt: record.observedAt,
      ruleProfile: "manufacturing",
      unsSpace: boundSpace,
      mappingVersion: `${manifest.id}@${manifest.version}`,
      simulation: {
        environment: "SIMULATED INDUSTRIAL ENVIRONMENT",
        scenario: scenario.id,
        businessKey: scenario.businessKey,
        seed: input.seed,
        phase: record.phase,
        sequence: record.sequence,
        sourceFieldNames: Object.keys(record.sourceFields),
        lineage: record.sourceRelations,
        sourceProgressAt: sourceProgressAt(scenario),
        checkpointKind: "demo-source-checkpoint",
        shift: operatorContext.shift,
        operatorId: operatorContext.operatorId,
        workstation: operatorContext.workstation,
      },
    },
  };
  const topic = buildIndustrialUnsTopic({
    space: boundSpace,
    entityType: record.entityType,
    entityId: record.entityBusinessKey,
    eventType: record.canonicalEventType,
  });
  return { record, topic, envelope, payload: JSON.stringify(envelope) };
}

/** 仿真租户：与真实租户命名空间隔离，避免仿真数据混入真实治理视图。 */
export const DEMO_SIMULATION_TENANT = "demo-manufacturing";

export function buildSimulationMessageStream(input: {
  scenario: SimulationScenario;
  seed: string;
  manifest: IndustrialMappingManifest;
  hierarchy?: IndustrialHierarchy;
  space?: IndustrialSpace;
  baseIso?: string;
}): { messages: SimulatedUnsMessage[]; operatorContext: SimulationOperatorContext; space: IndustrialSpace; records: SimulatedIndustrialRecord[] } {
  const hierarchy = input.hierarchy ?? DEMO_MANUFACTURING_HIERARCHY;
  const space = input.space ?? deriveSpace();
  const records = buildSimulatedRecords({ scenario: input.scenario, seed: input.seed, space, ...(input.baseIso ? { baseIso: input.baseIso } : {}) });
  const operatorContext = simulationOperatorContext({ seed: input.seed, scenario: input.scenario, space, hierarchy });
  const messages = records.map((record) =>
    buildUnsMessage({ record, scenario: input.scenario, seed: input.seed, manifest: input.manifest, hierarchy, space, operatorContext }),
  );
  return { messages, operatorContext, space, records };
}
