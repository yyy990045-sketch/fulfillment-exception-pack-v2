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
  type V2SqliteStore,
} from "../src/domain/v2/index.js";
import { bindPackContext, manufacturingFulfillmentPack, registerBuiltInSolutionPacks } from "../src/solution-packs/index.js";

const authSecret = "security-seal-test-secret-0123456789";
const port = 36310 + (process.pid % 60);
const base = `http://127.0.0.1:${port}`;
const tenantA = "demo-manufacturing";
const tenantB = "tenant-b";
const CONTROL_CONTEXT = "ctx-so-mfg-001";

let child: ChildProcess;
let storeDir: string;
let aExceptionId = "";
let bContextId = "";
let bExceptionId = "";
let bResolutionId = "";

function token(input: {
  tenantId: string;
  subjectId: string;
  roles: string[];
  scopes?: string[];
}) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    sub: input.subjectId,
    tenant_id: input.tenantId,
    roles: input.roles,
    ...(input.scopes ? { scopes: input.scopes } : {}),
    exp: Math.floor(Date.now() / 1000) + 600,
  });
  const signature = createHmac("sha256", authSecret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

async function call(method: string, path: string, bearer: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${bearer}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json().catch(() => ({}))) as Record<string, any> };
}

async function waitUntilHealthy() {
  for (let index = 0; index < 120; index += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch { /* not ready */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("security seal server did not become healthy");
}

/** 把 demo-manufacturing 的真实上下文复制成 tenant-b 的资源（真实行，不是 mock） */
function cloneContextInto(store: V2SqliteStore, targetTenant: string, targetContextId: string, businessKey: string) {
  const replay = store.replayContext(tenantA, CONTROL_CONTEXT);
  if (!replay.context) throw new Error("control context missing");
  store.saveContext({ ...replay.context, tenantId: targetTenant, id: targetContextId, businessKey });
  for (const item of replay.sourceSystems) store.saveSourceSystem({ ...item, tenantId: targetTenant });
  for (const item of replay.entities) store.saveBusinessEntity({ ...item, tenantId: targetTenant, contextId: targetContextId });
  for (const item of replay.entityReferences) store.saveEntityReference({ ...item, tenantId: targetTenant });
  for (const item of replay.documents) store.saveSourceDocument({ ...item, tenantId: targetTenant, contextId: targetContextId });
  for (const item of replay.events) store.appendEvent({ ...item, tenantId: targetTenant, contextId: targetContextId });
  for (const item of replay.evidence) store.saveEvidence({ ...item, tenantId: targetTenant, contextId: targetContextId });
  registerBuiltInSolutionPacks();
  manufacturingFulfillmentPack.install(store, targetTenant, "security-seal-test");
  bindPackContext(store, manufacturingFulfillmentPack, targetTenant, targetContextId, "security-seal-test");
  const evaluated = evaluateContextRules(store, targetTenant, targetContextId);
  if (!evaluated?.exceptions.length) throw new Error("tenant-b exception was not created");
  return evaluated.exceptions[0]!.id;
}

const approverX = () => token({ tenantId: tenantB, subjectId: "user-x", roles: ["品质负责人", "管理员"] });
const approverY = () => token({ tenantId: tenantB, subjectId: "user-y", roles: ["管理员"] });
const viewerB = () => token({ tenantId: tenantB, subjectId: "viewer-b", roles: ["viewer"] });
const viewerA = () => token({ tenantId: tenantA, subjectId: "viewer-a", roles: ["viewer"] });
const adminB = () => token({ tenantId: tenantB, subjectId: "admin-b", roles: ["管理员"] });
const adminA = () => token({ tenantId: tenantA, subjectId: "admin-a", roles: ["管理员"] });

beforeAll(async () => {
  storeDir = mkdtempSync(join(tmpdir(), "fep-security-seal-"));
  process.env.PACK_STORE_DIR = storeDir;
  process.env.PACK_STORE_DB = join(storeDir, "pack-cases.sqlite");
  provisionV2ManufacturingDemoData();
  const store = openV2SqliteStore();
  const evaluatedA = evaluateContextRules(store, tenantA, CONTROL_CONTEXT);
  aExceptionId = evaluatedA!.exceptions.find((item) => item.code === "CUSTOMER_RECEIPT_CLAIM_MISMATCH")!.id;
  bContextId = "ctx-tenant-b-001";
  bExceptionId = cloneContextInto(store, tenantB, bContextId, "SO-TB-001");

  child = spawn(join(process.cwd(), "node_modules", ".bin", "tsx"), ["src/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      NODE_ENV: "test",
      DEMO_MODE: "false",
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

describe("identity capability endpoint", () => {
  it("returns identity, canonical roles, scopes and capabilities without leaking secrets", async () => {
    const response = await call("GET", "/api/v2/auth/me", approverX());
    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({
      subjectId: "user-x",
      tenantId: tenantB,
      roles: ["品质负责人", "管理员"],
      canonicalRoles: ["operator", "admin"],
    });
    expect(response.json.capabilities).toMatchObject({
      actorType: "user",
      canReadEvidence: true,
      canSubmit: true,
      canApprove: true,
      canExecute: true,
      demoOnlySuperuser: false,
    });
    const serialized = JSON.stringify(response.json);
    expect(serialized).not.toContain(authSecret);
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("authorization");
  });

  it("projects a viewer as read-only and an admin as configuration-capable", async () => {
    const viewer = await call("GET", "/api/v2/auth/me", viewerB());
    expect(viewer.json.capabilities).toMatchObject({
      canonicalRoles: ["viewer"],
      canSubmit: false,
      canApprove: false,
      canExecute: false,
      canManageConnectors: false,
    });
    const admin = await call("GET", "/api/v2/auth/me", adminB());
    expect(admin.json.capabilities).toMatchObject({
      canonicalRoles: ["admin"],
      canManageConnectors: true,
      canManageSolutionPacks: true,
      canManageTenant: true,
    });
  });
});

describe("tenant-b governance flow (same entrypoint as production)", () => {
  it("lets the owning tenant run accept → review → propose → submit", async () => {
    const accepted = await call(
      "POST",
      `/api/v2/contexts/${bContextId}/exceptions/${bExceptionId}/resolution-case`,
      approverX(),
      { ownerRole: "品质负责人", rationale: "客户收货主张与发货记录存在差异，进入人工核验。" },
    );
    expect(accepted.status).toBe(200);
    bResolutionId = accepted.json.id;
    expect(bResolutionId).toBeTruthy();

    const reviewed = await call("POST", `/api/v2/resolution-cases/${bResolutionId}/review`, approverX(), {
      decision: "confirm",
      rationale: "已确认差异，继续处置。",
    });
    expect(reviewed.status).toBe(200);

    const proposed = await call("POST", `/api/v2/resolution-cases/${bResolutionId}/propose`, approverX(), {
      actions: [{ type: "supplement_evidence", summary: "补充物流签收单或客户确认记录。" }],
    });
    expect(proposed.status).toBe(200);

    const submitted = await call("POST", `/api/v2/resolution-cases/${bResolutionId}/submit`, approverX());
    expect(submitted.status).toBe(200);
  });

  it("enforces segregation of duties in the backend (submitter cannot approve)", async () => {
    const sameSubject = await call("POST", `/api/v2/resolution-cases/${bResolutionId}/approve`, approverX());
    expect(sameSubject.status).toBe(409);
    expect(sameSubject.json).toEqual({ error: "SEGREGATION_OF_DUTIES_VIOLATION" });

    const otherApprover = await call("POST", `/api/v2/resolution-cases/${bResolutionId}/approve`, approverY());
    expect(otherApprover.status).toBe(200);
    expect(otherApprover.json.status).toBe("approved");

    const executed = await call("POST", `/api/v2/resolution-cases/${bResolutionId}/execute`, approverY());
    expect(executed.status).toBe(200);
  });

  it("writes audit records for the sensitive governance mutations", async () => {
    const store = openV2SqliteStore();
    const events = store.listSecurityAuditEvents(tenantB);
    const actions = events.map((item) => item.action);
    expect(actions).toContain("resolution.accept");
    expect(actions).toContain("resolution.submit");
    expect(actions).toContain("resolution.approve");
    expect(actions).toContain("resolution.execute");
    const approve = events.find((item) => item.action === "resolution.approve")!;
    expect(approve).toMatchObject({
      tenantId: tenantB,
      actorType: "user",
      subjectId: "user-y",
      resourceType: "resolution_case",
      resourceId: bResolutionId,
      result: "success",
    });
    expect(approve.roles).toEqual(["管理员"]);
    expect(JSON.stringify(events)).not.toContain(authSecret);
    expect(JSON.stringify(events)).not.toContain("Bearer");
    // 审计按租户隔离
    const otherTenant = store.listSecurityAuditEvents(tenantA);
    expect(otherTenant.some((item) => item.action.startsWith("resolution."))).toBe(false);
  });
});

describe("scope enforcement", () => {
  it("rejects a valid token that declares the wrong scope", async () => {
    const narrow = token({ tenantId: tenantA, subjectId: "u-narrow", roles: ["viewer"], scopes: ["analytics:read"] });
    const response = await call("GET", `/api/v2/contexts/${CONTROL_CONTEXT}/exceptions`, narrow);
    expect(response.status).toBe(403);
    expect(response.json).toEqual({ error: "scope_forbidden" });
  });

  it("rejects a viewer mutation before touching the domain", async () => {
    const response = await call("POST", `/api/v2/contexts/${bContextId}/exceptions/${bExceptionId}/resolution-case`, viewerB(), {
      ownerRole: "品质负责人",
      rationale: "viewer 不应能受理异常",
    });
    expect(response.status).toBe(403);
    expect(response.json).toEqual({ error: "scope_forbidden" });
  });

  it("rejects an operator approving but allows an approver", async () => {
    const operator = token({ tenantId: tenantB, subjectId: "operator-b", roles: ["品质负责人"] });
    const approved = await call("POST", `/api/v2/resolution-cases/${bResolutionId}/approve`, operator);
    expect(approved.status).toBe(403);
    expect(approved.json).toEqual({ error: "scope_forbidden" });
  });
});

describe("tenant isolation (cross-tenant reads return 404)", () => {
  it("hides another tenant's context, exceptions, evidence bundle and resolution case", async () => {
    const context = await call("GET", `/api/v2/contexts/${CONTROL_CONTEXT}/replay`, adminB());
    expect(context.status).toBe(404);
    expect(context.json).toEqual({ error: "not_found" });

    const exceptions = await call("GET", `/api/v2/contexts/${CONTROL_CONTEXT}/exceptions`, viewerB());
    expect(exceptions.status).toBe(404);

    const bundle = await call("GET", `/api/v2/contexts/${CONTROL_CONTEXT}/exceptions/${aExceptionId}/bundle`, viewerB());
    expect(bundle.status).toBe(404);

    const resolution = await call("GET", `/api/v2/resolution-cases/${bResolutionId}`, viewerA());
    expect(resolution.status).toBe(404);
  });

  it("does not let even an admin cross the tenant boundary", async () => {
    const response = await call("GET", `/api/v2/contexts/${CONTROL_CONTEXT}/workbench`, adminB());
    expect(response.status).toBe(404);
  });

  it("keeps the owning tenant working", async () => {
    const own = await call("GET", `/api/v2/contexts/${bContextId}/exceptions`, viewerB());
    expect(own.status).toBe(200);
    expect(own.json.exceptions.length).toBeGreaterThan(0);
    const control = await call("GET", `/api/v2/contexts/${CONTROL_CONTEXT}/exceptions`, viewerA());
    expect(control.status).toBe(200);
  });

  it("blocks cross-tenant mutations", async () => {
    const accept = await call("POST", `/api/v2/contexts/${CONTROL_CONTEXT}/exceptions/${aExceptionId}/resolution-case`, adminB(), {
      ownerRole: "品质负责人",
      rationale: "跨租户受理必须被拒绝",
    });
    expect(accept.status).toBe(404);
    const approve = await call("POST", `/api/v2/resolution-cases/${bResolutionId}/approve`, adminA());
    expect(approve.status).toBe(404);
  });
});
