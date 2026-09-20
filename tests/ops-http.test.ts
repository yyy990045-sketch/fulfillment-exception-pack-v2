import { createHmac } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateContextRules, openV2SqliteStore, provisionV2ManufacturingDemoData } from "../src/domain/v2/index.js";

const authSecret = "ops-http-test-secret-0123456789abcd";
const basePort = 37400 + (process.pid % 60);
const tenant = "demo-manufacturing";
const contextId = "ctx-so-mfg-001";

let server: ChildProcess;
let storeDir: string;
let base = "";
let exceptionId = "";
const logLines: string[] = [];

function token(subjectId: string, roles: string[]) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({ sub: subjectId, tenant_id: tenant, roles, exp: Math.floor(Date.now() / 1000) + 600 });
  const signature = createHmac("sha256", authSecret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function startServer(port: number, extraEnv: Record<string, string>) {
  const child = spawn(join(process.cwd(), "node_modules", ".bin", "tsx"), ["src/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      NODE_ENV: "production",
      DEMO_MODE: "false",
      AUTH_SECRET: authSecret,
      PACK_STORE_BACKEND: "json",
      PACK_STORE_DIR: storeDir,
      LOG_LEVEL: "info",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk: Buffer) => { for (const line of chunk.toString("utf8").split("\n")) if (line.trim()) logLines.push(line); });
  child.stderr?.on("data", (chunk: Buffer) => { for (const line of chunk.toString("utf8").split("\n")) if (line.trim()) logLines.push(line); });
  return child;
}

async function waitFor(url: string, timeoutMs = 25_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try { if ((await fetch(url)).ok) return; } catch { /* not ready */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`server not healthy: ${url}`);
}

beforeAll(async () => {
  storeDir = mkdtempSync(join(tmpdir(), "fep-ops-http-"));
  process.env.PACK_STORE_DIR = storeDir;
  process.env.PACK_STORE_DB = join(storeDir, "pack-cases.sqlite");
  provisionV2ManufacturingDemoData();
  const evaluated = evaluateContextRules(openV2SqliteStore(), tenant, contextId)!;
  exceptionId = evaluated.exceptions[0]!.id;

  base = `http://127.0.0.1:${basePort}`;
  server = startServer(basePort, {});
  await waitFor(`${base}/api/health`);
});

afterAll(async () => {
  if (server && server.exitCode === null) {
    server.kill("SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  rmSync(storeDir, { recursive: true, force: true });
});

describe("health / readiness separation", () => {
  it("keeps /api/health as a process liveness check", async () => {
    const response = await fetch(`${base}/api/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("reports readiness including migrations, writability and integration status", async () => {
    const response = await fetch(`${base}/api/ready`);
    const body = await response.json() as { ready: boolean; checks: Array<{ id: string; status: string }> };
    expect(response.status).toBe(200);
    expect(body.ready).toBe(true);
    expect(body.checks.map((item) => item.id)).toContain("migrations.consistent");
    expect(body.checks.map((item) => item.id)).toContain("store.writable");
    expect(body.checks.every((item) => item.status !== "fail")).toBe(true);
  });
});

describe("ops status endpoint", () => {
  it("requires authentication and an admin scope", async () => {
    const anonymous = await fetch(`${base}/api/v2/ops/status`);
    expect(anonymous.status).toBe(401);

    const viewer = await fetch(`${base}/api/v2/ops/status`, { headers: { authorization: `Bearer ${token("viewer-1", ["viewer"])}` } });
    expect(viewer.status).toBe(403);
    await expect(viewer.json()).resolves.toEqual({ error: "scope_forbidden" });
  });

  it("returns operational status for an admin without leaking secrets", async () => {
    const response = await fetch(`${base}/api/v2/ops/status`, { headers: { authorization: `Bearer ${token("admin-1", ["管理员"])}` } });
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, any>;
    expect(body.schemaVersion).toBeTruthy();
    expect(body.databaseReachable).toBe(true);
    expect(body.databaseWritable).toBe(true);
    expect(body.migrationStatus.current).toBeTruthy();
    expect(body.integrationsConfigured).toEqual({ superset: "unconfigured", powerbi: "unconfigured", openSupos: "unconfigured", jev: "unconfigured" });
    expect(typeof body.uptimeSeconds).toBe("number");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(authSecret);
    expect(serialized).not.toMatch(/password|"token"|connectionString/i);
  });
});

describe("request id and structured logs", () => {
  it("echoes a safe X-Request-ID and generates one when missing or unsafe", async () => {
    const echoed = await fetch(`${base}/api/health`, { headers: { "x-request-id": "req-abc-123" } });
    expect(echoed.headers.get("x-request-id")).toBe("req-abc-123");

    const generated = await fetch(`${base}/api/health`);
    const generatedId = generated.headers.get("x-request-id") ?? "";
    expect(generatedId.length).toBeGreaterThan(8);

    const unsafe = await fetch(`${base}/api/health`, { headers: { "x-request-id": "bad id with spaces\n" } });
    expect(unsafe.headers.get("x-request-id")).not.toContain(" ");
  });

  it("writes one structured access log per request with requestId, tenant and duration", async () => {
    logLines.length = 0;
    const requestId = "req-log-check";
    await fetch(`${base}/api/v2/contexts/${contextId}/exceptions`, {
      headers: { authorization: `Bearer ${token("viewer-log", ["viewer"])}`, "x-request-id": requestId },
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const line = logLines.map((item) => { try { return JSON.parse(item) as Record<string, any>; } catch { return null; } })
      .find((item) => item?.event === "http.request" && item.requestId === requestId);
    expect(line).toBeTruthy();
    expect(line).toMatchObject({ method: "GET", status: 200, tenantId: tenant, subjectId: "viewer-log" });
    expect(typeof line!.durationMs).toBe("number");
    expect(JSON.stringify(line)).not.toContain(authSecret);
    expect(JSON.stringify(line)).not.toContain("Bearer");
  });

  it("links audit records to the same requestId", async () => {
    const requestId = "req-audit-link";
    const response = await fetch(`${base}/api/v2/contexts/${contextId}/exceptions/${encodeURIComponent(exceptionId)}/resolution-case`, {
      method: "POST",
      headers: { authorization: `Bearer ${token("owner-1", ["品质负责人"])}`, "content-type": "application/json", "x-request-id": requestId },
      body: JSON.stringify({ ownerRole: "品质负责人", rationale: "运维验证：审计需带 requestId" }),
    });
    expect(response.status).toBe(200);
    const store = openV2SqliteStore();
    const events = store.listSecurityAuditEvents(tenant, { action: "resolution.accept" });
    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1]!.metadata.requestId).toBe(requestId);
  });
});

describe("graceful shutdown", () => {
  it("exits cleanly on SIGTERM after closing the server", async () => {
    const port = basePort + 11;
    const child = startServer(port, {});
    const childBase = `http://127.0.0.1:${port}`;
    await waitFor(`${childBase}/api/health`);
    const exitCode = await new Promise<number | null>((resolve) => {
      child.once("exit", (code) => resolve(code));
      child.kill("SIGTERM");
      setTimeout(() => resolve(null), 12_000);
    });
    expect(exitCode).toBe(0);
    const shutdownLogged = logLines.some((line) => line.includes("ops.shutdown.complete"));
    expect(shutdownLogged).toBe(true);
  });
});

describe("readiness gating for explicitly required integrations", () => {
  it("fails readiness only when an integration is marked required", async () => {
    const port = basePort + 22;
    const child = startServer(port, { SUPERSET_REQUIRED: "true" });
    const childBase = `http://127.0.0.1:${port}`;
    await waitFor(`${childBase}/api/health`);
    const response = await fetch(`${childBase}/api/ready`);
    const body = await response.json() as { ready: boolean; checks: Array<{ id: string; status: string }> };
    expect(response.status).toBe(503);
    expect(body.ready).toBe(false);
    expect(body.checks.find((item) => item.id === "integration.superset")?.status).toBe("fail");
    child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 400));
    child.kill("SIGKILL");
  }, 30_000);
});
