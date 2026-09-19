import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openV2SqliteStore, provisionV2DemoData } from "../src/domain/v2/index.js";

const port = 34190 + (process.pid % 100);
const base = `http://127.0.0.1:${port}`;
const headers = { "content-type": "application/json", "x-actor": "admin", "x-tenant-id": "demo-tenant-a" };

let child: ChildProcess;
let storeDir: string;
let heroResolutionCaseId = "";

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
  process.env.PACK_STORE_DIR = storeDir;
  process.env.PACK_STORE_DB = join(storeDir, "pack-cases.sqlite");
  provisionV2DemoData();
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

  it("replays the V2 SO-DEMO-001 fulfillment chain through an isolated API", async () => {
    const before = openV2SqliteStore().replayContext("demo-industrial", "ctx-so-demo-001");
    const response = await call("GET", "/api/v2/contexts/ctx-so-demo-001/replay", undefined, {
      "x-tenant-id": "demo-industrial",
    });
    expect(response.status).toBe(200);
    const replay = response.json as {
      context?: { businessKey?: string };
      entities?: unknown[];
      sourceSystems?: unknown[];
      documents?: unknown[];
      events?: unknown[];
      evidence?: unknown[];
    };
    expect(replay.context?.businessKey).toBe("SO-DEMO-001");
    expect(replay.entities).toHaveLength(6);
    expect(replay.sourceSystems).toHaveLength(5);
    expect(replay.documents).toHaveLength(6);
    expect(replay.events).toHaveLength(6);
    expect(replay.evidence).toHaveLength(6);
    const second = await call("GET", "/api/v2/contexts/ctx-so-demo-001/replay", undefined, {
      "x-tenant-id": "demo-industrial",
    });
    expect(second.status).toBe(200);
    const after = openV2SqliteStore().replayContext("demo-industrial", "ctx-so-demo-001");
    expect(after.entities).toHaveLength(before.entities.length);
    expect(after.documents).toHaveLength(before.documents.length);
    expect(after.events).toHaveLength(before.events.length);
    expect(after.evidence).toHaveLength(before.evidence.length);
  });

  it("keeps V2 GET evaluation endpoints read-only before an explicit run", async () => {
    const evaluations = await call("GET", "/api/v2/contexts/ctx-so-demo-001/rule-evaluations", undefined, {
      "x-tenant-id": "demo-industrial",
    });
    const exceptions = await call("GET", "/api/v2/contexts/ctx-so-demo-001/exceptions", undefined, {
      "x-tenant-id": "demo-industrial",
    });
    expect(evaluations.status).toBe(200);
    expect((evaluations.json as { evaluations: unknown[] }).evaluations).toHaveLength(0);
    expect(exceptions.status).toBe(200);
    expect((exceptions.json as { exceptions: unknown[] }).exceptions).toHaveLength(0);
  });

  it("hides another tenant's V2 context with a 404", async () => {
    const response = await call("GET", "/api/v2/contexts/ctx-so-demo-001/replay", undefined, {
      "x-tenant-id": "another-tenant",
    });
    expect(response.status).toBe(404);
    expect(response.json).toEqual({ error: "not_found" });
    for (const key of ["context", "entities", "entityReferences", "sourceSystems", "documents", "events", "evidence"]) {
      expect(response.json).not.toHaveProperty(key);
    }
  });

  it("returns deterministic V2 exception candidates from the replay facts", async () => {
    const run = await call("POST", "/api/v2/contexts/ctx-so-demo-001/evaluations/run", {}, { "x-tenant-id": "demo-industrial" });
    expect(run.status).toBe(200);
    const response = await call("GET", "/api/v2/contexts/ctx-so-demo-001/exceptions", undefined, {
      "x-tenant-id": "demo-industrial",
    });
    expect(response.status).toBe(200);
    const returnedExceptions = (response.json as { contextId: string; exceptions: Array<Record<string, unknown>> });
    expect(returnedExceptions.contextId).toBe("ctx-so-demo-001");
    expect(returnedExceptions.exceptions.map((item) => item.code)).toEqual(expect.arrayContaining([
      "SHIPMENT_QUANTITY_SHORTFALL",
      "PAYMENT_BALANCE_OUTSTANDING",
      "CUSTOMER_RECEIPT_CLAIM_MISMATCH",
    ]));
    const listItem = returnedExceptions.exceptions.find((item) => item.code === "SHIPMENT_QUANTITY_SHORTFALL")!;
    expect(listItem).toMatchObject({
      status: "detected",
      severity: "medium",
      metrics: { difference: 4 },
      evidenceBundleSummary: { evidenceCount: 2, sourceSystemCount: 2 },
    });
    expect(listItem).not.toHaveProperty("evidenceBundle");

    const bundle = await call("GET", `/api/v2/contexts/ctx-so-demo-001/exceptions/${String(listItem.id)}/bundle`, undefined, {
      "x-tenant-id": "demo-industrial",
    });
    expect(bundle.status).toBe(200);
    expect((bundle.json as { evidence: unknown[] }).evidence.length).toBeGreaterThanOrEqual(2);
  });

  it("returns persisted rule evaluations with observations and input hashes", async () => {
    const run = await call("POST", "/api/v2/contexts/ctx-so-demo-001/evaluations/run", {}, { "x-tenant-id": "demo-industrial" });
    expect(run.status).toBe(200);
    const response = await call("GET", "/api/v2/contexts/ctx-so-demo-001/rule-evaluations", undefined, {
      "x-tenant-id": "demo-industrial",
    });
    expect(response.status).toBe(200);
    const evaluations = (response.json as {
      evaluations: Array<{ status: string; inputHash: string; observations: Record<string, unknown> }>;
    }).evaluations;
    expect(evaluations).toHaveLength(4);
    expect(evaluations.filter((item) => item.status === "matched")).toHaveLength(3);
    expect(evaluations.filter((item) => item.status === "not_matched")).toHaveLength(1);
    expect(evaluations.every((item) => item.inputHash.length === 64)).toBe(true);
    expect(evaluations.every((item) => Object.keys(item.observations).length === 2)).toBe(true);
  });

  it("keeps POST evaluation idempotent and keeps GET evaluations read-only", async () => {
    const firstRun = await call("POST", "/api/v2/contexts/ctx-so-demo-001/evaluations/run", {}, { "x-tenant-id": "demo-industrial" });
    const secondRun = await call("POST", "/api/v2/contexts/ctx-so-demo-001/evaluations/run", {}, { "x-tenant-id": "demo-industrial" });
    expect(firstRun.status).toBe(200);
    expect(secondRun.status).toBe(200);
    const firstEvaluations = (firstRun.json as { evaluations: unknown[] }).evaluations.length;
    const secondEvaluations = (secondRun.json as { evaluations: unknown[] }).evaluations.length;
    expect(secondEvaluations).toBe(firstEvaluations);

    const before = await call("GET", "/api/v2/contexts/ctx-so-demo-001/rule-evaluations", undefined, { "x-tenant-id": "demo-industrial" });
    const beforeCount = (before.json as { evaluations: unknown[] }).evaluations.length;
    await call("GET", "/api/v2/contexts/ctx-so-demo-001/rule-evaluations", undefined, { "x-tenant-id": "demo-industrial" });
    const after = await call("GET", "/api/v2/contexts/ctx-so-demo-001/rule-evaluations", undefined, { "x-tenant-id": "demo-industrial" });
    expect((after.json as { evaluations: unknown[] }).evaluations.length).toBe(beforeCount);
  });

  it("rejects tenant supplied in the V2 evaluation request body", async () => {
    const response = await call("POST", "/api/v2/contexts/ctx-so-demo-001/evaluations/run", { tenantId: "another-tenant" }, {
      "x-tenant-id": "demo-industrial",
    });
    expect(response.status).toBe(400);
    expect(response.json).toEqual({ error: "tenant_from_auth_required" });
  });

  it("bridges one human-accepted V2 exception into a Resolution Case", async () => {
    await call("POST", "/api/v2/contexts/ctx-so-demo-001/evaluations/run", {}, { "x-tenant-id": "demo-industrial" });
    const exceptionsResponse = await call("GET", "/api/v2/contexts/ctx-so-demo-001/exceptions", undefined, { "x-tenant-id": "demo-industrial" });
    const exception = (exceptionsResponse.json as { exceptions: Array<{ id: string; code: string }> }).exceptions
      .find((item) => item.code === "CUSTOMER_RECEIPT_CLAIM_MISMATCH")!;

    const accepted = await call(
      "POST",
      `/api/v2/contexts/ctx-so-demo-001/exceptions/${exception.id}/resolution-case`,
      { ownerRole: "品质负责人", rationale: "确认进入人工处置" },
      { "x-tenant-id": "demo-industrial" },
    );
    expect(accepted.status).toBe(200);
    expect(accepted.json).toMatchObject({ status: "triaged", exceptionId: exception.id });
    const caseId = (accepted.json as { id: string }).id;
    heroResolutionCaseId = caseId;

    const duplicate = await call(
      "POST",
      `/api/v2/contexts/ctx-so-demo-001/exceptions/${exception.id}/resolution-case`,
      { ownerRole: "品质负责人", rationale: "重复提交" },
      { "x-tenant-id": "demo-industrial" },
    );
    expect(duplicate.status).toBe(409);
    expect(duplicate.json).toEqual({ error: "ACTION_NOT_APPLICABLE" });

    const confirmed = await call("POST", `/api/v2/resolution-cases/${caseId}/review`, {
      decision: "confirm",
      rationale: "证据足够，进入处置",
    }, { "x-tenant-id": "demo-industrial" });
    expect((confirmed.json as { status: string }).status).toBe("confirmed");

    const proposed = await call("POST", `/api/v2/resolution-cases/${caseId}/propose`, {
      actions: [{ type: "supplement_evidence", summary: "补齐物流签收、客户确认及客诉材料，核验客户主张与系统记录差异。" }],
    }, { "x-tenant-id": "demo-industrial" });
    expect((proposed.json as { status: string }).status).toBe("proposed");

    const submitted = await call("POST", `/api/v2/resolution-cases/${caseId}/submit`, {}, { "x-tenant-id": "demo-industrial" });
    expect((submitted.json as { runtime: { actions: Array<{ status: string }> } }).runtime.actions[0]?.status).toBe("pending_approval");

    const selfApproval = await call("POST", `/api/v2/resolution-cases/${caseId}/approve`, {}, { "x-tenant-id": "demo-industrial" });
    expect(selfApproval.status).toBe(409);
    expect(selfApproval.json).toEqual({ error: "SEGREGATION_OF_DUTIES_VIOLATION" });

    const approverHeaders = { "x-tenant-id": "demo-industrial", "x-actor": "general-manager" };
    const approved = await call("POST", `/api/v2/resolution-cases/${caseId}/approve`, {}, approverHeaders);
    expect((approved.json as { status: string }).status).toBe("approved");
    const executed = await call("POST", `/api/v2/resolution-cases/${caseId}/execute`, { idempotencyKey: "http-resolution-execute" }, approverHeaders);
    const executedAgain = await call("POST", `/api/v2/resolution-cases/${caseId}/execute`, { idempotencyKey: "http-resolution-execute" }, approverHeaders);
    expect((executed.json as { status: string }).status).toBe("executed");
    expect(executedAgain.status).toBe(409);
    expect(executedAgain.json).toEqual({ error: "ACTION_NOT_APPLICABLE" });

    const query = await call("GET", `/api/v2/resolution-cases/${caseId}`, undefined, { "x-tenant-id": "demo-industrial" });
    expect(query.status).toBe(200);
    expect(query.json).toMatchObject({
      sourceChanged: false,
      intakeEvaluationId: (accepted.json as { origin: { sourceRuleEvaluationId: string } }).origin.sourceRuleEvaluationId,
      receipts: [{ receiptSource: "local-ledger", operationKey: "http-resolution-execute" }],
    });

    const closed = await call("POST", `/api/v2/resolution-cases/${caseId}/close`, {}, approverHeaders);
    const closedAgain = await call("POST", `/api/v2/resolution-cases/${caseId}/close`, {}, approverHeaders);
    expect((closed.json as { status: string }).status).toBe("closed");
    expect(closedAgain.status).toBe(409);
    expect(closedAgain.json).toEqual({ error: "ACTION_NOT_APPLICABLE" });
    const audit = (closed.json as { runtime: { events: Array<{ actor?: string; at?: string; from?: string; to?: string; reason?: string }> } }).runtime.events;
    expect(audit.map((event) => event.reason)).toEqual([
      "v2_exception_intake",
      "接受异常进入处置",
      "确认异常进入处置",
      "提交处置方案",
      "草案提交审批",
      "批准",
      "外部能力回执已登记",
      "核验",
      "结案",
    ]);
    for (const event of audit) {
      expect(event.actor).toBeTruthy();
      expect(event.at).toBeTruthy();
      expect(event.reason).toBeTruthy();
    }

    const list = await call("GET", "/api/v2/contexts/ctx-so-demo-001/resolution-cases", undefined, { "x-tenant-id": "demo-industrial" });
    expect(list.status).toBe(200);
    expect(list.json).toMatchObject({
      contextId: "ctx-so-demo-001",
      resolutionCases: [{ id: caseId, exceptionId: exception.id, status: "closed" }],
    });
    expect((list.json as { resolutionCases: Array<Record<string, unknown>> }).resolutionCases[0]).not.toHaveProperty("receipts");

    const exceptionsAfter = await call("GET", "/api/v2/contexts/ctx-so-demo-001/exceptions", undefined, { "x-tenant-id": "demo-industrial" });
    const finalExceptions = (exceptionsAfter.json as { exceptions: Array<{ status: string }> }).exceptions;
    expect(finalExceptions).toHaveLength(3);
    expect(finalExceptions.every((item) => item.status === "detected")).toBe(true);
  });

  it("hides another tenant's V2 exception candidates with a 404", async () => {
    const response = await call("GET", "/api/v2/contexts/ctx-so-demo-001/exceptions", undefined, {
      "x-tenant-id": "another-tenant",
    });
    expect(response.status).toBe(404);
    expect(response.json).toEqual({ error: "not_found" });

    const list = await call("GET", "/api/v2/contexts/ctx-so-demo-001/resolution-cases", undefined, { "x-tenant-id": "another-tenant" });
    expect(list.status).toBe(404);
    expect(list.json).toEqual({ error: "not_found" });

    for (const [method, path] of [
      ["GET", `/api/v2/resolution-cases/${heroResolutionCaseId}`],
      ["POST", `/api/v2/resolution-cases/${heroResolutionCaseId}/approve`],
      ["POST", `/api/v2/resolution-cases/${heroResolutionCaseId}/execute`],
      ["POST", `/api/v2/resolution-cases/${heroResolutionCaseId}/close`],
    ] as const) {
      const hidden = await call(method, path, method === "POST" ? {} : undefined, { "x-tenant-id": "another-tenant" });
      expect(hidden.status).toBe(404);
      expect(hidden.json).toEqual({ error: "not_found" });
    }
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
