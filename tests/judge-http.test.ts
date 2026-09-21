import { spawn, type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runJudgeDemo, type JudgeDemoResult } from "../src/demo/judge/runner.js";
import { openExistingJudgeStore } from "../src/demo/judge/workspace.js";
import { evaluateTraceabilityGate } from "../src/traceability/index.js";
import {
  acceptExceptionForResolution,
  approveResolutionCase,
  proposeResolutionCase,
  reviewResolution,
  submitResolutionCase,
} from "../src/domain/v2/index.js";

const port = 34990 + (process.pid % 100);
const base = `http://127.0.0.1:${port}`;
const headers = { accept: "application/json", "x-tenant-id": "demo-manufacturing", "x-actor": "general-manager" };
const WORKSPACE = resolve(".preview/judge-http-test");

let child: ChildProcess;
let goodRun: JudgeDemoResult;
let brokenRun: JudgeDemoResult;

async function call(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const response = await fetch(`${base}${path}`, {
    method: init.method ?? "GET",
    headers: { ...headers, ...(init.body === undefined ? {} : { "content-type": "application/json" }), ...(init.headers ?? {}) },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  return { status: response.status, body: await response.json().catch(() => null) as Record<string, unknown> | null };
}

async function waitUntilHealthy() {
  for (let index = 0; index < 160; index += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch { /* not ready */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error("judge demo server did not become healthy");
}

/** 必须等端口真正释放再重启，否则新进程 EADDRINUSE、旧进程继续服务旧库。 */
async function stopServer(instance: ChildProcess) {
  if (instance.exitCode !== null) return;
  await new Promise<void>((resolveStop) => {
    instance.once("exit", () => resolveStop());
    instance.kill("SIGTERM");
  });
}

async function startServer(workspaceDir: string) {
  const instance = spawn(resolve("node_modules/.bin/tsx"), ["src/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      NODE_ENV: "test",
      DEMO_MODE: "true",
      PACK_STORE_BACKEND: "json",
      PACK_STORE_DIR: workspaceDir,
      PACK_STORE_DB: resolve(workspaceDir, "pack-cases.sqlite"),
      JUDGE_UNS_STREAM: resolve(workspaceDir, "uns-stream.jsonl"),
    },
    stdio: "ignore",
  });
  await waitUntilHealthy();
  return instance;
}

const ENGINEER = { subjectId: "judge-engineer-1042", displayName: "工程师", roles: ["工程师"] };
const APPROVER = { subjectId: "judge-gm-9001", displayName: "总经理", roles: ["总经理"] };

/** 绕过 HTTP 直接在领域层批准：用于证明执行侧闸门是独立的第二道防线。 */
function approveCaseDirectly(caseId: string) {
  const handle = openExistingJudgeStore(resolve(WORKSPACE, "pack-cases.sqlite"));
  try {
    const approved = approveResolutionCase(handle.store, "demo-manufacturing", caseId, APPROVER)!;
    expect(approved.status).toBe("approved");
  } finally {
    handle.close();
  }
}

/**
 * 用领域 API 把 resolution case 推进到 proposed（人受理 → 人复核 → 人提交）。
 * 这样 approve 阶段唯一会失败的原因就是回源闸门本身，而不是流程状态。
 */
function prepareProposedCase(contextId: string, options: { reuseExisting?: boolean } = {}) {
  const handle = openExistingJudgeStore(resolve(WORKSPACE, "pack-cases.sqlite"));
  try {
    const store = handle.store;
    const exception = store.listExceptions("demo-manufacturing", contextId)[0]!;
    const existing = store.getResolutionCaseByException("demo-manufacturing", exception.id);
    if (existing && options.reuseExisting) {
      return { exceptionId: exception.id, caseId: existing.id, status: existing.status };
    }
    const accepted = acceptExceptionForResolution(store, "demo-manufacturing", contextId, exception.id, {
      ownerRole: "品质负责人",
      rationale: "确认进入处置",
      actor: ENGINEER,
    });
    reviewResolution(store, "demo-manufacturing", accepted.id, {
      decision: "confirm", rationale: "确认异常", actor: ENGINEER,
    });
    const proposed = proposeResolutionCase(store, "demo-manufacturing", accepted.id, {
      actor: ENGINEER,
      actions: [{ type: "create_task", summary: "创建补投产任务" }],
    })!;
    const submitted = submitResolutionCase(store, "demo-manufacturing", proposed.id, ENGINEER)!;
    return { exceptionId: exception.id, caseId: submitted.id, status: submitted.status };
  } finally {
    handle.close();
  }
}

beforeAll(async () => {
  // 主场景：链路完整
  goodRun = await runJudgeDemo({ workspace: WORKSPACE, aiProvider: "none" });
  child = await startServer(WORKSPACE);
}, 120_000);

afterAll(async () => {
  await stopServer(child);
  rmSync(WORKSPACE, { recursive: true, force: true });
});

describe("评委视图 HTTP 接口", () => {
  it("返回只读 judge manifest，且与 demo:judge 写出的 evidence.json 同源", async () => {
    const response = await call(`/api/v2/demo/judge/manifest?contextId=${encodeURIComponent(goodRun.contextId)}`);
    expect(response.status).toBe(200);
    const body = response.body!;
    expect(body.schemaVersion).toBe("judge-evidence-manifest/v1");
    expect(body.scenario).toBe("production-shortfall");
    expect(body.businessFacts).toEqual({ orderedQuantity: 100, productionCompletedQuantity: 96, difference: 4, unit: "pcs" });
    const sources = body.sources as { order: { systemKey: string }; production: { systemKey: string } };
    expect(sources.order.systemKey).toBe("ERP-DEMO");
    expect(sources.production.systemKey).toBe("MES-DEMO");
    expect((body.exception as { code: string }).code).toBe("ORDER_PRODUCTION_COMPLETION_SHORTFALL");
    expect((body.trace as { status: string }).status).toBe("EVIDENCE_TRACE_VERIFIED");
    expect((body.truthBoundary as Record<string, boolean>).realFactoryVerified).toBe(false);
    expect((body.ai as { canApprove: boolean }).canApprove).toBe(false);
  });

  it("不给 contextId 时自动挑带主场景异常的 Context（纯只读）", async () => {
    const response = await call("/api/v2/demo/judge/manifest");
    expect(response.status).toBe(200);
    expect((response.body!.exception as { code: string }).code).toBe("ORDER_PRODUCTION_COMPLETION_SHORTFALL");
  });

  it("不存在的 Context 返回 404，不编造 manifest", async () => {
    const response = await call("/api/v2/demo/judge/manifest?contextId=ctx-nope");
    expect(response.status).toBe(404);
  });

  it("manifest 不泄露技术元数据到第一层：明面上只有业务字段", async () => {
    const response = await call(`/api/v2/demo/judge/manifest?contextId=${encodeURIComponent(goodRun.contextId)}`);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("token");
  });
});

describe("回源闸门在 HTTP 审批/执行路径上真实生效", () => {
  it("证据可回源时闸门放行：HTTP 上的失败来自流程状态，而不是回源闸门", async () => {
    const handle = openExistingJudgeStore(resolve(WORKSPACE, "pack-cases.sqlite"));
    let approvalAllowed = false;
    try {
      const exception = handle.store.listExceptions("demo-manufacturing", goodRun.contextId)[0]!;
      const gate = evaluateTraceabilityGate({
        store: handle.store,
        tenantId: "demo-manufacturing",
        contextId: goodRun.contextId,
        exceptionId: exception.id,
        payloadSourcePath: resolve(WORKSPACE, "uns-stream.jsonl"),
        stage: "approval",
      });
      approvalAllowed = gate.decision.allowed;
    } finally {
      handle.close();
    }
    expect(approvalAllowed).toBe(true);

    const { caseId } = prepareProposedCase(goodRun.contextId, { reuseExisting: true });
    const response = await call(`/api/v2/resolution-cases/${encodeURIComponent(caseId)}/approve`, { method: "POST", body: {} });
    expect(response.body?.error).not.toBe("EVIDENCE_NOT_VERIFIABLE");
    expect(response.body?.error).not.toBe("EVIDENCE_NOT_CONNECTOR_BACKED");
  });

  it("证据无法回源时，审批与执行都返回 409 EVIDENCE_NOT_VERIFIABLE", async () => {
    await stopServer(child);
    brokenRun = await runJudgeDemo({ scenario: "evidence-broken", workspace: WORKSPACE, aiProvider: "none" });
    child = await startServer(WORKSPACE);

    // 备用场景下治理被闸门挡住，因此没有 resolution case；这里先人工补到 proposed 再验证闸门
    const { caseId } = prepareProposedCase(brokenRun.contextId);

    // 审批被闸门拦下
    const approveResponse = await call(`/api/v2/resolution-cases/${encodeURIComponent(caseId)}/approve`, { method: "POST", body: {} });
    expect(approveResponse.status).toBe(409);
    expect(approveResponse.body?.error).toBe("EVIDENCE_NOT_VERIFIABLE");
    expect(approveResponse.body?.status).toBe("EVIDENCE_NOT_VERIFIABLE");
    expect((approveResponse.body?.failures as string[]).some((item) => item.endsWith("raw_hash.match"))).toBe(true);

    // 深度防御：即使审批在别处已经完成，执行仍然被拦
    approveCaseDirectly(caseId);
    const executeResponse = await call(`/api/v2/resolution-cases/${encodeURIComponent(caseId)}/execute`, { method: "POST", body: {} });
    expect(executeResponse.status).toBe(409);
    expect(executeResponse.body?.error).toBe("EVIDENCE_NOT_VERIFIABLE");
    expect((executeResponse.body?.failures as string[]).some((item) => item.endsWith("raw_hash.match"))).toBe(true);
  }, 120_000);

  it("闸门被拒绝时写入安全审计（denied），不是静默失败", async () => {
    const handle = openExistingJudgeStore(resolve(WORKSPACE, "pack-cases.sqlite"));
    try {
      const audits = handle.store.listSecurityAuditEvents("demo-manufacturing", { action: "resolution.approve" });
      expect(audits.some((item) => item.result === "denied")).toBe(true);
    } finally {
      handle.close();
    }
  });
});
