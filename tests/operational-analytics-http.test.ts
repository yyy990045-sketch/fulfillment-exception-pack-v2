import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionOperationalPortfolio } from "../src/demo/operational-analytics/provision-portfolio.js";
import {
  evaluateContextRules,
  openV2SqliteStore,
  provisionV2ManufacturingDemoData,
} from "../src/domain/v2/index.js";

const port = 35190 + (process.pid % 70);
const base = `http://127.0.0.1:${port}`;
let child: ChildProcess;
let storeDir: string;

async function call(path: string, tenant = "demo-manufacturing", accept = "application/json") {
  const response = await fetch(`${base}${path}`, {
    headers: { accept, "x-tenant-id": tenant },
  });
  return { status: response.status, contentType: response.headers.get("content-type") || "", body: await response.text() };
}

async function waitUntilHealthy() {
  for (let index = 0; index < 100; index += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch { /* server is not ready */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("operations analytics server did not become healthy");
}

beforeAll(async () => {
  storeDir = mkdtempSync(join(tmpdir(), "fep-operations-http-"));
  process.env.PACK_STORE_DIR = storeDir;
  process.env.PACK_STORE_DB = join(storeDir, "pack-cases.sqlite");
  provisionV2ManufacturingDemoData();
  evaluateContextRules(openV2SqliteStore(), "demo-manufacturing", "ctx-so-mfg-001");
  provisionOperationalPortfolio(openV2SqliteStore());
  child = spawn(join(process.cwd(), "node_modules", ".bin", "tsx"), ["src/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      NODE_ENV: "test",
      DEMO_MODE: "true",
      PACK_STORE_BACKEND: "json",
      PACK_STORE_DIR: storeDir,
    },
    stdio: "ignore",
  });
  await waitUntilHealthy();
});

afterAll(() => {
  child?.kill("SIGTERM");
  rmSync(storeDir, { recursive: true, force: true });
});

describe("operational analytics HTTP", () => {
  it("serves /operations while keeping /manufacturing available", async () => {
    const operations = await call("/operations", "demo-manufacturing", "text/html");
    expect(operations.status).toBe(200);
    expect(operations.contentType).toContain("text/html");
    expect(operations.body).toContain("经营治理中心");
    const charts = await call("/operations/charts.js", "demo-manufacturing", "text/javascript");
    expect(charts.status).toBe(200);
    expect(charts.contentType).toContain("javascript");
    const manufacturing = await call("/manufacturing", "demo-manufacturing", "text/html");
    expect(manufacturing.status).toBe(200);
  });

  it("returns an empty snapshot for a tenant with no data", async () => {
    const response = await call("/api/v2/analytics/operational", "empty-tenant");
    expect(response.status).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.summary.contextCount).toBe(0);
    expect(body.summary.governanceCoverageRate).toBeNull();
    expect(body.summary.resolutionClosureRate).toBeNull();
    expect(body.exceptionTrend).toEqual([]);
  });

  it("returns portfolio analytics and isolates tenants", async () => {
    const response = await call("/api/v2/analytics/operational");
    expect(response.status).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.summary).toMatchObject({
      contextCount: 11,
      ruleEvaluationCount: 77,
      detectedExceptionCount: 36,
      resolutionCaseCount: 8,
    });
    expect(body.contexts).toHaveLength(11);
    expect(body.metricDefinitions.governanceCoverageRate).toContain("Resolution Case");
    expect(body.truthfulness).toMatchObject({
      derivedFromDomainFacts: true,
      financialImpactMeasured: false,
      ruleAccuracyMeasured: false,
    });

    const isolated = await call("/api/v2/analytics/operational", "tenant-b");
    expect(JSON.parse(isolated.body).summary.contextCount).toBe(0);
  });

  it("validates query filters and supports exception and resolution filters", async () => {
    const invalidBucket = await call("/api/v2/analytics/operational?bucket=yearly");
    expect(invalidBucket.status).toBe(400);
    expect(JSON.parse(invalidBucket.body).error).toBe("ANALYTICS_INVALID_BUCKET");

    const invalidRange = await call("/api/v2/analytics/operational?from=2026-09-10&to=2026-09-01");
    expect(invalidRange.status).toBe(400);
    expect(JSON.parse(invalidRange.body).error).toBe("ANALYTICS_INVALID_DATE_RANGE");

    const invalidSeverity = await call("/api/v2/analytics/operational?severity=unknown");
    expect(invalidSeverity.status).toBe(400);
    expect(JSON.parse(invalidSeverity.body).error).toBe("ANALYTICS_INVALID_FILTER");

    const invalidResolutionStatus = await call("/api/v2/analytics/operational?resolutionStatus=resolved");
    expect(invalidResolutionStatus.status).toBe(400);
    expect(JSON.parse(invalidResolutionStatus.body).error).toBe("ANALYTICS_INVALID_FILTER");

    const claim = await call("/api/v2/analytics/operational?exceptionCode=CUSTOMER_RECEIPT_CLAIM_MISMATCH");
    expect(claim.status).toBe(200);
    expect(JSON.parse(claim.body).exceptionBreakdown).toHaveLength(1);

    const pending = await call("/api/v2/analytics/operational?resolutionStatus=pending_approval");
    expect(pending.status).toBe(200);
    expect(JSON.parse(pending.body).resolutionFunnel.pending_approval).toBe(1);
  });

  it("keeps analytics GET side-effect free", async () => {
    const beforeStore = openV2SqliteStore();
    const before = {
      contexts: beforeStore.listContexts("demo-manufacturing").length,
      evaluations: beforeStore.listContexts("demo-manufacturing").reduce((sum, item) => sum + beforeStore.listRuleEvaluations("demo-manufacturing", item.id).length, 0),
      exceptions: beforeStore.listContexts("demo-manufacturing").reduce((sum, item) => sum + beforeStore.listExceptions("demo-manufacturing", item.id).length, 0),
      resolutions: beforeStore.listContexts("demo-manufacturing").reduce((sum, item) => sum + beforeStore.listResolutionCases("demo-manufacturing", item.id).length, 0),
    };
    await call("/api/v2/analytics/operational?bucket=day");
    await call("/api/v2/analytics/operational?bucket=month");
    const afterStore = openV2SqliteStore();
    const after = {
      contexts: afterStore.listContexts("demo-manufacturing").length,
      evaluations: afterStore.listContexts("demo-manufacturing").reduce((sum, item) => sum + afterStore.listRuleEvaluations("demo-manufacturing", item.id).length, 0),
      exceptions: afterStore.listContexts("demo-manufacturing").reduce((sum, item) => sum + afterStore.listExceptions("demo-manufacturing", item.id).length, 0),
      resolutions: afterStore.listContexts("demo-manufacturing").reduce((sum, item) => sum + afterStore.listResolutionCases("demo-manufacturing", item.id).length, 0),
    };
    expect(after).toEqual(before);
  });
});
