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

const port = 35750 + (process.pid % 60);
const base = `http://127.0.0.1:${port}`;
let child: ChildProcess;
let storeDir: string;
let exceptionId = "";
let policyEvaluationId = "";

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-tenant-id": "demo-manufacturing",
      "x-actor": "quality-owner",
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
  throw new Error("disabled automation server did not become healthy");
}

beforeAll(async () => {
  storeDir = mkdtempSync(join(tmpdir(), "fep-automation-disabled-"));
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
      AUTOMATION_ENABLED: "false",
      AUTOMATION_EXECUTOR: "internal",
      PACK_STORE_BACKEND: "json",
      PACK_STORE_DIR: storeDir,
    },
    stdio: "ignore",
  });
  await waitUntilHealthy();
  const policy = await call("POST", `/api/v2/contexts/ctx-so-mfg-001/exceptions/${exceptionId}/policy-evaluations`, { actionType: "create_task" });
  policyEvaluationId = policy.json.id;
});

afterAll(() => {
  child?.kill("SIGTERM");
  rmSync(storeDir, { recursive: true, force: true });
});

describe("disabled automation runtime", () => {
  it("keeps readiness readable but rejects execution without side effects", async () => {
    const basePath = `/api/v2/contexts/ctx-so-mfg-001/exceptions/${exceptionId}/policy-evaluations/${policyEvaluationId}`;
    const readiness = await call("GET", `${basePath}/automation-readiness`);
    expect(readiness.status).toBe(200);
    expect(readiness.json.executable).toBe(false);
    expect(readiness.json.reasons).toContain("AUTOMATION_DISABLED");
    const before = openV2SqliteStore().listInternalWorkItems("demo-manufacturing").length;
    const executed = await call("POST", `${basePath}/automation-runs`, {});
    expect(executed.status).toBe(503);
    expect(executed.json.error).toBe("AUTOMATION_DISABLED");
    expect(openV2SqliteStore().listInternalWorkItems("demo-manufacturing")).toHaveLength(before);
  });
});
