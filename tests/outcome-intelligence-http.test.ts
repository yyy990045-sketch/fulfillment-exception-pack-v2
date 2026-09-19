import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createEvidence,
  evaluateContextRules,
  openV2SqliteStore,
  provisionV2ManufacturingDemoData,
} from "../src/domain/v2/index.js";
import { provisionDefaultManufacturingOutcomeDefinitions } from "../src/outcomes/index.js";

const port = 35850 + (process.pid % 60);
const base = `http://127.0.0.1:${port}`;
let child: ChildProcess;
let storeDir: string;
let exceptionId = "";
let definitionId = "";
const evidenceId = "evidence-http-outcome-customer";

async function call(method: string, path: string, body?: unknown, actor = "quality-owner", tenant = "demo-manufacturing") {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-tenant-id": tenant,
      ...(actor ? { "x-actor": actor } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json().catch(() => ({}))) as Record<string, any> };
}

async function waitUntilHealthy() {
  for (let index = 0; index < 100; index += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch { /* not ready */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("outcome server did not become healthy");
}

beforeAll(async () => {
  storeDir = mkdtempSync(join(tmpdir(), "fep-outcome-http-"));
  process.env.PACK_STORE_DIR = storeDir;
  process.env.PACK_STORE_DB = join(storeDir, "pack-cases.sqlite");
  provisionV2ManufacturingDemoData();
  evaluateContextRules(openV2SqliteStore(), "demo-manufacturing", "ctx-so-mfg-001");
  const store = openV2SqliteStore();
  provisionDefaultManufacturingOutcomeDefinitions(store, "demo-manufacturing");
  definitionId = store.listOutcomeDefinitions("demo-manufacturing", "CUSTOMER_RECEIPT_CLAIM_MISMATCH", true)[0]!.id;
  exceptionId = store.listExceptions("demo-manufacturing", "ctx-so-mfg-001")
    .find((item) => item.code === "CUSTOMER_RECEIPT_CLAIM_MISMATCH")!.id;
  store.saveEvidence(createEvidence({
    id: evidenceId,
    tenantId: "demo-manufacturing",
    contextId: "ctx-so-mfg-001",
    sourceSystemId: "SERVICE-DEMO",
    sourceDocumentId: "doc-complaint-mfg-001-v1",
    sourceVersion: "v1",
    entityId: "entity-complaint-mfg-001",
    field: "verifiedReceiptDifference",
    value: 0,
    valueType: "number",
    locator: { fileName: "outcome.csv", row: 2, cell: "verifiedReceiptDifference" },
    quote: "verifiedReceiptDifference=0",
    confidence: 1,
    support: "supported",
    observedAt: "2026-10-11T00:00:00.000Z",
    createdAt: "2026-10-11T00:00:00.000Z",
    metadata: { synthetic: true },
  }));
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

describe("Outcome Intelligence HTTP", () => {
  it("creates and reads an Evidence-backed Outcome Evaluation", async () => {
    const path = `/api/v2/contexts/ctx-so-mfg-001/exceptions/${exceptionId}/outcome-evaluations`;
    const definitions = await call("GET", `/api/v2/outcome-definitions?exceptionCode=CUSTOMER_RECEIPT_CLAIM_MISMATCH`);
    expect(definitions.status).toBe(200);
    expect(definitions.json.definitions.some((item: any) => item.id === definitionId)).toBe(true);
    const created = await call("POST", path, { definitionId, evidenceIds: [evidenceId] });
    expect(created.status).toBe(200);
    expect(created.json).toMatchObject({ status: "target_met", syntheticEvidence: true, truthfulness: { evidenceBacked: true, causalAttribution: false } });
    const list = await call("GET", path);
    expect(list.json.evaluations).toHaveLength(1);
    const detail = await call("GET", `${path}/${created.json.id}`);
    expect(detail.status).toBe(200);
    expect(detail.json.id).toBe(created.json.id);
  });

  it("rejects raw value/status injection, actor injection, and cross-tenant access", async () => {
    const path = `/api/v2/contexts/ctx-so-mfg-001/exceptions/${exceptionId}/outcome-evaluations`;
    const injected = await call("POST", path, { definitionId, evidenceIds: [evidenceId], value: 0, status: "target_met" });
    expect(injected.status).toBe(400);
    expect(injected.json.error).toBe("OUTCOME_REQUEST_FIELDS_FORBIDDEN");
    const actorInjected = await call("POST", path, { definitionId, evidenceIds: [evidenceId], actor: "admin" });
    expect(actorInjected.status).toBe(400);
    const noActor = await call("POST", path, { definitionId, evidenceIds: [evidenceId] }, "");
    expect(noActor.status).toBe(401);
    const crossTenant = await call("GET", path, undefined, "quality-owner", "other-tenant");
    expect(crossTenant.status).toBe(404);
  });
});
