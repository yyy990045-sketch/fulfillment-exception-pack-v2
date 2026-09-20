import { createHmac } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const port = 35420 + (process.pid % 70);
const base = `http://127.0.0.1:${port}`;
const authSecret = "01234567890123456789012345678901";
let child: ChildProcess;
let storeDir: string;

function jwt() {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    sub: "user-1",
    tenant_id: "tenant-a",
    roles: ["viewer"],
    scopes: ["analytics:read"],
    exp: Math.floor(Date.now() / 1000) + 300,
  });
  const signature = createHmac("sha256", authSecret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

async function waitUntilHealthy() {
  for (let index = 0; index < 100; index += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {
      // server is not ready
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("powerbi embedded server did not become healthy");
}

beforeAll(async () => {
  storeDir = mkdtempSync(join(tmpdir(), "fep-powerbi-http-"));
  child = spawn(join(process.cwd(), "node_modules", ".bin", "tsx"), ["src/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      NODE_ENV: "test",
      DEMO_MODE: "false",
      AUTH_SECRET: authSecret,
      PACK_STORE_DIR: storeDir,
      PACK_STORE_DB: join(storeDir, "pack-cases.sqlite"),
      POWERBI_TENANT_ID: "",
      POWERBI_CLIENT_ID: "",
      POWERBI_CLIENT_SECRET: "",
      POWERBI_WORKSPACE_ID: "",
      POWERBI_REPORT_ID: "",
    },
    stdio: "ignore",
  });
  await waitUntilHealthy();
});

afterAll(() => {
  child?.kill("SIGTERM");
  rmSync(storeDir, { recursive: true, force: true });
});

describe("Power BI Embedded HTTP boundary", () => {
  it("requires authentication before returning an embed configuration", async () => {
    const response = await fetch(`${base}/api/v2/analytics/powerbi/embed-config`);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "auth_required" });
  });

  it("returns the stable not-configured error for an authenticated user", async () => {
    const response = await fetch(`${base}/api/v2/analytics/powerbi/embed-config`, {
      headers: { authorization: `Bearer ${jwt()}` },
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ error: "POWERBI_NOT_CONFIGURED" });
  });
});
