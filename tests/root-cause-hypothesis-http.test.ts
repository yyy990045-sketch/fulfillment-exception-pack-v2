import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  evaluateContextRules,
  openV2SqliteStore,
  provisionV2ManufacturingDemoData,
} from "../src/domain/v2/index.js";

const port = 35450 + (process.pid % 60);
const base = `http://127.0.0.1:${port}`;
let child: ChildProcess;
let storeDir: string;
let exceptionId = "";
let analysisId = "";
let hypothesisId = "";

async function call(method: string, path: string, body?: unknown, actor = "quality-owner", tenant = "demo-manufacturing") {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-tenant-id": tenant,
      ...(actor ? { "x-actor": actor } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json().catch(() => ({}))) as Record<string, any> };
}

async function waitUntilHealthy() {
  for (let index = 0; index < 100; index += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch { /* not ready */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("root cause server did not become healthy");
}

beforeAll(async () => {
  storeDir = mkdtempSync(join(tmpdir(), "fep-root-cause-http-"));
  process.env.PACK_STORE_DIR = storeDir;
  process.env.PACK_STORE_DB = join(storeDir, "pack-cases.sqlite");
  provisionV2ManufacturingDemoData();
  evaluateContextRules(openV2SqliteStore(), "demo-manufacturing", "ctx-so-mfg-001");
  exceptionId = openV2SqliteStore().listExceptions("demo-manufacturing", "ctx-so-mfg-001")
    .find((item) => item.code === "CUSTOMER_RECEIPT_CLAIM_MISMATCH")!.id;
  child = spawn(join(process.cwd(), "node_modules", ".bin", "tsx"), ["src/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      NODE_ENV: "test",
      DEMO_MODE: "true",
      ROOT_CAUSE_AI_PROVIDER: "deterministic",
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

describe("root cause hypothesis HTTP", () => {
  it("generates, lists, and reads a grounded hypothesis analysis", async () => {
    const path = `/api/v2/contexts/ctx-so-mfg-001/exceptions/${exceptionId}/root-cause-analyses`;
    const empty = await call("GET", path);
    expect(empty.status).toBe(200);
    expect(empty.json.analyses).toEqual([]);

    const generated = await call("POST", path, {});
    expect(generated.status).toBe(200);
    expect(generated.json).toMatchObject({
      status: "generated",
      provider: "root-cause-deterministic-demo",
      model: "root-cause-fixture-v1",
    });
    expect(generated.json.output.hypotheses[0].epistemicStatus).toBe("hypothesis");
    analysisId = generated.json.id;
    hypothesisId = generated.json.output.hypotheses[0].id;

    const list = await call("GET", path);
    expect(list.status).toBe(200);
    expect(list.json.analyses).toHaveLength(1);
    expect(list.json.analyses[0]).not.toHaveProperty("output");
    const detail = await call("GET", `${path}/${analysisId}`);
    expect(detail.status).toBe(200);
    expect(detail.json.status).toBe("generated");
  });

  it("records append-only hypothesis reviews without creating Resolution state", async () => {
    const path = `/api/v2/contexts/ctx-so-mfg-001/exceptions/${exceptionId}/root-cause-analyses/${analysisId}/hypotheses/${hypothesisId}/reviews`;
    const before = openV2SqliteStore().listResolutionCases("demo-manufacturing", "ctx-so-mfg-001").length;
    const review = await call("POST", path, { decision: "investigate", rationale: "需要补充签收材料继续调查。" });
    expect(review.status).toBe(200);
    expect(review.json.decision).toBe("investigate");
    const reviews = await call("GET", path);
    expect(reviews.json.reviews).toHaveLength(1);
    expect(openV2SqliteStore().listResolutionCases("demo-manufacturing", "ctx-so-mfg-001")).toHaveLength(before);
  });

  it("requires auth actor and rejects tenant or actor injection", async () => {
    const path = `/api/v2/contexts/ctx-so-mfg-001/exceptions/${exceptionId}/root-cause-analyses`;
    const noActor = await call("POST", path, {}, "");
    expect(noActor.status).toBe(401);
    const injected = await call("POST", path, { actor: "admin", tenantId: "other" });
    expect(injected.status).toBe(400);
    const crossTenant = await call("GET", path, undefined, "quality-owner", "other-tenant");
    expect(crossTenant.status).toBe(404);
  });

  it("keeps root cause GET side-effect free", async () => {
    const store = openV2SqliteStore();
    const before = {
      analyses: store.listRootCauseAnalyses("demo-manufacturing", "ctx-so-mfg-001", exceptionId).length,
      resolutions: store.listResolutionCases("demo-manufacturing", "ctx-so-mfg-001").length,
    };
    const path = `/api/v2/contexts/ctx-so-mfg-001/exceptions/${exceptionId}/root-cause-analyses`;
    await call("GET", path);
    await call("GET", `${path}/${analysisId}`);
    const after = openV2SqliteStore();
    expect({
      analyses: after.listRootCauseAnalyses("demo-manufacturing", "ctx-so-mfg-001", exceptionId).length,
      resolutions: after.listResolutionCases("demo-manufacturing", "ctx-so-mfg-001").length,
    }).toEqual(before);
  });
});
