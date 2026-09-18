import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateContextRules, openV2SqliteStore, provisionV2DemoData } from "../src/domain/v2/index.js";

const port = 34390 + (process.pid % 100);
const base = `http://127.0.0.1:${port}`;
const headers = { "content-type": "application/json", "x-actor": "quality-owner", "x-tenant-id": "demo-industrial" };

let child: ChildProcess;
let storeDir: string;
let exceptionId = "";

async function call(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...headers, ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json().catch(() => ({}))) as Record<string, unknown> };
}

async function waitUntilHealthy() {
  for (let i = 0; i < 100; i += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch { /* not ready */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("server did not become healthy");
}

beforeAll(async () => {
  storeDir = mkdtempSync(join(tmpdir(), "fep-grounded-http-"));
  process.env.PACK_STORE_DIR = storeDir;
  process.env.PACK_STORE_DB = join(storeDir, "pack-cases.sqlite");
  provisionV2DemoData();
  const evaluated = evaluateContextRules(openV2SqliteStore(), "demo-industrial", "ctx-so-demo-001")!;
  exceptionId = evaluated.exceptions.find((item) => item.code === "CUSTOMER_RECEIPT_CLAIM_MISMATCH")!.id;
  child = spawn(join(process.cwd(), "node_modules", ".bin", "tsx"), ["src/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      NODE_ENV: "test",
      DEMO_MODE: "true",
      GROUNDING_AI_PROVIDER: "deterministic",
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

describe("grounded AI explanation HTTP boundary", () => {
  it("generates and reuses a deterministic grounded explanation", async () => {
    const path = `/api/v2/contexts/ctx-so-demo-001/exceptions/${exceptionId}/explanations`;
    const first = await call("POST", path, {});
    expect(first.status).toBe(200);
    const explanation = first.json.explanation as {
      id: string;
      provider: string;
      model: string;
      status: string;
      output: { executiveSummary: string };
      validation: { valid: boolean };
    };
    expect(first.json.stale).toBe(false);
    expect(explanation).toMatchObject({
      provider: "deterministic-demo",
      model: "grounded-fixture-v1",
      status: "generated",
      validation: { valid: true },
    });
    expect(explanation.output.executiveSummary).toContain("客户在客诉记录中主张收到80件");

    const second = await call("POST", path, {});
    expect(second.status).toBe(200);
    expect((second.json.explanation as { id: string }).id).toBe(explanation.id);

    const listed = await call("GET", path);
    expect(listed.status).toBe(200);
    expect((listed.json.explanations as unknown[])).toHaveLength(1);
  });

  it("returns detail through a pure query without changing governance state", async () => {
    const path = `/api/v2/contexts/ctx-so-demo-001/exceptions/${exceptionId}/explanations`;
    const generated = await call("POST", path, {});
    const explanationId = (generated.json.explanation as { id: string }).id;
    const before = {
      explanations: openV2SqliteStore().listGroundedExplanations("demo-industrial", "ctx-so-demo-001", exceptionId).length,
      resolutionCases: openV2SqliteStore().listResolutionCases("demo-industrial", "ctx-so-demo-001").length,
    };
    const detail = await call("GET", `${path}/${explanationId}`);
    expect(detail.status).toBe(200);
    expect(detail.json).toMatchObject({
      stale: false,
      explanation: {
        id: explanationId,
        status: "generated",
        provider: "deterministic-demo",
      },
    });
    const after = {
      explanations: openV2SqliteStore().listGroundedExplanations("demo-industrial", "ctx-so-demo-001", exceptionId).length,
      resolutionCases: openV2SqliteStore().listResolutionCases("demo-industrial", "ctx-so-demo-001").length,
    };
    expect(after).toEqual(before);
  });

  it("requires actor and tenant from authentication context", async () => {
    const path = `/api/v2/contexts/ctx-so-demo-001/exceptions/${exceptionId}/explanations`;
    const noActor = await call("POST", path, {}, { "x-actor": "" });
    expect(noActor.status).toBe(401);
    const tenantBody = await call("POST", path, { tenantId: "another-tenant" });
    expect(tenantBody.status).toBe(400);
    expect(tenantBody.json).toEqual({ error: "tenant_from_auth_required" });
  });

  it("hides another tenant's explanation paths with 404", async () => {
    const path = `/api/v2/contexts/ctx-so-demo-001/exceptions/${exceptionId}/explanations`;
    const post = await call("POST", path, {}, { "x-tenant-id": "another-tenant" });
    expect(post.status).toBe(404);
    const get = await call("GET", path, undefined, { "x-tenant-id": "another-tenant" });
    expect(get.status).toBe(404);
  });
});
