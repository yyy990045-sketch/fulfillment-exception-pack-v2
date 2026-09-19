import { mkdtempSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildOperationalAnalytics } from "../src/analytics/index.js";
import { bucketKeysBetween } from "../src/analytics/time-buckets.js";
import { provisionOperationalPortfolio } from "../src/demo/operational-analytics/provision-portfolio.js";
import {
  V2SqliteStore,
  evaluateContextRules,
  provisionV2ManufacturingDemoData,
} from "../src/domain/v2/index.js";

type DatabaseSyncLike = {
  exec(sql: string): void;
  prepare(sql: string): { all(...params: unknown[]): unknown[]; get(...params: unknown[]): unknown; run(...params: unknown[]): unknown };
  close(): void;
};

type DatabaseSyncConstructor = new (path: string) => DatabaseSyncLike;

const sqlite = process.getBuiltinModule("node:sqlite") as { DatabaseSync: DatabaseSyncConstructor } | undefined;
if (!sqlite?.DatabaseSync) throw new Error("sqlite_backend_requires_node_22_5_or_newer");
const databases: DatabaseSyncLike[] = [];

function openStore(withPortfolio = true) {
  const dir = mkdtempSync(join(tmpdir(), "fep-operational-analytics-"));
  const db = new sqlite!.DatabaseSync(join(dir, "analytics.sqlite"));
  databases.push(db);
  const store = new V2SqliteStore(db);
  provisionV2ManufacturingDemoData(store);
  evaluateContextRules(store, "demo-manufacturing", "ctx-so-mfg-001");
  if (withPortfolio) provisionOperationalPortfolio(store);
  return store;
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("Operational Analytics projection", () => {
  it("keeps the operations presentation free of misleading metric claims", () => {
    const files = [
      "src/workbench/operations/index.html",
      "src/workbench/operations/app.js",
      "src/workbench/operations/charts.js",
      "docs/competition/11-operational-intelligence.md",
    ];
    for (const file of files) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      expect(source).not.toContain("规则准确率");
      expect(source).not.toContain("AI 准确率");
      expect(source).not.toContain("风险金额");
      expect(source).not.toContain("节省金额");
      expect(source).not.toContain("ROI");
      expect(source).not.toContain("异常解决率");
    }
    const charts = readFileSync(new URL("../src/workbench/operations/charts.js", import.meta.url), "utf8");
    expect(charts).toContain('setAttribute("aria-label"');
    expect(charts).toContain("tableFallback");
    const html = readFileSync(new URL("../src/workbench/operations/index.html", import.meta.url), "utf8");
    expect(html).toContain("演示数据 · Synthetic Portfolio");
  });

  it("derives cross-context metrics and metric contracts from domain facts", () => {
    const store = openStore();
    const listed = store.listContexts("demo-manufacturing");
    expect(listed).toHaveLength(11);
    expect(listed.map((item) => item.businessKey)).toEqual(expect.arrayContaining([
      "SO-MFG-001",
      ...Array.from({ length: 10 }, (_item, index) => `SO-OPS-${String(index + 1).padStart(3, "0")}`),
    ]));
    expect(listed.every((item, index) => index === 0 || listed[index - 1]!.openedAt <= item.openedAt)).toBe(true);
    expect(store.listContexts("other-tenant")).toEqual([]);
    const analytics = buildOperationalAnalytics(store, "demo-manufacturing", { bucket: "week" });
    expect(analytics.window.timeBasis).toBe("context.openedAt");
    expect(analytics.summary).toMatchObject({
      contextCount: 11,
      ruleEvaluationCount: 77,
      detectedExceptionCount: 36,
      exceptionsWithResolutionCase: 8,
      exceptionsWithoutResolutionCase: 28,
      resolutionCaseCount: 8,
      closedResolutionCaseCount: 1,
      rejectedResolutionCaseCount: 1,
      receiptCount: 2,
      verifiedActionCount: 1,
    });
    expect(analytics.summary.governanceCoverageRate).toBeCloseTo(8 / 36);
    expect(analytics.summary.resolutionClosureRate).toBeCloseTo(1 / 8);
    expect(analytics.metricDefinitions.ruleTriggerRate).toContain("not accuracy");
    expect(analytics.truthfulness).toMatchObject({
      derivedFromDomainFacts: true,
      financialImpactMeasured: false,
      ruleAccuracyMeasured: false,
      realBusinessOutcomeMeasured: false,
    });
  });

  it("distinguishes proposed draft from pending approval and exposes rule trigger rates", () => {
    const analytics = buildOperationalAnalytics(openStore(), "demo-manufacturing", { bucket: "month" });
    expect(analytics.resolutionFunnel.proposed_draft).toBe(1);
    expect(analytics.resolutionFunnel.pending_approval).toBe(1);
    const rule = analytics.rulePerformance.find((item) => item.code === "FULFILLMENT.CUSTOMER_RECEIPT_CLAIM_MISMATCH")!;
    expect(rule.evaluations).toBe(11);
    expect(rule.matched).toBeGreaterThan(0);
    expect(rule.triggerRate).toBeCloseTo(rule.matched / rule.evaluations);
    expect(analytics.exceptionBreakdown.some((item) => item.label === "客户收货主张与发货记录不一致")).toBe(true);
  });

  it("uses Evidence occurrence for trend and counts overlapping source involvement", () => {
    const store = openStore();
    const analytics = buildOperationalAnalytics(store, "demo-manufacturing", { bucket: "day" });
    expect(analytics.exceptionTrend.length).toBeGreaterThan(1);
    const claim = analytics.exceptionBreakdown.find((item) => item.code === "CUSTOMER_RECEIPT_CLAIM_MISMATCH")!;
    const wmsCount = analytics.sourceSystemInvolvement
      .filter((item) => item.sourceSystemId.startsWith("WMS"))
      .reduce((sum, item) => sum + item.involvedExceptionCount, 0);
    const serviceCount = analytics.sourceSystemInvolvement
      .filter((item) => item.systemType === "manual")
      .reduce((sum, item) => sum + item.involvedExceptionCount, 0);
    expect(wmsCount).toBeGreaterThanOrEqual(claim.count);
    expect(serviceCount).toBeGreaterThanOrEqual(claim.count);
    expect(analytics.summary.detectedExceptionCount).toBeGreaterThan(claim.count);
  });

  it("filters by exception code and resolution status without mutating the store", () => {
    const store = openStore();
    const before = {
      contexts: store.listContexts("demo-manufacturing").length,
      evaluations: store.listContexts("demo-manufacturing").reduce((sum, item) => sum + store.listRuleEvaluations("demo-manufacturing", item.id).length, 0),
      exceptions: store.listContexts("demo-manufacturing").reduce((sum, item) => sum + store.listExceptions("demo-manufacturing", item.id).length, 0),
      resolutions: store.listContexts("demo-manufacturing").reduce((sum, item) => sum + store.listResolutionCases("demo-manufacturing", item.id).length, 0),
    };
    const claimFiltered = buildOperationalAnalytics(store, "demo-manufacturing", {
      exceptionCode: "CUSTOMER_RECEIPT_CLAIM_MISMATCH",
    });
    expect(claimFiltered.summary.detectedExceptionCount).toBeGreaterThan(1);
    expect(claimFiltered.exceptionBreakdown).toHaveLength(1);
    const closedFiltered = buildOperationalAnalytics(store, "demo-manufacturing", {
      resolutionStatus: "closed",
    });
    expect(closedFiltered.summary.detectedExceptionCount).toBe(1);
    expect(closedFiltered.resolutionFunnel.closed).toBe(1);
    const after = {
      contexts: store.listContexts("demo-manufacturing").length,
      evaluations: store.listContexts("demo-manufacturing").reduce((sum, item) => sum + store.listRuleEvaluations("demo-manufacturing", item.id).length, 0),
      exceptions: store.listContexts("demo-manufacturing").reduce((sum, item) => sum + store.listExceptions("demo-manufacturing", item.id).length, 0),
      resolutions: store.listContexts("demo-manufacturing").reduce((sum, item) => sum + store.listResolutionCases("demo-manufacturing", item.id).length, 0),
    };
    expect(after).toEqual(before);
  });

  it("returns null rates for empty input and remains idempotent when the portfolio is provisioned twice", () => {
    const empty = openStore(false);
    const emptyAnalytics = buildOperationalAnalytics(empty, "other-tenant", {});
    expect(emptyAnalytics.summary.contextCount).toBe(0);
    expect(emptyAnalytics.summary.governanceCoverageRate).toBeNull();
    expect(emptyAnalytics.summary.resolutionClosureRate).toBeNull();

    const store = openStore();
    const before = {
      contexts: store.listContexts("demo-manufacturing").length,
      exceptions: store.listContexts("demo-manufacturing").reduce((sum, item) => sum + store.listExceptions("demo-manufacturing", item.id).length, 0),
      resolutions: store.listContexts("demo-manufacturing").reduce((sum, item) => sum + store.listResolutionCases("demo-manufacturing", item.id).length, 0),
      receipts: store.listContexts("demo-manufacturing").reduce((sum, context) => sum + store.listResolutionCases("demo-manufacturing", context.id).reduce((inner, item) => inner + store.listResolutionReceipts("demo-manufacturing", item.id).length, 0), 0),
    };
    provisionOperationalPortfolio(store);
    const after = {
      contexts: store.listContexts("demo-manufacturing").length,
      exceptions: store.listContexts("demo-manufacturing").reduce((sum, item) => sum + store.listExceptions("demo-manufacturing", item.id).length, 0),
      resolutions: store.listContexts("demo-manufacturing").reduce((sum, item) => sum + store.listResolutionCases("demo-manufacturing", item.id).length, 0),
      receipts: store.listContexts("demo-manufacturing").reduce((sum, context) => sum + store.listResolutionCases("demo-manufacturing", context.id).reduce((inner, item) => inner + store.listResolutionReceipts("demo-manufacturing", item.id).length, 0), 0),
    };
    expect(after).toEqual(before);
  });

  it("keeps month buckets aligned when the window starts on the 31st", () => {
    expect(bucketKeysBetween(Date.parse("2026-01-31T00:00:00.000Z"), Date.parse("2026-03-31T00:00:00.000Z"), "month")).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
    ]);
  });

  it("keeps context and rule denominators stable under resolution-status filters", () => {
    const analytics = buildOperationalAnalytics(openStore(), "demo-manufacturing", { resolutionStatus: "closed" });
    expect(analytics.summary.contextCount).toBe(11);
    expect(analytics.summary.ruleEvaluationCount).toBe(77);
    expect(analytics.rulePerformance).toHaveLength(7);
    expect(analytics.summary.detectedExceptionCount).toBe(1);
  });
});
