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

const port = 34790 + (process.pid % 100);
const base = `http://127.0.0.1:${port}`;
const headers = { accept: "application/json", "x-tenant-id": "demo-manufacturing" };

let child: ChildProcess;
let storeDir: string;

async function call(path: string, extraHeaders: Record<string, string> = {}) {
  const response = await fetch(`${base}${path}`, { headers: { ...headers, ...extraHeaders } });
  return { status: response.status, contentType: response.headers.get("content-type") || "", body: await response.text() };
}

async function waitUntilHealthy() {
  for (let index = 0; index < 100; index += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch { /* server is not ready */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("manufacturing workbench server did not become healthy");
}

beforeAll(async () => {
  storeDir = mkdtempSync(join(tmpdir(), "fep-manufacturing-http-"));
  process.env.PACK_STORE_DIR = storeDir;
  process.env.PACK_STORE_DB = join(storeDir, "pack-cases.sqlite");
  provisionV2ManufacturingDemoData();
  evaluateContextRules(openV2SqliteStore(), "demo-manufacturing", "ctx-so-mfg-001");
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

describe("manufacturing workbench HTTP surface", () => {
  it("serves the independent V2 workbench and keeps the V1 route intact", async () => {
    const manufacturing = await call("/manufacturing");
    expect(manufacturing.status).toBe(200);
    expect(manufacturing.contentType).toContain("text/html");
    expect(manufacturing.body).toContain('<div id="root"></div>');

    const css = await call("/manufacturing-legacy/styles.css");
    expect(css.status).toBe(200);
    expect(css.contentType).toContain("text/css");
    const js = await call("/manufacturing-legacy/app.js");
    expect(js.status).toBe(200);
    expect(js.contentType).toContain("javascript");

    const legacy = await call("/manufacturing-legacy");
    expect(legacy.status).toBe(200);
    expect(legacy.body).toContain("Manufacturing Fulfillment Governance");
    expect(legacy.body).toContain("制造履约数字线程");

    const v1 = await call("/");
    expect(v1.status).toBe(200);
    expect(v1.body).toContain("履约异常处理台");
  });

  it("returns the pure-query manufacturing view and respects tenant boundaries", async () => {
    const response = await call("/api/v2/contexts/ctx-so-mfg-001/workbench");
    expect(response.status).toBe(200);
    const body = JSON.parse(response.body) as {
      context: { businessKey: string };
      thread: unknown[];
      rules: unknown[];
      exceptions: unknown[];
      defaultExceptionId: string;
    };
    expect(body.context.businessKey).toBe("SO-MFG-001");
    expect(body.thread).toHaveLength(8);
    expect(body.rules).toHaveLength(7);
    expect(body.exceptions).toHaveLength(4);
    expect(body.defaultExceptionId).toBeTruthy();

    const hidden = await call("/api/v2/contexts/ctx-so-mfg-001/workbench", { "x-tenant-id": "another-tenant" });
    expect(hidden.status).toBe(404);
    expect(JSON.parse(hidden.body)).toEqual({ error: "not_found" });
    const unknown = await call("/api/v2/contexts/ctx-unknown/workbench");
    expect(unknown.status).toBe(404);
    expect(JSON.parse(unknown.body)).toEqual({ error: "not_found" });
  });

  it("does not evaluate rules, create exceptions, or create Resolution Cases", async () => {
    const before = openV2SqliteStore();
    const beforeCounts = {
      evaluations: before.listRuleEvaluations("demo-manufacturing", "ctx-so-mfg-001").length,
      exceptions: before.listExceptions("demo-manufacturing", "ctx-so-mfg-001").length,
      resolutions: before.listResolutionCases("demo-manufacturing", "ctx-so-mfg-001").length,
    };

    const response = await call("/api/v2/contexts/ctx-so-mfg-001/workbench");
    expect(response.status).toBe(200);

    const after = openV2SqliteStore();
    expect({
      evaluations: after.listRuleEvaluations("demo-manufacturing", "ctx-so-mfg-001").length,
      exceptions: after.listExceptions("demo-manufacturing", "ctx-so-mfg-001").length,
      resolutions: after.listResolutionCases("demo-manufacturing", "ctx-so-mfg-001").length,
    }).toEqual(beforeCounts);
  });
});
