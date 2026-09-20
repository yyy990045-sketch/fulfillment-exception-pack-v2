import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const authSecret = "01234567890123456789012345678901";
const appPort = 35920 + (process.pid % 40);
const stubPort = 35990 + (process.pid % 9);
const appBase = `http://127.0.0.1:${appPort}`;
const stubBase = `http://127.0.0.1:${stubPort}`;

let app: ChildProcess;
let stub: Server;

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

async function readBody(request: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** 桩 Superset：复刻 login → csrf(下发 session) → guest_token(必须带 cookie+csrf) 的真实契约 */
function startStub() {
  return createServer(async (request, response) => {
    const url = request.url ?? "";
    if (url === "/api/v1/security/login") {
      await readBody(request);
      response.writeHead(200, { "content-type": "application/json", "set-cookie": "login=1; Path=/" });
      response.end(JSON.stringify({ access_token: "admin-access-token" }));
      return;
    }
    if (url === "/api/v1/security/csrf_token/") {
      response.writeHead(200, { "content-type": "application/json", "set-cookie": "session=abc; Path=/" });
      response.end(JSON.stringify({ result: "csrf-token" }));
      return;
    }
    if (url === "/api/v1/security/guest_token/") {
      const body = await readBody(request);
      const cookie = String(request.headers.cookie ?? "");
      const csrf = String(request.headers["x-csrftoken"] ?? "");
      if (!cookie.includes("session=abc") || csrf !== "csrf-token") {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ errors: [{ message: "The CSRF session token is missing." }] }));
        return;
      }
      const parsed = JSON.parse(body) as { resources: Array<{ id: string }>; user: { username: string } };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        token: `guest.${Buffer.from(JSON.stringify({
          resources: parsed.resources,
          user: parsed.user.username,
        })).toString("base64url")}.sig`,
      }));
      return;
    }
    response.writeHead(404).end("{}");
  }).listen(stubPort);
}

async function waitUntilHealthy(target: string) {
  for (let index = 0; index < 100; index += 1) {
    try {
      if ((await fetch(`${target}/api/health`)).ok) return;
    } catch {
      // 还没起来
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`server at ${target} did not become healthy`);
}

beforeAll(async () => {
  stub = startStub();
  const storeDir = mkdtempSync(join(tmpdir(), "fep-superset-http-"));
  app = spawn(join(process.cwd(), "node_modules", ".bin", "tsx"), ["src/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(appPort),
      NODE_ENV: "production",
      DEMO_MODE: "false",
      AUTH_SECRET: authSecret,
      PACK_STORE_DIR: storeDir,
      PACK_STORE_DB: join(storeDir, "pack-cases.sqlite"),
      SUPERSET_DOMAIN: stubBase,
      SUPERSET_DASHBOARD_ID: "dash-uuid",
      SUPERSET_PRODUCT_TENANT_ID: "demo-manufacturing",
      SUPERSET_SERVICE_USERNAME: "svc",
      SUPERSET_SERVICE_PASSWORD: "service-password",
    },
    stdio: "ignore",
  });
  await waitUntilHealthy(appBase);
});

afterAll(() => {
  app?.kill("SIGTERM");
  stub?.close();
});

describe("Superset guest token HTTP boundary", () => {
  it("refuses an unauthenticated caller", async () => {
    const response = await fetch(`${appBase}/api/v2/analytics/superset/guest-token`);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "auth_required" });
  });

  it("requires the analytics:read scope", async () => {
    const response = await fetch(`${appBase}/api/v2/analytics/superset/guest-token`, {
      headers: { authorization: `Bearer ${jwt({ tenantId: "demo-manufacturing", scopes: ["fulfillment:sales"] })}` },
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "scope_forbidden" });
  });

  it("fails closed for a different product tenant", async () => {
    const response = await fetch(`${appBase}/api/v2/analytics/superset/guest-token`, {
      headers: { authorization: `Bearer ${jwt({ tenantId: "other-tenant", scopes: ["analytics:read"] })}` },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ error: "SUPERSET_TENANT_FORBIDDEN" });
  });

  it("mints a scoped guest token for the bound tenant and leaks no server credential", async () => {
    const response = await fetch(`${appBase}/api/v2/analytics/superset/guest-token`, {
      headers: { authorization: `Bearer ${jwt({ tenantId: "demo-manufacturing", scopes: ["analytics:read"] })}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();

    expect(body).not.toContain("service-password");
    expect(body).not.toContain("admin-access-token");
    expect(body).not.toContain("csrf-token");

    const payload = JSON.parse(body);
    expect(payload).toMatchObject({
      dashboardId: "dash-uuid",
      supersetDomain: stubBase,
      expiresInSeconds: 300,
    });
    expect(payload.guestToken.startsWith("guest.")).toBe(true);
    // guest token 的用户声明里只带产品租户，不泄漏服务账号
    const claims = JSON.parse(Buffer.from(payload.guestToken.split(".")[1], "base64url").toString("utf8"));
    expect(claims.user).toBe("fep:demo-manufacturing:user-1");
    expect(claims.resources).toEqual([{ type: "dashboard", id: "dash-uuid" }]);
  });

  it("reports providers without exposing credentials", async () => {
    const response = await fetch(`${appBase}/api/v2/analytics/providers`, {
      headers: { authorization: `Bearer ${jwt({ tenantId: "demo-manufacturing", scopes: ["analytics:read"] })}` },
    });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain("service-password");
    const payload = JSON.parse(body);
    expect(payload.defaultProvider).toBe("superset");
    expect(payload.providers.superset).toMatchObject({ configured: true, dashboardId: "dash-uuid" });
  });
});
