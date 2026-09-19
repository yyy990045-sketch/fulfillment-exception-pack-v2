import { createHmac } from "node:crypto";
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

const port = 35190 + (process.pid % 70);
const base = `http://127.0.0.1:${port}`;
const tenant = "demo-manufacturing";
const authSecret = "b".repeat(64);

let child: ChildProcess;
let storeDir: string;
let exceptionId = "";
let shipmentExceptionId = "";

async function call(
  method: string,
  path: string,
  body?: unknown,
  actor = "quality-owner",
  extraHeaders: Record<string, string> = {},
) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-tenant-id": tenant,
      "x-actor": actor,
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    json: (await response.json().catch(() => ({}))) as Record<string, any>,
  };
}

async function waitUntilHealthy() {
  for (let index = 0; index < 100; index += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {
      // not ready
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("resolution capabilities server did not become healthy");
}

function bearerToken(overrides: Record<string, unknown> = {}) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    sub: "bearer-user-1",
    tenant_id: tenant,
    roles: ["销售总监"],
    scopes: ["*"],
    name: "Bearer 张经理",
    organization_name: "示例集团",
    exp: Math.floor(Date.now() / 1000) + 300,
    ...overrides,
  });
  const signature = createHmac("sha256", authSecret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function capabilitiesPath() {
  return `/api/v2/contexts/ctx-so-mfg-001/exceptions/${encodeURIComponent(exceptionId)}/resolution-capabilities`;
}

async function getCapabilities(actor: string) {
  const response = await call("GET", capabilitiesPath(), undefined, actor);
  expect(response.status).toBe(200);
  return response.json;
}

beforeAll(async () => {
  storeDir = mkdtempSync(join(tmpdir(), "fep-resolution-capabilities-"));
  process.env.PACK_STORE_DIR = storeDir;
  process.env.PACK_STORE_DB = join(storeDir, "pack-cases.sqlite");
  provisionV2ManufacturingDemoData();
  const evaluated = evaluateContextRules(openV2SqliteStore(), tenant, "ctx-so-mfg-001")!;
  exceptionId = evaluated.exceptions.find((item) => item.code === "CUSTOMER_RECEIPT_CLAIM_MISMATCH")!.id;
  shipmentExceptionId = evaluated.exceptions.find((item) => item.code === "SHIPMENT_QUANTITY_SHORTFALL")!.id;
  child = spawn(join(process.cwd(), "node_modules", ".bin", "tsx"), ["src/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      NODE_ENV: "test",
      DEMO_MODE: "true",
      AUTH_SECRET: authSecret,
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

describe("Resolution capabilities HTTP projection", () => {
  it("projects backend-owned actor, owner roles, stage applicability, denial reasons, and SoD", async () => {
    const initial = await getCapabilities("quality-owner");
    expect(initial.currentActor).toMatchObject({
      tenantId: tenant,
      organization: "示例制造企业",
      user: "品质负责人",
      roles: ["品质负责人"],
      organizationSource: "demo",
      authnMethod: "demo-header",
    });
    expect(initial.assignableOwnerRoles).toEqual([
      "品质负责人",
      "销售总监",
      "工程师",
      "财务",
      "总经理",
      "管理员",
    ]);
    expect(initial.resolutionCapabilities.canAccept).toMatchObject({ applicable: true, allowed: true });
    expect(initial.resolutionCapabilities.canReview).toMatchObject({ applicable: false, allowed: false });

    const accepted = await call(
      "POST",
      `/api/v2/contexts/ctx-so-mfg-001/exceptions/${encodeURIComponent(exceptionId)}/resolution-case`,
      {
        ownerRole: "品质负责人",
        rationale: "进入人工核验。",
      },
      "quality-owner",
    );
    expect(accepted.status).toBe(200);
    const caseId = accepted.json.id as string;
    const afterAccept = await getCapabilities("quality-owner");
    expect(afterAccept.resolutionCapabilities.canAccept).toMatchObject({
      applicable: false,
      allowed: false,
      reasonCode: "ACTION_NOT_APPLICABLE",
    });
    const duplicateAccept = await call(
      "POST",
      `/api/v2/contexts/ctx-so-mfg-001/exceptions/${encodeURIComponent(exceptionId)}/resolution-case`,
      { ownerRole: "品质负责人", rationale: "重复受理。" },
      "quality-owner",
    );
    expect(duplicateAccept.status).toBe(409);
    expect(duplicateAccept.json.error).toBe("ACTION_NOT_APPLICABLE");

    const reviewed = await call("POST", `/api/v2/resolution-cases/${caseId}/review`, {
      decision: "confirm",
      rationale: "确认进入处置。",
    }, "engineer");
    expect(reviewed.status).toBe(200);
    const proposed = await call("POST", `/api/v2/resolution-cases/${caseId}/propose`, {
      actions: [{ type: "supplement_evidence", summary: "补充独立签收证据。" }],
    }, "engineer");
    expect(proposed.status).toBe(200);
    const submitted = await call("POST", `/api/v2/resolution-cases/${caseId}/submit`, {}, "engineer");
    expect(submitted.status).toBe(200);

    const viewerCapabilities = await getCapabilities("viewer");
    expect(viewerCapabilities.currentActor).toMatchObject({ user: "演示查看者", roles: ["viewer"] });
    expect(viewerCapabilities.resolutionCapabilities.canApprove).toMatchObject({
      applicable: true,
      allowed: false,
      reasonCode: "ROLE_NOT_ALLOWED",
    });
    const viewerApprove = await call("POST", `/api/v2/resolution-cases/${caseId}/approve`, {}, "viewer");
    expect(viewerApprove.status).toBe(403);
    expect(viewerApprove.json.error).toBe("read_only_principal");

    const selfApproval = await getCapabilities("engineer");
    expect(selfApproval.resolutionCapabilities.canApprove).toMatchObject({
      applicable: true,
      allowed: false,
      reasonCode: "SEGREGATION_OF_DUTIES_VIOLATION",
      reason: "方案提出人与审批人必须分离",
    });

    const nameOnlyApproverToken = bearerToken({ name: "总经理", roles: ["品质负责人"] });
    const nameOnlyCapabilities = await call("GET", capabilitiesPath(), undefined, "quality-owner", {
      authorization: `Bearer ${nameOnlyApproverToken}`,
    });
    expect(nameOnlyCapabilities.status).toBe(200);
    expect(nameOnlyCapabilities.json.resolutionCapabilities.canApprove).toMatchObject({
      applicable: true,
      allowed: false,
      reasonCode: "ROLE_NOT_ALLOWED",
    });
    const nameOnlyApprove = await call("POST", `/api/v2/resolution-cases/${caseId}/approve`, {}, "quality-owner", {
      authorization: `Bearer ${nameOnlyApproverToken}`,
    });
    expect(nameOnlyApprove.status).toBe(403);
    expect(nameOnlyApprove.json.error).toBe("ROLE_NOT_ALLOWED");

    const approverToken = bearerToken({ sub: "bearer-manager", name: "Bearer 总经理", roles: ["总经理"] });
    const approver = await call("GET", capabilitiesPath(), undefined, "quality-owner", {
      authorization: `Bearer ${approverToken}`,
    });
    expect(approver.status).toBe(200);
    expect(approver.json.resolutionCapabilities.canApprove).toMatchObject({ applicable: true, allowed: true });
    expect(approver.json.currentActor).toMatchObject({
      organization: "示例集团",
      organizationSource: "claim",
      roles: ["总经理"],
    });
    const approved = await call("POST", `/api/v2/resolution-cases/${caseId}/approve`, {}, "quality-owner", {
      authorization: `Bearer ${approverToken}`,
    });
    expect(approved.status).toBe(200);
    expect(approved.json.status).toBe("approved");

    const viewerExecuteCapabilities = await getCapabilities("viewer");
    expect(viewerExecuteCapabilities.resolutionCapabilities.canExecute).toMatchObject({
      applicable: true,
      allowed: false,
      reasonCode: "ROLE_NOT_ALLOWED",
    });
    const viewerExecute = await call("POST", `/api/v2/resolution-cases/${caseId}/execute`, {}, "viewer");
    expect(viewerExecute.status).toBe(403);
    expect(viewerExecute.json.error).toBe("read_only_principal");

    const unauthorizedExecution = await getCapabilities("quality-owner");
    expect(unauthorizedExecution.resolutionCapabilities.canExecute).toMatchObject({
      applicable: true,
      allowed: false,
      reasonCode: "ROLE_NOT_ALLOWED",
    });
    const executor = await getCapabilities("sales-director");
    expect(executor.resolutionCapabilities.canExecute).toMatchObject({ applicable: true, allowed: true });
    const executed = await call("POST", `/api/v2/resolution-cases/${caseId}/execute`, {}, "sales-director");
    expect(executed.status).toBe(200);
    expect(executed.json.status).toBe("executed");

    const viewerCloseCapabilities = await getCapabilities("viewer");
    expect(viewerCloseCapabilities.resolutionCapabilities.canClose).toMatchObject({
      applicable: true,
      allowed: false,
      reasonCode: "ROLE_NOT_ALLOWED",
    });
    const viewerClose = await call("POST", `/api/v2/resolution-cases/${caseId}/close`, {}, "viewer");
    expect(viewerClose.status).toBe(403);
    expect(viewerClose.json.error).toBe("read_only_principal");

    const unauthorizedClose = await getCapabilities("quality-owner");
    expect(unauthorizedClose.resolutionCapabilities.canClose).toMatchObject({
      applicable: true,
      allowed: false,
      reasonCode: "ROLE_NOT_ALLOWED",
    });
    const closer = await getCapabilities("sales-director");
    expect(closer.resolutionCapabilities.canClose).toMatchObject({ applicable: true, allowed: true });
    const closed = await call("POST", `/api/v2/resolution-cases/${caseId}/close`, {}, "sales-director");
    expect(closed.status).toBe(200);
    expect(closed.json.status).toBe("closed");
  });

  it("rejects owner roles that are not in the backend assignable role source", async () => {
    const response = await call(
      "POST",
      `/api/v2/contexts/ctx-so-mfg-001/exceptions/${encodeURIComponent(shipmentExceptionId)}/resolution-case`,
      { ownerRole: "任意角色", rationale: "非法负责人角色测试。" },
      "quality-owner",
    );
    expect(response.status).toBe(422);
    expect(response.json.error).toBe("resolution_owner_role_not_assignable");
  });

  it("returns actor and role changes from the backend when the demo actor changes", async () => {
    const quality = await getCapabilities("quality-owner");
    const sales = await getCapabilities("sales-director");
    expect(quality.currentActor).toMatchObject({ user: "品质负责人", roles: ["品质负责人"] });
    expect(sales.currentActor).toMatchObject({ user: "销售总监", roles: ["销售总监"] });
  });

  it("projects Bearer organization, user, and roles from authenticated claims", async () => {
    const response = await call("GET", "/api/v2/auth/context", undefined, "quality-owner", {
      authorization: `Bearer ${bearerToken()}`,
    });
    expect(response.status).toBe(200);
    expect(response.json.currentActor).toMatchObject({
      tenantId: tenant,
      organization: "示例集团",
      organizationSource: "claim",
      user: "Bearer 张经理",
      subjectId: "bearer-user-1",
      roles: ["销售总监"],
      authnMethod: "jwt-hs256",
    });
  });

  it("marks tenant organization as a fallback when no organization claim exists", async () => {
    const token = bearerToken({ organization_name: undefined, org_name: undefined });
    const response = await call("GET", "/api/v2/auth/context", undefined, "quality-owner", {
      authorization: `Bearer ${token}`,
    });
    expect(response.status).toBe(200);
    expect(response.json.currentActor).toMatchObject({
      organization: tenant,
      organizationSource: "tenant_fallback",
    });
  });
});
