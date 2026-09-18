import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const port = 34190 + (process.pid % 100);
const base = `http://127.0.0.1:${port}`;
const headers = { "content-type": "application/json", "x-actor": "admin", "x-tenant-id": "demo-tenant-a" };

let child: ChildProcess;
let storeDir: string;

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
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch { /* not ready yet */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("server did not become healthy");
}

beforeAll(async () => {
  storeDir = mkdtempSync(join(tmpdir(), "fx-pack-test-"));
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

async function driveToProposed(caseId: string) {
  const detail = await call("GET", `/api/cases/${caseId}`);
  expect(detail.status).toBe(200);
  const runtime = detail.json.runtime as { pack?: { conflicts?: Array<{ id: string }> } };
  const conflictIds = (runtime.pack?.conflicts ?? []).map((conflict) => conflict.id);
  if (conflictIds.length) {
    const reviewed = await call("POST", `/api/cases/${caseId}/review`, { conflictIds });
    expect(reviewed.status).toBe(200);
  }
  const proposed = await call("POST", `/api/cases/${caseId}/propose`, {});
  expect(proposed.status).toBe(200);
  return proposed.json as { status: string; actions: Array<{ id: string }> };
}

describe("http closed loop (demo mode, 127.0.0.1)", () => {
  it("keeps same-tenant V1 cases readable", async () => {
    const detail = await call("GET", "/api/cases/FX-001");
    expect(detail.status).toBe(200);
    expect((detail.json as { runtime?: { tenantId?: string } }).runtime?.tenantId).toBe("demo-tenant-a");
  });

  it("does not list cases owned by another tenant", async () => {
    const response = await call("GET", "/api/cases", undefined, { "x-tenant-id": "tenant-not-provisioned" });
    expect(response.status).toBe(200);
    expect(response.json).toEqual([]);
  });

  it("rejects cross-tenant source material before evidence, review, or proposal", async () => {
    const detail = await call("GET", "/api/cases/FX-016");
    expect(detail.status).toBe(403);
    expect(detail.json).toMatchObject({ error: "CROSS_TENANT_SOURCE" });

    const review = await call("POST", "/api/cases/FX-016/review", { conflictIds: [] });
    expect(review.status).toBe(403);
    expect(review.json).toMatchObject({ error: "CROSS_TENANT_SOURCE" });

    const propose = await call("POST", "/api/cases/FX-016/propose", {});
    expect(propose.status).toBe(403);
    expect(propose.json).toMatchObject({ error: "CROSS_TENANT_SOURCE" });
  });

  it("fails closed on missing scope before review or proposal", async () => {
    const detail = await call("GET", "/api/cases/FX-018");
    expect(detail.status).toBe(409);
    expect(detail.json).toMatchObject({ error: "NO_SCOPE" });

    const review = await call("POST", "/api/cases/FX-018/review", { conflictIds: [] });
    expect(review.status).toBe(409);
    expect(review.json).toMatchObject({ error: "NO_SCOPE" });

    const propose = await call("POST", "/api/cases/FX-018/propose", {});
    expect(propose.status).toBe(409);
    expect(propose.json).toMatchObject({ error: "NO_SCOPE" });
  });

  it("closes an aligned case with no actions at approve instead of dead-ending", async () => {
    const proposed = await driveToProposed("FX-029");
    expect(proposed.status).toBe("proposed");
    expect(proposed.actions).toHaveLength(0);
    const approved = await call("POST", "/api/cases/FX-029/approve", {});
    expect(approved.status).toBe(200);
    const runtime = approved.json as { status: string; events: Array<{ reason: string }> };
    expect(runtime.status).toBe("closed");
    expect(runtime.events.at(-1)?.reason).toBe("无冲突结案");
  });

  it("runs the full review→propose→approve→execute→close loop with local-ledger receipts", async () => {
    const proposed = await driveToProposed("FX-002");
    expect(proposed.status).toBe("proposed");
    expect(proposed.actions.length).toBeGreaterThan(0);
    const approved = await call("POST", "/api/cases/FX-002/approve", {});
    expect((approved.json as { status: string }).status).toBe("approved");
    const executed = await call("POST", "/api/cases/FX-002/execute", {});
    expect(executed.status).toBe(200);
    const executedRuntime = executed.json as { status: string; actions: Array<{ receipt: string; receiptSource: string; receiptAt?: string }> };
    expect(executedRuntime.status).toBe("executed");
    for (const action of executedRuntime.actions) {
      expect(action.receipt).toMatch(/^local-ledger:/);
      expect(action.receiptSource).toBe("local-ledger");
      expect(action.receiptAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    }
    const closed = await call("POST", "/api/cases/FX-002/close", {});
    expect((closed.json as { status: string }).status).toBe("closed");
    const receipts = await call("GET", "/api/cases/FX-002/receipts");
    expect((receipts.json as { receipts: unknown[] }).receipts.length).toBeGreaterThan(0);
  });

  it("rejects mutations without an actor header", async () => {
    const response = await call("POST", "/api/cases/FX-002/review", { conflictIds: [] }, { "x-actor": "" });
    expect(response.status).toBe(401);
  });

  it("returns 400 for malformed JSON bodies", async () => {
    const response = await fetch(`${base}/api/cases/FX-002/review`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: "{not-json",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_json" });
  });

  it("returns 413 for oversized request bodies", async () => {
    const response = await fetch(`${base}/api/cases/FX-002/review`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ reviews: "x".repeat(2 * 1024 * 1024) }),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: "payload_too_large" });
  });

  it("rejects unauthorized endpoints on refresh", async () => {
    const response = await call("POST", "/api/cases/FX-002/refresh", { endpoints: [{ id: "e1", url: "http://169.254.169.254/latest/meta-data" }] });
    expect(response.status).toBe(403);
    expect(response.json).toMatchObject({ error: "evidence_endpoint_forbidden" });
  });
});
