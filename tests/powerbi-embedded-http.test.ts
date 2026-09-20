import { createHmac } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const authSecret = "01234567890123456789012345678901";
const base = `http://127.0.0.1:${35520 + (process.pid % 50)}`;
const configuredBase = `http://127.0.0.1:${35620 + (process.pid % 50)}`;
const demoBase = `http://127.0.0.1:${35720 + (process.pid % 50)}`;
const demoConfiguredBase = `http://127.0.0.1:${35820 + (process.pid % 50)}`;
let child: ChildProcess;
let configuredChild: ChildProcess;
let demoChild: ChildProcess;
let demoConfiguredChild: ChildProcess;

function jwt(claims: { tenantId: string; scopes: string[] }) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    sub: "user-1",
    tenant_id: claims.tenantId,
    roles: ["viewer"],
    scopes: claims.scopes,
    exp: Math.floor(Date.now() / 1000) + 300,
  });
  const signature = createHmac("sha256", authSecret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

async function waitUntilHealthy(target: string) {
  for (let index = 0; index < 100; index += 1) {
    try {
      if ((await fetch(`${target}/api/health`)).ok) return;
    } catch {
      // server is not ready
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("powerbi embedded server did not become healthy");
}

function startServer(port: number, extraEnv: NodeJS.ProcessEnv) {
  return spawn(join(process.cwd(), "node_modules", ".bin", "tsx"), ["src/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      NODE_ENV: "test",
      DEMO_MODE: "false",
      AUTH_SECRET: authSecret,
      ...extraEnv,
    },
    stdio: "ignore",
  });
}

const unconfiguredPort = Number(new URL(base).port);
const configuredPort = Number(new URL(configuredBase).port);
const demoPort = Number(new URL(demoBase).port);
const demoConfiguredPort = Number(new URL(demoConfiguredBase).port);

const CONFIGURED_POWERBI_ENV = {
  POWERBI_TENANT_ID: "entra-tenant-id",
  POWERBI_PRODUCT_TENANT_ID: "tenant-a",
  POWERBI_CLIENT_ID: "client-id",
  POWERBI_CLIENT_SECRET: "server-secret",
  POWERBI_WORKSPACE_ID: "workspace-id",
  POWERBI_REPORT_ID: "report-id",
} as NodeJS.ProcessEnv;

beforeAll(async () => {
  child = startServer(unconfiguredPort, {
    PACK_STORE_DIR: mkdtempSync(join(tmpdir(), "fep-powerbi-http-")),
    POWERBI_TENANT_ID: "",
    POWERBI_PRODUCT_TENANT_ID: "",
    POWERBI_CLIENT_ID: "",
    POWERBI_CLIENT_SECRET: "",
    POWERBI_WORKSPACE_ID: "",
    POWERBI_REPORT_ID: "",
  });
  await waitUntilHealthy(base);

  configuredChild = startServer(configuredPort, {
    PACK_STORE_DIR: mkdtempSync(join(tmpdir(), "fep-powerbi-http-configured-")),
    ...CONFIGURED_POWERBI_ENV,
  });
  await waitUntilHealthy(configuredBase);

  demoChild = startServer(demoPort, {
    DEMO_MODE: "true",
    PACK_STORE_DIR: mkdtempSync(join(tmpdir(), "fep-powerbi-http-demo-")),
    POWERBI_TENANT_ID: "",
    POWERBI_PRODUCT_TENANT_ID: "",
    POWERBI_CLIENT_ID: "",
    POWERBI_CLIENT_SECRET: "",
    POWERBI_WORKSPACE_ID: "",
    POWERBI_REPORT_ID: "",
  });
  await waitUntilHealthy(demoBase);

  demoConfiguredChild = startServer(demoConfiguredPort, {
    DEMO_MODE: "true",
    PACK_STORE_DIR: mkdtempSync(join(tmpdir(), "fep-powerbi-http-demo-configured-")),
    ...CONFIGURED_POWERBI_ENV,
  });
  await waitUntilHealthy(demoConfiguredBase);
});

afterAll(() => {
  child?.kill("SIGTERM");
  configuredChild?.kill("SIGTERM");
  demoChild?.kill("SIGTERM");
  demoConfiguredChild?.kill("SIGTERM");
});

describe("Power BI Embedded HTTP boundary", () => {
  it("requires authentication before returning an embed configuration", async () => {
    const response = await fetch(`${base}/api/v2/analytics/powerbi/embed-config`);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "auth_required" });
  });

  it("requires the analytics:read scope", async () => {
    const response = await fetch(`${base}/api/v2/analytics/powerbi/embed-config`, {
      headers: { authorization: `Bearer ${jwt({ tenantId: "tenant-a", scopes: ["fulfillment:sales"] })}` },
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "scope_forbidden" });
  });

  it("returns the stable not-configured error for a scoped caller", async () => {
    const response = await fetch(`${base}/api/v2/analytics/powerbi/embed-config`, {
      headers: { authorization: `Bearer ${jwt({ tenantId: "tenant-a", scopes: ["analytics:read"] })}` },
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ error: "POWERBI_NOT_CONFIGURED" });
  });
});

describe("Power BI Embedded HTTP tenant boundary", () => {
  it("fails closed when the current product tenant is not the configured Power BI tenant", async () => {
    const response = await fetch(`${configuredBase}/api/v2/analytics/powerbi/embed-config`, {
      headers: { authorization: `Bearer ${jwt({ tenantId: "tenant-b", scopes: ["analytics:read"] })}` },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ error: "POWERBI_TENANT_FORBIDDEN" });
  });
});

describe("Power BI Embedded demo-mode boundary", () => {
  it("keeps the demo wildcard scope working instead of failing on scope", async () => {
    const response = await fetch(`${demoBase}/api/v2/analytics/powerbi/embed-config`, {
      headers: { "x-actor": "viewer", "x-tenant-id": "tenant-a" },
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "POWERBI_NOT_CONFIGURED" });
  });

  it("still fails closed when the demo tenant is not the bound product tenant", async () => {
    const response = await fetch(`${demoConfiguredBase}/api/v2/analytics/powerbi/embed-config`, {
      headers: { "x-actor": "viewer", "x-tenant-id": "tenant-b" },
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "POWERBI_TENANT_FORBIDDEN" });
  });
});
