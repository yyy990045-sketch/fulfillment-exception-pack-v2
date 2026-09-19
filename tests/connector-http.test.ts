import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InternalAutomationExecutor, executePolicyAutomation } from "../src/automation/index.js";
import { evaluateDecisionPolicy } from "../src/policy/index.js";
import {
  evaluateContextRules,
  openV2SqliteStore,
  provisionV2ManufacturingDemoData,
} from "../src/domain/v2/index.js";

const port = 36150 + (process.pid % 60);
const base = `http://127.0.0.1:${port}`;
let child: ChildProcess;
let storeDir: string;
let workItemId = "";

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { accept: "application/json", "content-type": "application/json", "x-tenant-id": "demo-manufacturing", "x-actor": "admin" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json().catch(() => ({}))) as Record<string, any> };
}

async function waitUntilHealthy() {
  for (let index = 0; index < 100; index += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* not ready */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("connector server did not become healthy");
}

beforeAll(async () => {
  storeDir = mkdtempSync(join(tmpdir(), "fep-connector-http-"));
  process.env.PACK_STORE_DIR = storeDir;
  process.env.PACK_STORE_DB = join(storeDir, "connector-cases.sqlite");
  provisionV2ManufacturingDemoData();
  const store = openV2SqliteStore();
  evaluateContextRules(store, "demo-manufacturing", "ctx-so-mfg-001");
  const exception = store.listExceptions("demo-manufacturing", "ctx-so-mfg-001").find((item) => item.code === "CUSTOMER_RECEIPT_CLAIM_MISMATCH")!;
  const policy = evaluateDecisionPolicy(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, { actionType: "create_task" }, "connector-owner");
  const run = executePolicyAutomation(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, policy.id, "connector-owner", "human_request", {
    env: { AUTOMATION_ENABLED: "true", AUTOMATION_EXECUTOR: "internal" },
    executor: new InternalAutomationExecutor(),
  });
  workItemId = run.workItem!.id;
  child = spawn(join(process.cwd(), "node_modules", ".bin", "tsx"), ["src/server.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), NODE_ENV: "test", DEMO_MODE: "true", PACK_STORE_BACKEND: "json", PACK_STORE_DIR: storeDir },
    stdio: "ignore",
  });
  await waitUntilHealthy();
});

afterAll(() => {
  child?.kill("SIGTERM");
  rmSync(storeDir, { recursive: true, force: true });
});

describe("Connector HTTP boundary", () => {
  it("installs, enqueues without HTTP, and never exposes secrets", async () => {
    const catalog = await call("GET", "/api/v2/connectors");
    expect(catalog.json.connectors.some((item: any) => item.id === "reference-internal-task-http")).toBe(true);
    const installed = await call("POST", "/api/v2/connectors/reference-internal-task-http/install", {
      installationId: "installation-http-a",
      config: { baseUrl: "http://127.0.0.1:1" },
      secretRef: "TEST_HTTP_CONNECTOR_SECRET",
    });
    expect(installed.status).toBe(200);
    expect(installed.json.installation.secretConfigured).toBe(true);
    expect(JSON.stringify(installed.json)).not.toContain("super-secret-value-123");

    const delivery = await call("POST", `/api/v2/internal-work-items/${workItemId}/deliveries`, { connectorInstallationId: "installation-http-a" });
    expect(delivery.status).toBe(202);
    expect(delivery.json.outbox.status).toBe("pending");
    const delivered = await call("GET", `/api/v2/internal-work-items/${workItemId}/deliveries`);
    expect(delivered.json.deliveries).toHaveLength(1);
    expect(delivered.json.deliveries[0].receipt).toBeUndefined();
    const forbidden = await call("POST", `/api/v2/internal-work-items/${workItemId}/deliveries`, { connectorInstallationId: "installation-http-a", url: "http://evil" });
    expect(forbidden.status).toBe(400);
    const manualSuccess = await call("POST", `/api/v2/connectors/outbox/${delivery.json.outbox.id}/mark-succeeded`, {});
    expect(manualSuccess.status).toBe(404);
  });
});
