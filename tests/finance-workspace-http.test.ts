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
import { financeReconciliationPack, registerBuiltInSolutionPacks } from "../src/solution-packs/index.js";

const port = 36050 + (process.pid % 60);
const base = `http://127.0.0.1:${port}`;
let child: ChildProcess;
let storeDir: string;

async function call(path: string) {
  const response = await fetch(`${base}${path}`, {
    headers: { accept: "application/json", "x-tenant-id": "demo-finance", "x-actor": "quality-owner" },
  });
  return { status: response.status, json: (await response.json().catch(() => ({}))) as Record<string, any> };
}

async function waitUntilHealthy() {
  for (let index = 0; index < 100; index += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* not ready */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("finance workspace server did not become healthy");
}

beforeAll(async () => {
  storeDir = mkdtempSync(join(tmpdir(), "fep-finance-http-"));
  process.env.PACK_STORE_DIR = storeDir;
  process.env.PACK_STORE_DB = join(storeDir, "finance-cases.sqlite");
  provisionV2ManufacturingDemoData();
  registerBuiltInSolutionPacks();
  const store = openV2SqliteStore();
  financeReconciliationPack.install(store, "demo-finance", "demo-system");
  financeReconciliationPack.provisionDemo?.(store, "demo-finance", "demo-system");
  evaluateContextRules(store, "demo-finance", "ctx-fin-rec-001");
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

describe("Finance generic workspace HTTP", () => {
  it("serves the finance pack workbench and cross-domain analytics", async () => {
    const workbench = await call("/api/v2/contexts/ctx-fin-rec-001/pack-workbench");
    expect(workbench.status).toBe(200);
    expect(workbench.json.pack.id).toBe("finance-reconciliation");
    expect(workbench.json.thread.map((item: any) => item.label)).toEqual(["应收", "发票", "银行回款"]);
    expect(workbench.json.stats).toMatchObject({ matchedRules: 2, notMatchedRules: 1, exceptions: 2 });
    const analytics = await call("/api/v2/analytics/operational");
    expect(analytics.status).toBe(200);
    expect(analytics.json.contexts.some((item: any) => item.contextId === "ctx-fin-rec-001" && item.contextType === "finance_reconciliation")).toBe(true);
  });
});
