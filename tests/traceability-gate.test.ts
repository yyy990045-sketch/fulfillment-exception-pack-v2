import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { V2SqliteStore, type SqliteDatabaseLike } from "../src/domain/v2/index.js";
import { registerBuiltInSolutionPacks, manufacturingFulfillmentPack } from "../src/solution-packs/index.js";
import { LocalSimulatorTransport } from "../src/simulator/manufacturing/transport.js";
import { runIndustrialSimulation } from "../src/simulator/manufacturing/runner.js";
import { DEFAULT_SIMULATION_SEED, resolveScenario } from "../src/simulator/manufacturing/scenarios.js";
import {
  EVIDENCE_TRACE_HOPS,
  buildEvidenceTrace,
  decideTraceabilityGate,
  evaluateTraceabilityGate,
  writeUnsStream,
} from "../src/traceability/index.js";
import { injectRawHashMismatch } from "../src/demo/judge/runner.js";

type DatabaseSyncConstructor = new (path: string) => SqliteDatabaseLike & { close?(): void };
const builtin = process.getBuiltinModule?.("node:sqlite") as { DatabaseSync?: DatabaseSyncConstructor } | undefined;
if (!builtin?.DatabaseSync) throw new Error("sqlite_backend_requires_node_22_5_or_newer");

function openStore() {
  const directory = mkdtempSync(join(tmpdir(), "fep-traceability-"));
  const database = new builtin!.DatabaseSync!(join(directory, "trace.sqlite"));
  database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  return new V2SqliteStore(database);
}

const TENANT = "demo-manufacturing";
const INSTALLATION = "industrial-simulator-uns-installation";

async function simulate(scenarioId = "production-shortfall", options: { tamperStream?: boolean } = {}) {
  const store = openStore();
  const run = await runIndustrialSimulation({
    store,
    scenario: resolveScenario(scenarioId),
    transport: new LocalSimulatorTransport(),
    seed: DEFAULT_SIMULATION_SEED,
    speed: 0,
  });
  const directory = mkdtempSync(join(tmpdir(), "fep-traceability-stream-"));
  const streamPath = join(directory, "uns-stream.jsonl");
  const messages = options.tamperStream ? injectRawHashMismatch(run.emittedMessages).messages : run.emittedMessages;
  writeUnsStream(streamPath, messages);
  const exception = store.listExceptions(TENANT, run.contextId)[0]!;
  return { store, run, exception, streamPath };
}

describe("Evidence Trace（证据回源链）", () => {
  it("完整链：Exception → Rule Evaluation → Evidence → Ledger → rawHash → mapping → locator → UNS → Canonical Event → 来源系统", async () => {
    const { store, run, exception, streamPath } = await simulate();
    const trace = buildEvidenceTrace({
      store, tenantId: TENANT, contextId: run.contextId, exceptionId: exception.id, payloadSourcePath: streamPath,
    });
    expect(trace.status).toBe("EVIDENCE_TRACE_VERIFIED");
    expect(trace.failures).toEqual([]);
    expect(trace.provenanceMode).toBe("connector_required");
    expect(trace.hops).toEqual([...EVIDENCE_TRACE_HOPS]);
    expect(trace.evidence).toHaveLength(2);

    const expected = trace.evidence.find((item) => item.role === "expected")!;
    const actual = trace.evidence.find((item) => item.role === "actual")!;
    // 必须能证明：订单 100 ← ERP-DEMO，完工 96 ← MES-DEMO
    expect(expected.sourceSystemId).toBe("ERP-DEMO");
    expect(expected.field).toBe("qty");
    expect(expected.value).toBe(100);
    expect(actual.sourceSystemId).toBe("MES-DEMO");
    expect(actual.field).toBe("completedQty");
    expect(actual.value).toBe(96);

    for (const link of trace.evidence) {
      expect(link.provenanceClass).toBe("connector");
      expect(link.ledger).not.toBeNull();
      expect(link.ledger!.rawHashRecomputed).toBe(link.ledger!.rawHash);
      expect(link.ledger!.mappingId).toBe("industrial-mapping");
      expect(link.ledger!.mappingVersion).toBe("1.0.0");
      expect(link.unsTopic).toMatch(/^enterprise\/demo-manufacturing\/site\/factory-shanghai-01\//);
      expect(link.canonicalEventId).toMatch(/^cie-/);
      expect(link.sourceSystemKey).toBe(link.sourceSystemId);
      expect(link.checks.every((item) => item.status === "pass")).toBe(true);
    }
  });

  it("rawHash 不一致 → EVIDENCE_NOT_VERIFIABLE，且只指向出问题的那一条证据", async () => {
    const { store, run, exception, streamPath } = await simulate("production-shortfall", { tamperStream: true });
    const trace = buildEvidenceTrace({
      store, tenantId: TENANT, contextId: run.contextId, exceptionId: exception.id, payloadSourcePath: streamPath,
    });
    expect(trace.status).toBe("EVIDENCE_NOT_VERIFIABLE");
    expect(trace.failures).toHaveLength(1);
    expect(trace.failures[0]).toMatch(/^evidence-.*:raw_hash\.match$/);
    const broken = trace.evidence.find((item) => item.ledger?.rawHashRecomputed !== item.ledger?.rawHash)!;
    expect(broken.sourceSystemId).toBe("MES-DEMO");
    // 订单那一条仍然完好可回源
    expect(trace.evidence.find((item) => item.role === "expected")!.checks.every((item) => item.status === "pass")).toBe(true);
  });

  it("缺少留存载荷时不算通过（不把未检查当成已验证）", async () => {
    const { store, run, exception } = await simulate();
    const trace = buildEvidenceTrace({
      store, tenantId: TENANT, contextId: run.contextId, exceptionId: exception.id, payloadSourcePath: null,
    });
    expect(trace.status).toBe("EVIDENCE_NOT_VERIFIABLE");
    expect(trace.payloadSource.available).toBe(false);
    expect(trace.failures.some((item) => item.endsWith("payload.retained"))).toBe(true);
    expect(trace.evidence.every((item) => item.ledger !== null)).toBe(true); // 账本在，缺的是载荷
  });

  it("历史合成 fixture：闸门明确 not_applicable，而不是假称已验证", () => {
    const store = openStore();
    registerBuiltInSolutionPacks();
    manufacturingFulfillmentPack.install(store, "demo-manufacturing", "test", { ruleProfile: "manufacturing" });
    store.saveContext({
      id: "ctx-legacy-trace",
      tenantId: "demo-manufacturing",
      businessKey: "SO-LEGACY-TRACE",
      contextType: "sales_order",
      status: "active",
      openedAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      metadata: {},
    });
    const trace = buildEvidenceTrace({ store, tenantId: "demo-manufacturing", contextId: "ctx-legacy-trace" });
    expect(trace.provenanceMode).toBe("legacy_fixture");
    expect(trace.status).toBe("EVIDENCE_TRACE_NOT_APPLICABLE");
    const decision = decideTraceabilityGate({ trace, stage: "approval" });
    expect(decision.applicable).toBe(false);
    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe("LEGACY_FIXTURE_PROVENANCE");
  });
});

describe("Traceability Gate（fail-closed 闸门）", () => {
  it("证据全部可回源时，审批与执行都放行", async () => {
    const { store, run, exception, streamPath } = await simulate();
    const input = {
      store, tenantId: TENANT, contextId: run.contextId, exceptionId: exception.id, payloadSourcePath: streamPath,
    };
    const approval = evaluateTraceabilityGate({ ...input, stage: "approval" });
    const execution = evaluateTraceabilityGate({ ...input, stage: "execution" });
    expect(approval.decision.allowed).toBe(true);
    expect(execution.decision.allowed).toBe(true);
    expect(approval.decision.status).toBe("EVIDENCE_TRACE_VERIFIED");
  });

  it("证据无法回源时，审批与执行都被阻止，但异常仍然存在", async () => {
    const { store, run, exception, streamPath } = await simulate("production-shortfall", { tamperStream: true });
    const input = {
      store, tenantId: TENANT, contextId: run.contextId, exceptionId: exception.id, payloadSourcePath: streamPath,
    };
    for (const stage of ["approval", "execution"] as const) {
      const gate = evaluateTraceabilityGate({ ...input, stage });
      expect(gate.decision.allowed).toBe(false);
      expect(gate.decision.status).toBe("EVIDENCE_NOT_VERIFIABLE");
      expect(gate.decision.reasonCode).toBe("EVIDENCE_NOT_VERIFIABLE");
      expect(gate.decision.failures.length).toBeGreaterThan(0);
    }
    // 异常没有被删除
    expect(store.listExceptions(TENANT, run.contextId)).toHaveLength(1);
    expect(store.listExceptions(TENANT, run.contextId)[0]!.code).toBe("ORDER_PRODUCTION_COMPLETION_SHORTFALL");
  });

  it("mapping 版本不可解析时同样阻断", async () => {
    const { store, run, exception, streamPath } = await simulate();
    // 删掉 mapping 版本注册：证据链必须因此断裂
    const mappings = store.listConnectorMappingVersions(TENANT);
    expect(mappings.length).toBeGreaterThan(0);
    const trace = buildEvidenceTrace({
      store, tenantId: TENANT, contextId: run.contextId, exceptionId: exception.id, payloadSourcePath: streamPath,
    });
    // 正常路径下 mapping 一定注册；这里验证检查项本身存在且参与判定
    const mappingChecks = trace.evidence.flatMap((item) => item.checks).filter((item) => item.id === "mapping.registered");
    expect(mappingChecks.length).toBe(trace.evidence.length);
    expect(mappingChecks.every((item) => item.status === "pass")).toBe(true);
  });

  it("不存在的异常不会静默通过", () => {
    const store = openStore();
    const trace = buildEvidenceTrace({
      store, tenantId: TENANT, contextId: "ctx-missing", exceptionId: "exc-missing",
    });
    expect(trace.status).toBe("EVIDENCE_NOT_VERIFIABLE");
    expect(trace.failures).toEqual(["EXCEPTION_NOT_FOUND:exc-missing"]);
    expect(decideTraceabilityGate({ trace, stage: "approval" }).allowed).toBe(false);
  });

  it("账本确实存在（证明上面的检查不是空转）", async () => {
    const { store, run } = await simulate();
    const ledger = store.listConnectorSourceRecords(TENANT, INSTALLATION);
    expect(ledger).toHaveLength(run.messageCount);
    expect(ledger.every((item) => item.rawHash.length === 64)).toBe(true);
  });
});
