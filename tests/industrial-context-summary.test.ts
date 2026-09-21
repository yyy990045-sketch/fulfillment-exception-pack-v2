import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { V2SqliteStore, type SqliteDatabaseLike } from "../src/domain/v2/index.js";
import { buildOperationalAnalytics } from "../src/analytics/index.js";
import {
  INDUSTRIAL_TRACE_ORDER,
  buildIndustrialContextSummary,
  buildIndustrialExceptionTrace,
  industrialSpaceOfContext,
} from "../src/industrial/context-summary.js";
import { DEMO_MANUFACTURING_HIERARCHY } from "../src/industrial/hierarchy.js";
import { LocalSimulatorTransport } from "../src/simulator/manufacturing/transport.js";
import { runIndustrialSimulation } from "../src/simulator/manufacturing/runner.js";
import { resolveScenario } from "../src/simulator/manufacturing/scenarios.js";

type DatabaseSyncConstructor = new (path: string) => SqliteDatabaseLike & { close?(): void };
const builtin = process.getBuiltinModule?.("node:sqlite") as { DatabaseSync?: DatabaseSyncConstructor } | undefined;
if (!builtin?.DatabaseSync) throw new Error("sqlite_backend_requires_node_22_5_or_newer");

function openStore() {
  const directory = mkdtempSync(join(tmpdir(), "fep-industrial-summary-"));
  const database = new builtin!.DatabaseSync!(join(directory, "summary.sqlite"));
  database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  return new V2SqliteStore(database);
}

async function simulate(scenarioId: string) {
  const store = openStore();
  const run = await runIndustrialSimulation({
    store,
    scenario: resolveScenario(scenarioId),
    transport: new LocalSimulatorTransport(),
    speed: 0,
  });
  return { store, run };
}

describe("Industrial Context Summary 与可追溯性", () => {
  it("Context 能回答它属于哪个工业空间、由哪些系统提供数据", async () => {
    const { store, run } = await simulate("production-shortfall");
    const summary = buildIndustrialContextSummary(store, "demo-manufacturing", run.contextId);
    expect(summary).toBeDefined();
    expect(summary!).toMatchObject({
      schemaVersion: "industrial-context-summary/v1",
      businessKey: "SO-IND-002",
      environment: "SIMULATED INDUSTRIAL ENVIRONMENT",
      eventCount: 16,
      evidenceCount: 16,
      exceptionCount: 1,
      evaluationCount: 7,
      unsRootPath: "enterprise/demo-manufacturing/site/factory-shanghai-01/area/assembly-workshop/line/line-a",
      equipmentIds: ["machine-a01", "packing-station-a", "quality-station-a"],
    });
    expect(summary!.space).toMatchObject({
      enterpriseId: "demo-manufacturing",
      siteId: "factory-shanghai-01",
      areaId: "assembly-workshop",
      lineId: "line-a",
    });
    expect(summary!.sourceSystems.map((item) => item.id).sort()).toEqual([
      "CRM-DEMO", "ERP-DEMO", "FINANCE-DEMO", "MES-DEMO", "QMS-DEMO", "SERVICE-DEMO", "WMS-DEMO",
    ]);
    expect(summary!.entities.map((item) => item.entityType)).toEqual([
      "complaint", "invoice", "payment", "production_order", "quality_event", "quote", "receivable", "sales_order", "shipment",
    ]);
    expect(summary!.mappingVersions).toEqual(["industrial-mapping@1.0.0"]);
    expect(summary!.truthfulness).toMatchObject({ realFactory: false, realMes: false, realErp: false, realQms: false, realWms: false });
  });

  it("履约链可查询：SalesOrder → ProductionOrder → QualityInspection → Shipment → Invoice → Receivable → Payment → Complaint", async () => {
    const { store, run } = await simulate("quality-failure");
    const summary = buildIndustrialContextSummary(store, "demo-manufacturing", run.contextId)!;
    expect(summary.trace.map((item) => item.entityType)).toEqual([
      "quote", "sales_order", "production_order", "quality_event", "shipment", "invoice", "receivable", "payment", "complaint",
    ]);
    for (const node of summary.trace) {
      expect(node.position).toBeGreaterThanOrEqual(0);
      expect(node.eventCount).toBeGreaterThan(0);
      expect(node.evidenceIds.length).toBeGreaterThan(0);
      expect(node.sourceSystemId).toBeTruthy();
      expect(node.domain).toBeTruthy();
      expect(node.occurredAt).toBeTruthy();
    }
    expect(INDUSTRIAL_TRACE_ORDER).toContain("quality_event");
    // 每个事实节点都对齐到具体工业域，而不是笼统的「业务系统」
    expect(summary.trace.find((item) => item.entityType === "quality_event")!.domain).toBe("quality");
    expect(summary.trace.find((item) => item.entityType === "payment")!.domain).toBe("finance");
  });

  it("一个 Exception 能向前追溯到所有原始事实（含来源系统与材料位置）", async () => {
    const { store, run } = await simulate("quality-failure");
    const qualityException = store.listExceptions("demo-manufacturing", run.contextId)
      .find((item) => item.code === "QUALITY_NONCONFORMING_QUANTITY_DETECTED")!;
    const trace = buildIndustrialExceptionTrace(store, "demo-manufacturing", run.contextId, qualityException.id);
    expect(trace).toBeDefined();
    expect(trace!.code).toBe("QUALITY_NONCONFORMING_QUANTITY_DETECTED");
    expect(trace!.nodes).toHaveLength(1);
    const node = trace!.nodes[0]!;
    expect(node.entityType).toBe("quality_event");
    expect(node.sourceSystemId).toBe("QMS-DEMO");
    expect(node.facts.map((item) => item.field).sort()).toEqual(["inspectedQty", "passedQty"]);
    expect(node.facts.map((item) => item.role).sort()).toEqual(["actual", "expected"]);
    for (const fact of node.facts) {
      expect(fact.sourceSystemId).toBe("QMS-DEMO");
      expect(fact.sourceDocument?.externalDocumentId).toBe("QC-IND-003");
      expect(fact.locator.fileName).toBe("QC-IND-003.json");
      expect(fact.observedAt).toBeTruthy();
    }
    expect(buildIndustrialExceptionTrace(store, "demo-manufacturing", run.contextId, "exc-does-not-exist")).toBeUndefined();
  });

  it("没有 UNS 绑定的 Context 返回 null 空间而不是编造一个", async () => {
    const store = openStore();
    store.saveContext({
      id: "ctx-legacy",
      tenantId: "demo-manufacturing",
      businessKey: "SO-LEGACY-1",
      contextType: "sales_order",
      status: "active",
      openedAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      metadata: {},
    });
    const summary = buildIndustrialContextSummary(store, "demo-manufacturing", "ctx-legacy")!;
    expect(summary.space).toBeNull();
    expect(summary.unsRootPath).toBeNull();
    expect(industrialSpaceOfContext(store.getContext("demo-manufacturing", "ctx-legacy")!)).toBeNull();
    expect(buildIndustrialContextSummary(store, "demo-manufacturing", "ctx-missing")).toBeUndefined();
  });

  it("层级校验对非法空间绑定失败（不静默降级）", async () => {
    const { store, run } = await simulate("normal");
    const context = store.getContext("demo-manufacturing", run.contextId)!;
    store.saveContext({
      ...context,
      metadata: { ...context.metadata, unsSpace: { enterpriseId: "e", siteId: "s", areaId: "a", lineId: "l" } },
    });
    expect(() => buildIndustrialContextSummary(store, "demo-manufacturing", run.contextId, DEMO_MANUFACTURING_HIERARCHY))
      .toThrow(/INDUSTRIAL_NODE_NOT_FOUND/);
  });
});

describe("运营分析：site / line / sourceSystem 维度", () => {
  it("投影能承载工业维度，且工业 Breakdown 与异常一致", async () => {
    const { store, run } = await simulate("quality-failure");
    const analytics = buildOperationalAnalytics(store, "demo-manufacturing", {});
    expect(analytics.summary.detectedExceptionCount).toBe(2);
    const contextRow = analytics.contexts.find((item) => item.contextId === run.contextId)!;
    expect(contextRow.industrial).toEqual({
      enterpriseId: "demo-manufacturing",
      siteId: "factory-shanghai-01",
      areaId: "assembly-workshop",
      lineId: "line-a",
    });
    const byDimension = (dimension: string) => analytics.industrialBreakdown.filter((item) => item.dimension === dimension);
    expect(byDimension("site").map((item) => item.value)).toEqual(["factory-shanghai-01"]);
    expect(byDimension("line").map((item) => item.value)).toEqual(["line-a"]);
    expect(byDimension("site")[0]!.exceptionCount).toBe(2);
    expect(byDimension("line")[0]!.contextCount).toBe(1);
    // 发货短少规则同时引用 ERP 的订单数量与 WMS 的发货数量，因此两个来源系统都参与该异常
    expect(byDimension("sourceSystem").map((item) => item.value).sort()).toEqual(["ERP-DEMO", "QMS-DEMO", "WMS-DEMO"]);
  });

  it("site / line / sourceSystem 过滤器都生效，且互不干扰既有过滤器", async () => {
    const { store, run } = await simulate("payment-shortfall");
    const all = buildOperationalAnalytics(store, "demo-manufacturing", {});
    expect(all.summary.detectedExceptionCount).toBe(1);

    const matchingSite = buildOperationalAnalytics(store, "demo-manufacturing", { site: "factory-shanghai-01" });
    expect(matchingSite.summary.contextCount).toBe(1);
    expect(matchingSite.contexts[0]!.contextId).toBe(run.contextId);

    const otherSite = buildOperationalAnalytics(store, "demo-manufacturing", { site: "factory-beijing-99" });
    expect(otherSite.summary.contextCount).toBe(0);
    expect(otherSite.summary.detectedExceptionCount).toBe(0);

    const matchingLine = buildOperationalAnalytics(store, "demo-manufacturing", { line: "line-a" });
    expect(matchingLine.summary.detectedExceptionCount).toBe(1);

    const matchingSource = buildOperationalAnalytics(store, "demo-manufacturing", { sourceSystem: "FINANCE-DEMO" });
    expect(matchingSource.summary.detectedExceptionCount).toBe(1);

    const otherSource = buildOperationalAnalytics(store, "demo-manufacturing", { sourceSystem: "MES-DEMO" });
    expect(otherSource.summary.detectedExceptionCount).toBe(0);

    const combined = buildOperationalAnalytics(store, "demo-manufacturing", {
      site: "factory-shanghai-01",
      line: "line-a",
      sourceSystem: "FINANCE-DEMO",
      exceptionCode: "PAYMENT_BALANCE_OUTSTANDING",
    });
    expect(combined.summary.detectedExceptionCount).toBe(1);

    const excludedByCode = buildOperationalAnalytics(store, "demo-manufacturing", {
      site: "factory-shanghai-01",
      exceptionCode: "SHIPMENT_QUANTITY_SHORTFALL",
    });
    expect(excludedByCode.summary.detectedExceptionCount).toBe(0);
  });

  it("没有工业绑定的 Context 在分析里 industrial = null，不污染站点统计", async () => {
    const store = openStore();
    store.saveContext({
      id: "ctx-legacy",
      tenantId: "demo-manufacturing",
      businessKey: "SO-LEGACY-1",
      contextType: "sales_order",
      status: "active",
      openedAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      metadata: {},
    });
    const analytics = buildOperationalAnalytics(store, "demo-manufacturing", {});
    expect(analytics.contexts[0]!.industrial).toBeNull();
    expect(analytics.industrialBreakdown).toEqual([]);
    expect(buildOperationalAnalytics(store, "demo-manufacturing", { site: "factory-shanghai-01" }).summary.contextCount).toBe(0);
  });
});
