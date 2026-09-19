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

const port = 35650 + (process.pid % 60);
const base = `http://127.0.0.1:${port}`;
let child: ChildProcess;
let storeDir: string;
let exceptionId = "";

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
  throw new Error("automation server did not become healthy");
}

beforeAll(async () => {
  storeDir = mkdtempSync(join(tmpdir(), "fep-automation-http-"));
  process.env.PACK_STORE_DIR = storeDir;
  process.env.PACK_STORE_DB = join(storeDir, "pack-cases.sqlite");
  provisionV2ManufacturingDemoData();
  evaluateContextRules(openV2SqliteStore(), "demo-manufacturing", "ctx-so-mfg-001");
  exceptionId = openV2SqliteStore().listExceptions("demo-manufacturing", "ctx-so-mfg-001")
    .find((item) => item.code === "CUSTOMER_RECEIPT_CLAIM_MISMATCH")!.id;
  child = spawn(join(process.cwd(), "node_modules", ".bin", "tsx"), ["src/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      NODE_ENV: "test",
      DEMO_MODE: "true",
      DECISION_AI_PROVIDER: "deterministic",
      AUTOMATION_ENABLED: "true",
      AUTOMATION_EXECUTOR: "internal",
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

describe("policy-bounded automation HTTP", () => {
  it("executes an auto-eligible internal action and exposes pure read APIs", async () => {
    const decisionPath = `/api/v2/contexts/ctx-so-mfg-001/exceptions/${exceptionId}/decision-recommendations`;
    const recommendation = await call("POST", decisionPath, {});
    const option = recommendation.json.output.options.find((item: any) => item.actionType === "supplement_evidence") ?? recommendation.json.output.options[0];
    const policyPath = `/api/v2/contexts/ctx-so-mfg-001/exceptions/${exceptionId}/policy-evaluations`;
    const policy = await call("POST", policyPath, { recommendationId: recommendation.json.id, optionId: option.id });
    expect(policy.status).toBe(200);
    expect(policy.json.decision.mode).toBe("auto_eligible");

    const readinessPath = `${policyPath}/${policy.json.id}/automation-readiness`;
    const readiness = await call("GET", readinessPath);
    expect(readiness.status).toBe(200);
    expect(readiness.json).toMatchObject({ executable: true, executorConfigured: true, executorSupportsAction: true, safetyBoundaryPassed: true });

    const before = {
      resolutions: openV2SqliteStore().listResolutionCases("demo-manufacturing", "ctx-so-mfg-001").length,
      exception: openV2SqliteStore().listExceptions("demo-manufacturing", "ctx-so-mfg-001").find((item) => item.id === exceptionId)!,
    };
    const runsPath = `${policyPath}/${policy.json.id}/automation-runs`;
    const executed = await call("POST", runsPath, {});
    expect(executed.status).toBe(200);
    expect(executed.json.run).toMatchObject({ status: "succeeded", candidateActionType: option.actionType, triggerSource: "human_request" });
    expect(executed.json.workItem).toMatchObject({ status: "open", kind: option.actionType === "supplement_evidence" ? "evidence_request" : "task" });
    expect(executed.json.receipt).toMatchObject({ status: "succeeded", receiptSource: "internal-work-item" });

    const repeated = await call("POST", runsPath, {});
    expect(repeated.status).toBe(200);
    expect(repeated.json.run.id).toBe(executed.json.run.id);
    expect(repeated.json.workItem.id).toBe(executed.json.workItem.id);
    expect(repeated.json.receipt.id).toBe(executed.json.receipt.id);

    const runs = await call("GET", runsPath);
    expect(runs.json.runs).toHaveLength(1);
    const workItems = await call("GET", "/api/v2/internal-work-items?status=open");
    expect(workItems.json.workItems).toHaveLength(1);
    expect(openV2SqliteStore().listResolutionCases("demo-manufacturing", "ctx-so-mfg-001")).toHaveLength(before.resolutions);
    expect(openV2SqliteStore().listExceptions("demo-manufacturing", "ctx-so-mfg-001").find((item) => item.id === exceptionId)).toMatchObject({
      id: before.exception.id,
      status: before.exception.status,
      latestRuleEvaluationId: before.exception.latestRuleEvaluationId,
    });
  });

  it("rejects forbidden fields, cross tenant access, and non-eligible execution", async () => {
    const policyPath = `/api/v2/contexts/ctx-so-mfg-001/exceptions/${exceptionId}/policy-evaluations`;
    const humanOnly = await call("POST", policyPath, { actionType: "reject_overclaim" });
    const runsPath = `${policyPath}/${humanOnly.json.id}/automation-runs`;
    const forbidden = await call("POST", runsPath, { actor: "admin", actionType: "create_task" });
    expect(forbidden.status).toBe(400);
    expect(forbidden.json.error).toBe("AUTOMATION_REQUEST_FIELDS_FORBIDDEN");
    const blocked = await call("POST", runsPath, {});
    expect(blocked.status).toBe(409);
    expect(blocked.json.error).toBe("AUTOMATION_POLICY_NOT_ELIGIBLE");
    const crossTenant = await call("GET", runsPath, undefined, "quality-owner", "other-tenant");
    expect(crossTenant.status).toBe(404);
    const missingReadiness = await call("GET", `${policyPath}/missing/automation-readiness`);
    expect(missingReadiness.status).toBe(404);
  });
});
