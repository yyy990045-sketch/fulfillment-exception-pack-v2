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

const port = 35390 + (process.pid % 60);
const base = `http://127.0.0.1:${port}`;
let child: ChildProcess;
let storeDir: string;
let exceptionId = "";
let recommendationId = "";

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
  throw new Error("decision recommendation server did not become healthy");
}

beforeAll(async () => {
  storeDir = mkdtempSync(join(tmpdir(), "fep-decision-http-"));
  process.env.PACK_STORE_DIR = storeDir;
  process.env.PACK_STORE_DB = join(storeDir, "pack-cases.sqlite");
  provisionV2ManufacturingDemoData();
  evaluateContextRules(openV2SqliteStore(), "demo-manufacturing", "ctx-so-mfg-001");
  provisionOperationalPortfolio(openV2SqliteStore());
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
      DECISION_AI_PROVIDER: "deterministic",
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

describe("decision recommendation HTTP", () => {
  it("generates and queries a grounded recommendation", async () => {
    const path = `/api/v2/contexts/ctx-so-mfg-001/exceptions/${exceptionId}/decision-recommendations`;
    const empty = await call("GET", path);
    expect(empty.status).toBe(200);
    expect(empty.json.recommendations).toEqual([]);

    const generated = await call("POST", path, {});
    expect(generated.status).toBe(200);
    expect(generated.json).toMatchObject({
      status: "generated",
      provider: "decision-deterministic-demo",
      model: "decision-fixture-v1",
    });
    recommendationId = generated.json.id;

    const list = await call("GET", path);
    expect(list.status).toBe(200);
    expect(list.json.recommendations).toHaveLength(1);
    expect(list.json.recommendations[0]).toMatchObject({
      id: recommendationId,
      status: "generated",
      stale: false,
    });
    expect(list.json.recommendations[0]).not.toHaveProperty("output");
    const detail = await call("GET", `${path}/${recommendationId}`);
    expect(detail.status).toBe(200);
    expect(detail.json.output.humanDecisionRequired).toBe(true);
  });

  it("records immutable human dispositions without creating a Resolution Case", async () => {
    const path = `/api/v2/contexts/ctx-so-mfg-001/exceptions/${exceptionId}/decision-recommendations/${recommendationId}/dispositions`;
    const before = openV2SqliteStore().listResolutionCases("demo-manufacturing", "ctx-so-mfg-001").length;
    const accepted = await call("POST", path, {
      decision: "accepted",
      selectedOptionId: "supplement_evidence",
      rationale: "人工认可该建议。",
    });
    expect(accepted.status).toBe(200);
    expect(accepted.json.decision).toBe("accepted");
    const invalidOption = await call("POST", path, {
      decision: "modified",
      selectedOptionId: "not-found",
      rationale: "无效选项。",
    });
    expect(invalidOption.status).toBe(422);
    expect(invalidOption.json.error).toBe("DECISION_SELECTED_OPTION_INVALID");
    const invalidRejectedOption = await call("POST", path, {
      decision: "rejected",
      selectedOptionId: "not-found",
      rationale: "拒绝反馈也不能引用无效选项。",
    });
    expect(invalidRejectedOption.status).toBe(422);
    expect(invalidRejectedOption.json.error).toBe("DECISION_SELECTED_OPTION_INVALID");
    const rejected = await call("POST", path, {
      decision: "rejected",
      rationale: "当前建议不适用于人工判断。",
    });
    expect(rejected.status).toBe(200);
    expect(rejected.json.decision).toBe("rejected");
    const list = await call("GET", path);
    expect(list.json.dispositions).toHaveLength(2);
    expect(openV2SqliteStore().listResolutionCases("demo-manufacturing", "ctx-so-mfg-001")).toHaveLength(before);
  });

  it("requires auth actor and does not accept actor or tenant in the body", async () => {
    const path = `/api/v2/contexts/ctx-so-mfg-001/exceptions/${exceptionId}/decision-recommendations`;
    const noActor = await call("POST", path, {}, "");
    expect(noActor.status).toBe(401);
    const injected = await call("POST", path, { actor: "admin", tenantId: "other" });
    expect(injected.status).toBe(400);
    expect(injected.json.error).toBe("actor_and_tenant_from_auth_required");
    const crossTenant = await call("GET", path, undefined, "quality-owner", "other-tenant");
    expect(crossTenant.status).toBe(404);
  });

  it("keeps recommendation GET queries side-effect free", async () => {
    const store = openV2SqliteStore();
    const before = {
      recommendations: store.listDecisionRecommendations("demo-manufacturing", "ctx-so-mfg-001", exceptionId).length,
      resolutions: store.listResolutionCases("demo-manufacturing", "ctx-so-mfg-001").length,
      exceptions: store.listExceptions("demo-manufacturing", "ctx-so-mfg-001").length,
    };
    await call("GET", `/api/v2/contexts/ctx-so-mfg-001/exceptions/${exceptionId}/decision-recommendations`);
    await call("GET", `/api/v2/contexts/ctx-so-mfg-001/exceptions/${exceptionId}/decision-recommendations/${recommendationId}`);
    const after = openV2SqliteStore();
    expect({
      recommendations: after.listDecisionRecommendations("demo-manufacturing", "ctx-so-mfg-001", exceptionId).length,
      resolutions: after.listResolutionCases("demo-manufacturing", "ctx-so-mfg-001").length,
      exceptions: after.listExceptions("demo-manufacturing", "ctx-so-mfg-001").length,
    }).toEqual(before);
  });
});
