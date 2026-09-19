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

const port = 35550 + (process.pid % 60);
const base = `http://127.0.0.1:${port}`;
let child: ChildProcess;
let storeDir: string;
let exceptionId = "";
let optionId = "";

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
  throw new Error("policy server did not become healthy");
}

beforeAll(async () => {
  storeDir = mkdtempSync(join(tmpdir(), "fep-policy-http-"));
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

describe("decision policy HTTP", () => {
  it("evaluates a human candidate and keeps GET side-effect free", async () => {
    const recommendationPath = `/api/v2/contexts/ctx-so-mfg-001/exceptions/${exceptionId}/decision-recommendations`;
    const generated = await call("POST", recommendationPath, {});
    expect(generated.status).toBe(200);
    optionId = generated.json.output.options[0].id;

    const path = `/api/v2/contexts/ctx-so-mfg-001/exceptions/${exceptionId}/policy-evaluations`;
    const empty = await call("GET", path);
    expect(empty.status).toBe(200);
    expect(empty.json.evaluations).toEqual([]);

    const evaluated = await call("POST", path, { actionType: "create_task" });
    expect(evaluated.status).toBe(200);
    expect(evaluated.json.decision.mode).toBe("auto_eligible");
    expect(evaluated.json.decision.automationAvailable).toBe(false);
    expect(evaluated.json.decision.executionPerformed).toBe(false);

    const list = await call("GET", path);
    expect(list.status).toBe(200);
    expect(list.json.evaluations).toHaveLength(1);
    const before = openV2SqliteStore().listPolicyEvaluations("demo-manufacturing", "ctx-so-mfg-001", exceptionId).length;
    await call("GET", path);
    expect(openV2SqliteStore().listPolicyEvaluations("demo-manufacturing", "ctx-so-mfg-001", exceptionId)).toHaveLength(before);
  });

  it("evaluates an AI Recommendation option without mutation", async () => {
    const recommendationPath = `/api/v2/contexts/ctx-so-mfg-001/exceptions/${exceptionId}/decision-recommendations`;
    const recommendation = await call("GET", recommendationPath);
    const recommendationId = recommendation.json.recommendations.at(-1).id;
    const detail = await call("GET", `${recommendationPath}/${recommendationId}`);
    const option = detail.json.output.options[0];
    const before = openV2SqliteStore().listResolutionCases("demo-manufacturing", "ctx-so-mfg-001").length;
    const result = await call("POST", `/api/v2/contexts/ctx-so-mfg-001/exceptions/${exceptionId}/policy-evaluations`, {
      recommendationId,
      optionId: option.id,
    });
    expect(result.status).toBe(200);
    expect(result.json.candidateSource).toBe("ai_recommendation");
    expect(openV2SqliteStore().listResolutionCases("demo-manufacturing", "ctx-so-mfg-001")).toHaveLength(before);
  });

  it("rejects unknown options, actor injection, and cross-tenant reads", async () => {
    const path = `/api/v2/contexts/ctx-so-mfg-001/exceptions/${exceptionId}/policy-evaluations`;
    const unknown = await call("POST", path, { recommendationId: "missing", optionId: "missing" });
    expect(unknown.status).toBe(404);
    const invalidAction = await call("POST", path, { actionType: "unknown_action" });
    expect(invalidAction.status).toBe(422);
    expect(invalidAction.json.error).toBe("POLICY_ACTION_INVALID");
    const injected = await call("POST", path, { actionType: "create_task", actor: "admin" });
    expect(injected.status).toBe(400);
    const crossTenant = await call("GET", path, undefined, "quality-owner", "other-tenant");
    expect(crossTenant.status).toBe(404);
  });
});
