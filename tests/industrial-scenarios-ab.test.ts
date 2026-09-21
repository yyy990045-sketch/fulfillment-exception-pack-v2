import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { V2SqliteStore, type SqliteDatabaseLike } from "../src/domain/v2/index.js";
import { LocalSimulatorTransport } from "../src/simulator/manufacturing/transport.js";
import { replayIndustrialSimulation, runIndustrialSimulation } from "../src/simulator/manufacturing/runner.js";
import { DEFAULT_SIMULATION_SEED, SIMULATION_SCENARIOS, resolveScenario } from "../src/simulator/manufacturing/scenarios.js";

type DatabaseSyncConstructor = new (path: string) => SqliteDatabaseLike & { close?(): void };
const builtin = process.getBuiltinModule?.("node:sqlite") as { DatabaseSync?: DatabaseSyncConstructor } | undefined;
if (!builtin?.DatabaseSync) throw new Error("sqlite_backend_requires_node_22_5_or_newer");

function openStore() {
  const directory = mkdtempSync(join(tmpdir(), "fep-industrial-scenarios-"));
  const database = new builtin!.DatabaseSync!(join(directory, "scenarios.sqlite"));
  database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  return new V2SqliteStore(database);
}

const EXPECTED: Record<string, string[]> = {
  normal: [],
  "production-shortfall": ["ORDER_PRODUCTION_COMPLETION_SHORTFALL"],
  "quality-failure": ["QUALITY_NONCONFORMING_QUANTITY_DETECTED", "SHIPMENT_QUANTITY_SHORTFALL"],
  "shipment-shortfall": ["SHIPMENT_QUANTITY_SHORTFALL"],
  "payment-shortfall": ["PAYMENT_BALANCE_OUTSTANDING"],
};

describe("制造业仿真场景 A/B", () => {
  it("场景期望与代码声明一致（防止断言与场景定义脱节）", () => {
    for (const scenario of SIMULATION_SCENARIOS) {
      expect([...scenario.expectation.exceptionCodes].sort()).toEqual([...EXPECTED[scenario.id]!].sort());
      expect(scenario.expectation.evaluations).toBe(7);
    }
  });

  it.each(SIMULATION_SCENARIOS.map((item) => item.id))("%s：完整链路结果与期望一致", async (scenarioId) => {
    const store = openStore();
    const scenario = resolveScenario(scenarioId);
    const run = await runIndustrialSimulation({
      store,
      scenario,
      transport: new LocalSimulatorTransport(),
      seed: DEFAULT_SIMULATION_SEED,
      speed: 0,
    });
    expect(run.sync.status).toBe("succeeded");
    expect(run.messageCount).toBe(16);
    expect(run.sync.recordsAccepted).toBe(run.messageCount);
    expect(run.sync.recordsDuplicate).toBe(0);
    expect(run.sync.ledgerRecords).toBe(run.messageCount);
    expect(run.canonicalEvents).toHaveLength(run.messageCount);
    expect(run.eventCount).toBe(run.messageCount);
    expect(run.evidenceCount).toBe(run.messageCount);
    expect(run.evaluationCount).toBe(7);
    expect(run.notMatchedRuleCount + run.matchedRuleCount).toBe(7);
    expect([...run.exceptionCodes].sort()).toEqual([...EXPECTED[scenarioId]!].sort());
    expect(run.exceptionCount).toBe(EXPECTED[scenarioId]!.length);
    expect(run.sourceSystems).toHaveLength(7);
    expect(run.summary.environment).toBe("SIMULATED INDUSTRIAL ENVIRONMENT");
    expect(run.summary.truthfulness.realFactory).toBe(false);
  });

  it("normal 必须 0 异常，production-shortfall 必须恰好 1 个 —— 这是判别力而不是「什么都报异常」", async () => {
    const normal = await runIndustrialSimulation({
      store: openStore(),
      scenario: resolveScenario("normal"),
      transport: new LocalSimulatorTransport(),
      speed: 0,
    });
    const shortfall = await runIndustrialSimulation({
      store: openStore(),
      scenario: resolveScenario("production-shortfall"),
      transport: new LocalSimulatorTransport(),
      speed: 0,
    });
    expect(normal.evaluationCount).toBe(shortfall.evaluationCount);
    expect(normal.exceptionCount).toBe(0);
    expect(shortfall.exceptionCount).toBe(1);
    expect(shortfall.exceptionCodes).toEqual(["ORDER_PRODUCTION_COMPLETION_SHORTFALL"]);
  });

  it("quality-failure 的第二个异常是真实的 QMS→WMS 因果级联，不是重复计数", async () => {
    const store = openStore();
    const run = await runIndustrialSimulation({
      store,
      scenario: resolveScenario("quality-failure"),
      transport: new LocalSimulatorTransport(),
      speed: 0,
    });
    expect(run.exceptionCodes).toContain("QUALITY_NONCONFORMING_QUANTITY_DETECTED");
    expect(run.exceptionCodes).toContain("SHIPMENT_QUANTITY_SHORTFALL");
    const [qualityException] = store.listExceptions("demo-manufacturing", run.contextId)
      .filter((item) => item.code === "QUALITY_NONCONFORMING_QUANTITY_DETECTED");
    expect(qualityException).toBeDefined();
    expect(qualityException!.metrics).toMatchObject({ expected: 100, actual: 94, nonconformingQty: 6 });
    const [shipmentException] = store.listExceptions("demo-manufacturing", run.contextId)
      .filter((item) => item.code === "SHIPMENT_QUANTITY_SHORTFALL");
    expect(shipmentException!.metrics).toMatchObject({ expected: 100, actual: 94, shortfall: 6 });
  });

  it("重放幂等：新账本 = 0、新事件 = 0、新异常 = 0，且 cursor 不重复读取", async () => {
    for (const scenarioId of SIMULATION_SCENARIOS.map((item) => item.id)) {
      const store = openStore();
      const scenario = resolveScenario(scenarioId);
      await runIndustrialSimulation({ store, scenario, transport: new LocalSimulatorTransport(), seed: DEFAULT_SIMULATION_SEED, speed: 0 });
      const replay = await replayIndustrialSimulation({
        store, scenario, transport: new LocalSimulatorTransport(), seed: DEFAULT_SIMULATION_SEED, speed: 0,
      });
      expect(replay.duplicateMessages).toBe(16);
      expect(replay.duplicateLedgerRecords).toBe(0);
      expect(replay.newEvents).toBe(0);
      expect(replay.newExceptions).toBe(0);
      expect(replay.checkpointRecordsRead).toBe(0);
      expect(replay.idempotent).toBe(true);
      expect(replay.failures).toEqual([]);
    }
  });

  it("异常从证据能前向追溯到多系统的原始事实", async () => {
    const store = openStore();
    const run = await runIndustrialSimulation({
      store,
      scenario: resolveScenario("payment-shortfall"),
      transport: new LocalSimulatorTransport(),
      speed: 0,
    });
    const exception = store.listExceptions("demo-manufacturing", run.contextId)[0]!;
    const bundle = store.getExceptionEvidenceBundle("demo-manufacturing", exception.id)!;
    expect(bundle.sourceSystems.map((item) => item.id).sort()).toEqual(["FINANCE-DEMO"]);
    expect(bundle.evidence.map((item) => item.sourceSystemId)).toEqual(["FINANCE-DEMO", "FINANCE-DEMO"]);
    expect(bundle.evidence.every((item) => item.quote.length > 0)).toBe(true);
    expect(bundle.evidence.every((item) => Boolean(item.observedAt))).toBe(true);
  });
});
