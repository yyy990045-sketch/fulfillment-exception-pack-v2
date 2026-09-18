import { spawn, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateContextRules, openV2SqliteStore, provisionV2DemoData } from "../src/domain/v2/index.js";

const port = 34390 + (process.pid % 100);
const gatePort = 34590 + (process.pid % 50);
const headers = { "content-type": "application/json", "x-actor": "quality-owner", "x-tenant-id": "demo-industrial" };

let child: ChildProcess;
let storeDir: string;
let exceptionId = "";
const extraChildren: ChildProcess[] = [];

function base64url(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function productionToken() {
  const secret = "a".repeat(64);
  const header = base64url({ alg: "HS256", typ: "JWT" });
  const payload = base64url({
    sub: "gate-test",
    tenant_id: "demo-industrial",
    roles: ["品质负责人"],
    scopes: ["*"],
    name: "gate-test",
    exp: Math.floor(Date.now() / 1000) + 300,
  });
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

async function callAt(targetPort: number, method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
  const response = await fetch(`http://127.0.0.1:${targetPort}${path}`, {
    method,
    headers: { ...headers, ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json().catch(() => ({}))) as Record<string, unknown> };
}

async function call(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
  return callAt(port, method, path, body, extraHeaders);
}

async function waitUntilHealthy(targetPort: number) {
  for (let i = 0; i < 100; i += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${targetPort}/api/health`)).ok) return;
    } catch { /* not ready */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("server did not become healthy");
}

async function spawnGateServer(input: { port: number; demoMode: boolean; provider?: string }) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(input.port),
    NODE_ENV: input.demoMode ? "test" : "production",
    DEMO_MODE: input.demoMode ? "true" : "false",
    AUTH_SECRET: "a".repeat(64),
    PACK_STORE_BACKEND: "json",
    PACK_STORE_DIR: storeDir,
  };
  if (input.provider === undefined) delete env.GROUNDING_AI_PROVIDER;
  else env.GROUNDING_AI_PROVIDER = input.provider;
  const gateChild = spawn(join(process.cwd(), "node_modules", ".bin", "tsx"), ["src/server.ts"], {
    cwd: process.cwd(),
    env,
    stdio: "ignore",
  });
  extraChildren.push(gateChild);
  await waitUntilHealthy(input.port);
  return gateChild;
}

beforeAll(async () => {
  storeDir = mkdtempSync(join(tmpdir(), "fep-grounded-http-"));
  process.env.PACK_STORE_DIR = storeDir;
  process.env.PACK_STORE_DB = join(storeDir, "pack-cases.sqlite");
  provisionV2DemoData();
  const evaluated = evaluateContextRules(openV2SqliteStore(), "demo-industrial", "ctx-so-demo-001")!;
  exceptionId = evaluated.exceptions.find((item) => item.code === "CUSTOMER_RECEIPT_CLAIM_MISMATCH")!.id;
  child = await spawnGateServer({ port, demoMode: true, provider: "deterministic" });
});

afterAll(() => {
  child?.kill("SIGTERM");
  for (const extra of extraChildren) extra.kill("SIGTERM");
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

  it("fails closed when the deterministic provider is not explicitly configured", async () => {
    const targetPort = gatePort;
    await spawnGateServer({ port: targetPort, demoMode: true });
    const path = `/api/v2/contexts/ctx-so-demo-001/exceptions/${exceptionId}/explanations`;
    const countBefore = openV2SqliteStore().listGroundedExplanations("demo-industrial", "ctx-so-demo-001", exceptionId).length;
    const response = await callAt(targetPort, "POST", path, {});
    expect(response.status).toBe(503);
    expect(response.json).toEqual({ error: "GROUNDING_AI_PROVIDER_REQUIRED" });
    const countAfter = openV2SqliteStore().listGroundedExplanations("demo-industrial", "ctx-so-demo-001", exceptionId).length;
    expect(countAfter).toBe(countBefore);
  });

  it("rejects unknown provider names", async () => {
    const targetPort = gatePort + 1;
    await spawnGateServer({ port: targetPort, demoMode: true, provider: "unknown-provider" });
    const path = `/api/v2/contexts/ctx-so-demo-001/exceptions/${exceptionId}/explanations`;
    const response = await callAt(targetPort, "POST", path, {});
    expect(response.status).toBe(503);
    expect(response.json).toEqual({ error: "AI_PROVIDER_NOT_CONFIGURED" });
  });

  it("rejects deterministic provider outside demo mode", async () => {
    const targetPort = gatePort + 2;
    await spawnGateServer({ port: targetPort, demoMode: false, provider: "deterministic" });
    const path = `/api/v2/contexts/ctx-so-demo-001/exceptions/${exceptionId}/explanations`;
    const response = await callAt(targetPort, "POST", path, {}, { Authorization: `Bearer ${productionToken()}` });
    expect(response.status).toBe(503);
    expect(response.json).toEqual({ error: "GROUNDING_AI_PROVIDER_REQUIRED" });
  });

  it("keeps GET explanations independent of provider configuration", async () => {
    const path = `/api/v2/contexts/ctx-so-demo-001/exceptions/${exceptionId}/explanations`;
    const generated = await call("POST", path, {});
    expect(generated.status).toBe(200);
    const explanationId = (generated.json.explanation as { id: string }).id;
    const targetPort = gatePort + 3;
    await spawnGateServer({ port: targetPort, demoMode: true });
    const list = await callAt(targetPort, "GET", path);
    const detail = await callAt(targetPort, "GET", `${path}/${explanationId}`);
    expect(list.status).toBe(200);
    expect(list.json).toMatchObject({ explanations: [{ id: explanationId }] });
    expect(detail.status).toBe(200);
    expect(detail.json).toMatchObject({ explanation: { id: explanationId }, stale: false });
  });
});
