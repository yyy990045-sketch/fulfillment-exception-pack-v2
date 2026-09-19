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

const port = 35950 + (process.pid % 60);
const base = `http://127.0.0.1:${port}`;
let child: ChildProcess;
let storeDir: string;

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
  throw new Error("solution pack server did not become healthy");
}

beforeAll(async () => {
  storeDir = mkdtempSync(join(tmpdir(), "fep-pack-http-"));
  process.env.PACK_STORE_DIR = storeDir;
  process.env.PACK_STORE_DB = join(storeDir, "pack-cases.sqlite");
  provisionV2ManufacturingDemoData();
  evaluateContextRules(openV2SqliteStore(), "demo-manufacturing", "ctx-so-mfg-001");
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

describe("Solution Pack HTTP", () => {
  it("exposes catalog, installed packs, install, and pure pack workbench", async () => {
    const catalog = await call("GET", "/api/v2/solution-packs");
    expect(catalog.status).toBe(200);
    expect(catalog.json.packs.some((item: any) => item.manifest.id === "manufacturing-fulfillment")).toBe(true);
    const installed = await call("GET", "/api/v2/solution-packs/installed");
    expect(installed.json.installations[0].installation.packId).toBe("manufacturing-fulfillment");
    const before = openV2SqliteStore().listRuleEvaluations("demo-manufacturing", "ctx-so-mfg-001").length;
    const workbench = await call("GET", "/api/v2/contexts/ctx-so-mfg-001/pack-workbench");
    expect(workbench.status).toBe(200);
    expect(workbench.json.pack.id).toBe("manufacturing-fulfillment");
    expect(openV2SqliteStore().listRuleEvaluations("demo-manufacturing", "ctx-so-mfg-001")).toHaveLength(before);
    const injected = await call("POST", "/api/v2/solution-packs/manufacturing-fulfillment/install", { actor: "other" });
    expect(injected.status).toBe(400);
  });
});
