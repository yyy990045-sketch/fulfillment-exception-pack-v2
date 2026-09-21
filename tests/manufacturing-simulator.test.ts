import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { V2SqliteStore, type SqliteDatabaseLike } from "../src/domain/v2/index.js";
import { INDUSTRIAL_MAPPING_MANIFEST } from "../src/industrial/mapping-manifest.js";
import { DEMO_MANUFACTURING_HIERARCHY } from "../src/industrial/hierarchy.js";
import { parseIndustrialUnsTopic } from "../src/industrial/uns-topic.js";
import {
  DEMO_SIMULATION_TENANT,
  SIMULATION_EPOCH_ISO,
  buildSimulationMessageStream,
  buildSimulatedRecords,
  seededRandom,
} from "../src/simulator/manufacturing/emitter.js";
import { SIMULATION_SCENARIOS, resolveScenario } from "../src/simulator/manufacturing/scenarios.js";
import { InMemorySimulatorTransport, LocalSimulatorTransport, SIMULATOR_UNS_SUBSCRIBE_PATTERN, createSimulatorTransport } from "../src/simulator/manufacturing/transport.js";
import { SIMULATOR_INSTALLATION_ID, runIndustrialSimulation } from "../src/simulator/manufacturing/runner.js";
import { OPEN_SUPOS_RECORD_TYPE } from "../src/integrations/open-supos/connector.js";

type DatabaseSyncConstructor = new (path: string) => SqliteDatabaseLike & { close?(): void };
const builtin = process.getBuiltinModule?.("node:sqlite") as { DatabaseSync?: DatabaseSyncConstructor } | undefined;
if (!builtin?.DatabaseSync) throw new Error("sqlite_backend_requires_node_22_5_or_newer");

function openStore() {
  const directory = mkdtempSync(join(tmpdir(), "fep-industrial-simulator-"));
  const database = new builtin!.DatabaseSync!(join(directory, "simulator.sqlite"));
  database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  return new V2SqliteStore(database);
}

const streamFor = (scenarioId: string, seed = "demo-seed-0001") =>
  buildSimulationMessageStream({
    scenario: resolveScenario(scenarioId),
    seed,
    manifest: INDUSTRIAL_MAPPING_MANIFEST,
    hierarchy: DEMO_MANUFACTURING_HIERARCHY,
  });

describe("Factory Simulator 事件流", () => {
  it("同一个 scenario + seed 生成完全相同的 ID、顺序与数值", () => {
    const first = streamFor("production-shortfall");
    const second = streamFor("production-shortfall");
    expect(first.messages.map((item) => item.envelope.messageId)).toEqual(second.messages.map((item) => item.envelope.messageId));
    expect(first.messages.map((item) => item.topic)).toEqual(second.messages.map((item) => item.topic));
    expect(first.messages.map((item) => item.payload)).toEqual(second.messages.map((item) => item.payload));
    expect(first.messages.map((item) => item.record.sourceFields)).toEqual(second.messages.map((item) => item.record.sourceFields));
  });

  it("不同 seed 不改变业务数值，只改变现场细节（班次/操作员/元数据）", () => {
    const a = streamFor("production-shortfall", "seed-a");
    const b = streamFor("production-shortfall", "seed-b");
    const facts = (stream: typeof a) => stream.messages.map((item) => item.envelope.facts);
    const businessFacts = (stream: typeof a) => stream.messages.map((item) => ({
      entity: item.envelope.entity,
      facts: item.envelope.facts,
    }));
    expect(facts(a)).toEqual(facts(b));
    expect(businessFacts(a)).toEqual(businessFacts(b));
    expect(a.operatorContext).not.toEqual(b.operatorContext);
    expect(a.messages[0]!.envelope.metadata.simulation).toMatchObject({ seed: "seed-a" });
    expect(b.messages[0]!.envelope.metadata.simulation).toMatchObject({ seed: "seed-b" });
  });

  it("按时间发生：时间线严格递增，绝不全部落在同一个 timestamp", () => {
    for (const scenario of SIMULATION_SCENARIOS) {
      const records = buildSimulatedRecords({ scenario, seed: "demo-seed-0001" });
      const timestamps = records.map((item) => item.occurredAt);
      expect(new Set(timestamps).size).toBe(timestamps.length);
      const sorted = [...timestamps].sort();
      expect(timestamps).toEqual(sorted);
      expect(timestamps[0]).toBe(SIMULATION_EPOCH_ISO);
      const spanDays = (Date.parse(timestamps.at(-1)!) - Date.parse(timestamps[0]!)) / 86_400_000;
      expect(spanDays).toBeGreaterThanOrEqual(14);
      expect(records.every((item) => Date.parse(item.observedAt) > Date.parse(item.occurredAt))).toBe(true);
    }
  });

  it("多系统来源成立：每条事件来自它该来自的系统，且覆盖 ERP/MES/QMS/WMS/Finance/CRM/Service", () => {
    const stream = streamFor("normal");
    const byEvent = new Map(stream.messages.map((item) => [item.record.canonicalEventType, item.record.sourceSystemType]));
    expect(byEvent.get("ORDER_CREATED")).toBe("erp");
    expect(byEvent.get("PRODUCTION_COMPLETED")).toBe("mes");
    expect(byEvent.get("QUALITY_PASSED")).toBe("qms");
    expect(byEvent.get("SHIPMENT_DISPATCHED")).toBe("wms");
    expect(byEvent.get("PAYMENT_RECEIVED")).toBe("finance");
    expect(byEvent.get("QUOTE_CREATED")).toBe("crm");
    expect(byEvent.get("COMPLAINT_OPENED")).toBe("manual");
    expect(new Set(stream.messages.map((item) => item.record.sourceSystemKey)).size).toBe(7);
  });

  it("每条事件都带 ISA-95 空间绑定、UNS topic 与 mapping 版本（provenance 完整）", () => {
    const stream = streamFor("normal");
    for (const message of stream.messages) {
      const parsed = parseIndustrialUnsTopic(message.topic);
      expect(parsed.enterpriseId).toBe(DEMO_MANUFACTURING_HIERARCHY.nodes[0]!.id);
      expect(parsed.lineId).toBe("line-a");
      expect(parsed.entityId).toBe(message.record.entityBusinessKey);
      expect(message.envelope.metadata.unsSpace).toMatchObject({
        enterpriseId: "demo-manufacturing",
        siteId: "factory-shanghai-01",
        areaId: "assembly-workshop",
        lineId: "line-a",
      });
      expect(message.envelope.metadata.mappingVersion).toBe("industrial-mapping@1.0.0");
      expect((message.envelope.metadata.unsSpace as { equipmentId?: string }).equipmentId).toBeTruthy();
      expect(message.envelope.lineage.locator).toBeTruthy();
      expect(message.envelope.lineage.quote).toContain("=");
    }
  });

  it("原始字段经 Mapping Manifest 翻译后才进入 UNS 信封；信封里只有规范字段", () => {
    const stream = streamFor("production-shortfall");
    const completed = stream.messages.find((item) => item.record.canonicalEventType === "PRODUCTION_COMPLETED")!;
    expect(completed.record.sourceFields).toEqual({ completed_qty: 96 });
    expect(completed.envelope.facts).toEqual({ completedQty: { value: 96, valueType: "number" } });
    const payment = stream.messages.find((item) => item.record.canonicalEventType === "PAYMENT_RECEIVED")!;
    expect(payment.record.sourceFields).toEqual({ received_amount: 100000 });
    expect(payment.envelope.facts.amount).toEqual({ value: 100000, valueType: "currency" });
  });

  it("PRNG 是确定性的（同一 seed 同一序列）", () => {
    const a = seededRandom("x");
    const b = seededRandom("x");
    const c = seededRandom("y");
    const seriesA = [a(), a(), a()];
    expect(seriesA).toEqual([b(), b(), b()]);
    expect(seriesA).not.toEqual([c(), c(), c()]);
  });

  it("MQTT 形状传输（inmem）与 local 传输产生同一份仿真结果", async () => {
    const localStore = openStore();
    const inmemStore = openStore();
    const scenario = resolveScenario("production-shortfall");
    const seed = "transport-parity";
    const local = await runIndustrialSimulation({
      store: localStore, scenario, transport: new LocalSimulatorTransport(), speed: 0, seed,
    });
    const inmem = await runIndustrialSimulation({
      store: inmemStore, scenario, transport: new InMemorySimulatorTransport(), speed: 0, seed,
    });
    expect(inmem.contextId).toBe(local.contextId);
    expect(inmem.topics).toEqual(local.topics);
    expect(inmem.canonicalEvents.map((item) => item.eventId)).toEqual(local.canonicalEvents.map((item) => item.eventId));
    expect(inmem.exceptionCodes).toEqual(local.exceptionCodes);
    expect(inmem.eventCount).toBe(local.eventCount);
    expect(inmem.evidenceCount).toBe(local.evidenceCount);
    expect(local.transport.serialized).toBe(false);
    expect(inmem.transport.serialized).toBe(true);
    expect(inmem.transport.received).toBe(inmem.messageCount);
    // MQTT 形状传输走的是 topic 通配符订阅，模式必须覆盖 11 段 industrial 式子
    expect(SIMULATOR_UNS_SUBSCRIBE_PATTERN.split("/")).toHaveLength(11);
  });

  it("mqtt 传输在缺少 broker 配置时 fail-closed，绝不假装已投递", async () => {
    const original = process.env.OPEN_SUPOS_MQTT_URL;
    delete process.env.OPEN_SUPOS_MQTT_URL;
    try {
      const store = openStore();
      await expect(runIndustrialSimulation({
        store,
        scenario: resolveScenario("normal"),
        transport: createSimulatorTransport("mqtt"),
        speed: 0,
      })).rejects.toThrow(/UNS_TRANSPORT_NOT_CONFIGURED/);
    } finally {
      if (original === undefined) delete process.env.OPEN_SUPOS_MQTT_URL;
      else process.env.OPEN_SUPOS_MQTT_URL = original;
    }
  });

  it("摄取之后来源账本条目数等于事件数，且每条都能回到 UNS topic", async () => {
    const store = openStore();
    const run = await runIndustrialSimulation({
      store,
      scenario: resolveScenario("shipment-shortfall"),
      transport: new LocalSimulatorTransport(),
      speed: 0,
    });
    const ledger = store.listConnectorSourceRecords(DEMO_SIMULATION_TENANT, SIMULATOR_INSTALLATION_ID, OPEN_SUPOS_RECORD_TYPE);
    expect(ledger).toHaveLength(run.messageCount);
    for (const record of ledger) {
      expect(record.mappingId).toBe("industrial-mapping");
      expect(record.mappingVersion).toBe("1.0.0");
      expect(String(record.locator.topic)).toMatch(/^enterprise\/demo-manufacturing\/site\/factory-shanghai-01\//);
      expect(record.evidenceRefs.length).toBeGreaterThan(0);
      expect(record.canonicalRefs.length).toBeGreaterThan(0);
    }
  });
});
