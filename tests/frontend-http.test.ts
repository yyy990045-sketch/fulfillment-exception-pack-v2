import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const port = 35290 + (process.pid % 100);
const base = `http://127.0.0.1:${port}`;
let child: ChildProcess;
let storeDir: string;

async function waitUntilHealthy() {
  for (let index = 0; index < 100; index += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("frontend_http_server_not_ready");
}

beforeAll(async () => {
  storeDir = mkdtempSync(join(tmpdir(), "fep-frontend-http-"));
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

describe("React frontend HTTP integration", () => {
  it("serves the Vite app for manufacturing deep links", async () => {
    for (const path of [
      "/manufacturing",
      "/manufacturing/ctx-so-mfg-001",
      "/manufacturing/ctx-so-mfg-001/exceptions/example/evidence",
    ]) {
      const response = await fetch(`${base}${path}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(await response.text()).toContain('<div id="root"></div>');
    }
  });

  it("keeps the legacy manufacturing workbench available separately", async () => {
    const response = await fetch(`${base}/manufacturing-legacy`);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("Manufacturing Fulfillment Governance");
    expect(body).toContain("/manufacturing-legacy/styles.css");
  });
});
