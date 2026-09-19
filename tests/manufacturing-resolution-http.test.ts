import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  evaluateContextRules,
  openV2SqliteStore,
  provisionV2ManufacturingDemoData,
} from "../src/domain/v2/index.js";

const port = 34990 + (process.pid % 80);
const base = `http://127.0.0.1:${port}`;
const tenant = "demo-manufacturing";

let child: ChildProcess;
let storeDir: string;
let exceptions: Record<string, string> = {};

async function call(method: string, path: string, body?: unknown, actor?: string, requestTenant = tenant) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-tenant-id": requestTenant,
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
  throw new Error("resolution workbench server did not become healthy");
}

async function accept(exceptionId: string, actor = "sales-director") {
  return call("POST", `/api/v2/contexts/ctx-so-mfg-001/exceptions/${encodeURIComponent(exceptionId)}/resolution-case`, {
    ownerRole: "品质负责人",
    rationale: "客户收货主张与发货记录存在差异，需要进入人工核验。",
  }, actor);
}

async function confirmAndPropose(caseId: string, actor = "quality-owner") {
  const reviewed = await call("POST", `/api/v2/resolution-cases/${encodeURIComponent(caseId)}/review`, {
    decision: "confirm",
    rationale: "已确认记录差异，需要继续处置。",
  }, actor);
  expect(reviewed.status).toBe(200);
  const proposed = await call("POST", `/api/v2/resolution-cases/${encodeURIComponent(caseId)}/propose`, {
    actions: [{ type: "supplement_evidence", summary: "补充核对物流签收单、POD 或客户确认记录。" }],
  }, actor);
  expect(proposed.status).toBe(200);
  return proposed;
}

beforeAll(async () => {
  storeDir = mkdtempSync(join(tmpdir(), "fep-resolution-http-"));
  process.env.PACK_STORE_DIR = storeDir;
  process.env.PACK_STORE_DB = join(storeDir, "pack-cases.sqlite");
  provisionV2ManufacturingDemoData();
  const evaluated = evaluateContextRules(openV2SqliteStore(), tenant, "ctx-so-mfg-001")!;
  exceptions = Object.fromEntries(evaluated.exceptions.map((item) => [item.code, item.id]));
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

describe("manufacturing resolution governance HTTP", () => {
  it("runs the full Customer Claim lifecycle through HTTP and preserves the source Exception", async () => {
    const accepted = await accept(exceptions.CUSTOMER_RECEIPT_CLAIM_MISMATCH!);
    expect(accepted.status).toBe(200);
    expect(accepted.json.status).toBe("triaged");
    const caseId = accepted.json.id as string;

    const proposed = await confirmAndPropose(caseId);
    const submitted = await call("POST", `/api/v2/resolution-cases/${caseId}/submit`, {}, "quality-owner");
    expect(submitted.status).toBe(200);
    expect(submitted.json.runtime.actions[0].status).toBe("pending_approval");

    const approved = await call("POST", `/api/v2/resolution-cases/${caseId}/approve`, {}, "general-manager");
    expect(approved.status).toBe(200);
    expect(approved.json.status).toBe("approved");

    const executed = await call("POST", `/api/v2/resolution-cases/${caseId}/execute`, {}, "sales-director");
    const executedAgain = await call("POST", `/api/v2/resolution-cases/${caseId}/execute`, {}, "sales-director");
    expect(executed.status).toBe(200);
    expect(executedAgain.status).toBe(200);
    expect(executed.json.status).toBe("executed");
    expect(executedAgain.json.runtime.actions[0].receipt).toBe(executed.json.runtime.actions[0].receipt);
    expect(executedAgain.json.runtime.actions[0].externalRequestId).toBe(executed.json.runtime.actions[0].externalRequestId);
    expect(executedAgain.json.runtime.actions[0].receiptAt).toBe(executed.json.runtime.actions[0].receiptAt);

    const receiptsBeforeClose = await call("GET", `/api/v2/resolution-cases/${caseId}`);
    expect(receiptsBeforeClose.json.receipts).toHaveLength(1);
    const closed = await call("POST", `/api/v2/resolution-cases/${caseId}/close`, {}, "sales-director");
    expect(closed.status).toBe(200);
    expect(closed.json.status).toBe("closed");
    expect(closed.json.runtime.actions[0].status).toBe("verified");

    const query = await call("GET", `/api/v2/resolution-cases/${caseId}`);
    expect(query.json.resolutionCase.status).toBe("closed");
    expect(query.json.sourceException.status).toBe("detected");
    expect(query.json.receipts).toHaveLength(1);

    const workbench = await call("GET", "/api/v2/contexts/ctx-so-mfg-001/workbench");
    expect(workbench.status).toBe(200);
    expect(workbench.json.exceptions).toHaveLength(4);
    expect(workbench.json.exceptions.some((item: any) => item.code === "CUSTOMER_RECEIPT_CLAIM_MISMATCH")).toBe(true);
    expect(workbench.json.resolutionCases.some((item: any) => item.id === caseId && item.status === "closed")).toBe(true);
  });

  it("enforces segregation of duties in HTTP and allows an independent approver", async () => {
    const accepted = await accept(exceptions.SHIPMENT_QUANTITY_SHORTFALL!);
    const caseId = accepted.json.id as string;
    await confirmAndPropose(caseId, "engineer");
    const submitted = await call("POST", `/api/v2/resolution-cases/${caseId}/submit`, {}, "engineer");
    expect(submitted.status).toBe(200);

    const selfApproval = await call("POST", `/api/v2/resolution-cases/${caseId}/approve`, {}, "engineer");
    expect(selfApproval.status).toBe(409);
    expect(selfApproval.json.error).toBe("SEGREGATION_OF_DUTIES_VIOLATION");

    const independent = await call("POST", `/api/v2/resolution-cases/${caseId}/approve`, {}, "general-manager");
    expect(independent.status).toBe(200);
    expect(independent.json.status).toBe("approved");
  });

  it("enforces approval role, actor source, and tenant isolation", async () => {
    const accepted = await accept(exceptions.PAYMENT_BALANCE_OUTSTANDING!);
    const caseId = accepted.json.id as string;
    await confirmAndPropose(caseId, "engineer");
    await call("POST", `/api/v2/resolution-cases/${caseId}/submit`, {}, "engineer");

    const roleForbidden = await call("POST", `/api/v2/resolution-cases/${caseId}/approve`, {}, "quality-owner");
    expect(roleForbidden.status).toBe(403);
    expect(roleForbidden.json.error).toBe("ROLE_NOT_ALLOWED");

    const actorInjection = await call("POST", `/api/v2/resolution-cases/${caseId}/approve`, {
      actor: "总经理",
      roles: ["总经理"],
    }, "quality-owner");
    expect(actorInjection.status).toBe(400);
    expect(actorInjection.json.error).toBe("actor_and_roles_from_auth_required");

    const crossTenant = await call("POST", `/api/v2/resolution-cases/${caseId}/approve`, {}, "general-manager", "another-tenant");
    expect(crossTenant.status).toBe(404);
    expect(crossTenant.json.error).toBe("not_found");
  });

  it("rejects illegal lifecycle transitions through HTTP", async () => {
    const accepted = await accept(exceptions.QUALITY_NONCONFORMING_QUANTITY_DETECTED!);
    const caseId = accepted.json.id as string;

    const proposeEarly = await call("POST", `/api/v2/resolution-cases/${caseId}/propose`, {
      actions: [{ type: "supplement_evidence", summary: "过早方案" }],
    }, "quality-owner");
    expect(proposeEarly.status).toBe(409);
    expect(proposeEarly.json.error).toBe("resolution_proposal_not_allowed");

    await call("POST", `/api/v2/resolution-cases/${caseId}/review`, {
      decision: "confirm",
      rationale: "确认进入处置",
    }, "quality-owner");
    const approveBeforeProposal = await call("POST", `/api/v2/resolution-cases/${caseId}/approve`, {}, "general-manager");
    expect(approveBeforeProposal.status).toBe(409);
    expect(approveBeforeProposal.json.error).toBe("resolution_approval_not_allowed");

    await call("POST", `/api/v2/resolution-cases/${caseId}/propose`, {
      actions: [{ type: "supplement_evidence", summary: "补充 QC 核验记录" }],
    }, "quality-owner");
    const approveDraft = await call("POST", `/api/v2/resolution-cases/${caseId}/approve`, {}, "general-manager");
    expect(approveDraft.status).toBe(409);
    expect(approveDraft.json.error).toBe("resolution_approval_not_submitted");

    await call("POST", `/api/v2/resolution-cases/${caseId}/submit`, {}, "quality-owner");
    const executePending = await call("POST", `/api/v2/resolution-cases/${caseId}/execute`, {}, "sales-director");
    expect(executePending.status).toBe(409);
    expect(executePending.json.error).toBe("resolution_execution_not_allowed");

    await call("POST", `/api/v2/resolution-cases/${caseId}/approve`, {}, "general-manager");
    const closeApproved = await call("POST", `/api/v2/resolution-cases/${caseId}/close`, {}, "sales-director");
    expect(closeApproved.status).toBe(409);
    expect(closeApproved.json.error).toBe("resolution_close_not_allowed");

    await call("POST", `/api/v2/resolution-cases/${caseId}/execute`, {}, "sales-director");
    await call("POST", `/api/v2/resolution-cases/${caseId}/close`, {}, "sales-director");
    const executeClosed = await call("POST", `/api/v2/resolution-cases/${caseId}/execute`, {}, "sales-director");
    expect(executeClosed.status).toBe(409);
    expect(executeClosed.json.error).toBe("resolution_execution_not_allowed");
  });
});
