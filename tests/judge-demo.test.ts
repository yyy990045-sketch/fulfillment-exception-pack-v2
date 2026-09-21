import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JUDGE_SCENARIOS, runJudgeDemo } from "../src/demo/judge/runner.js";
import { assertSafeJudgeWorkspace, resetJudgeWorkspace } from "../src/demo/judge/workspace.js";
import { injectRawHashMismatch } from "../src/demo/judge/runner.js";
import { parseJudgeArgs } from "../src/demo/judge/cli.js";
import { parseEvidenceVerifyArgs } from "../src/traceability/verify-cli.js";

const created: string[] = [];
let counter = 0;

function workspaceDir() {
  counter += 1;
  const dir = `.preview/judge-test-${process.pid}-${counter}`;
  created.push(resolve(dir));
  return dir;
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("demo:judge 主场景（production-shortfall）", () => {
  it("11 个阶段全部有 INPUT/PROCESS/OUTPUT/PROOF，并且判定为 VERIFIED", async () => {
    const result = await runJudgeDemo({ workspace: workspaceDir() });
    expect(result.scenario).toBe("production-shortfall");
    expect(result.verdict).toBe("JUDGE_DEMO_VERIFIED");
    expect(result.stages).toHaveLength(11);
    for (const stage of result.stages) {
      expect(stage.input.length).toBeGreaterThan(0);
      expect(stage.process.length).toBeGreaterThan(0);
      expect(stage.output.length).toBeGreaterThan(0);
      expect(stage.proof.length).toBeGreaterThan(0);
      expect(stage.status).toBe("pass");
    }
    expect(result.stages.map((item) => item.id)).toEqual([
      "industrial_simulation", "uns_semantic_mapping", "connector_ingestion", "evidence",
      "rule_evaluation", "exception", "decision", "governance", "execution", "outcome", "analytics",
    ]);
  });

  it("业务事实与治理链：100 / 96 / 4，恰好 1 个异常，执行回读 verified，结果 target_met", async () => {
    const result = await runJudgeDemo({ workspace: workspaceDir(), aiProvider: "none" });
    expect(result.orderQuantity).toBe(100);
    expect(result.productionCompletedQuantity).toBe(96);
    expect(result.difference).toBe(4);
    expect(result.sourceSystems).toEqual(["ERP-DEMO", "MES-DEMO"]);
    expect(result.exceptionCode).toBe("ORDER_PRODUCTION_COMPLETION_SHORTFALL");
    expect(result.ruleEvaluationCount).toBe(7);
    expect(result.traceStatus).toBe("EVIDENCE_TRACE_VERIFIED");
    expect(result.traceFailures).toEqual([]);
    expect(result.governanceStatus).toBe("executed");
    expect(result.executionStatus).toBe("verified");
    expect(result.outcomeStatus).toBe("target_met");
    expect(result.truthFlags.JUDGE_DEMO_LOCALLY_VERIFIED).toBe(true);
    expect(result.truthFlags.REAL_FACTORY_VERIFIED).toBe(false);
    expect(result.truthFlags.REAL_MES_VERIFIED).toBe(false);
    expect(result.truthFlags.REAL_OPEN_SUPOS_RUNTIME_VERIFIED).toBe(false);
  });

  it("evidence.json 面向评委：结构、来源、UNS、回源状态与真值边界齐备", async () => {
    const result = await runJudgeDemo({ workspace: workspaceDir(), aiProvider: "none" });
    const manifest = JSON.parse(readFileSync(result.artifacts.evidenceManifest, "utf8")) as typeof result.manifest;
    expect(manifest.businessQuestion).toContain("订单承诺 100 件");
    expect(manifest.industrialContext).toMatchObject({
      enterpriseId: "demo-manufacturing",
      siteId: "factory-shanghai-01",
      areaId: "assembly-workshop",
      lineId: "line-a",
    });
    expect(manifest.businessFacts).toEqual({
      orderedQuantity: 100, productionCompletedQuantity: 96, difference: 4, unit: "pcs",
    });
    expect(manifest.sources.order?.systemKey).toBe("ERP-DEMO");
    expect(manifest.sources.production?.systemKey).toBe("MES-DEMO");
    expect(manifest.uns.orderTopic).toContain("/sales/SO-IND-002/order.created");
    expect(manifest.uns.productionTopic).toContain("/production/MO-IND-002/production.completed");
    expect(manifest.evidence.orderEvidenceId).toBeTruthy();
    expect(manifest.evidence.productionEvidenceId).toBeTruthy();
    expect(manifest.rule.code).toBe("MANUFACTURING.ORDER_PRODUCTION_COMPLETION_SHORTFALL");
    expect(manifest.rule.result).toBe("matched");
    expect(manifest.exception?.code).toBe("ORDER_PRODUCTION_COMPLETION_SHORTFALL");
    expect(manifest.exception?.severity).toBe("medium");
    expect(manifest.governance.status).toBe("executed");
    expect(manifest.governance.segregationOfDutiesEnforced).toBe(true);
    expect(manifest.execution.status).toBe("verified");
    expect(manifest.execution.receiptId).toBeTruthy();
    expect(manifest.outcome.status).toBe("target_met");
    expect(manifest.outcome.causalAttribution).toBe(false);
    expect(manifest.ai.canApprove).toBe(false);
    expect(manifest.ai.canExecute).toBe(false);
    expect(manifest.trace.status).toBe("EVIDENCE_TRACE_VERIFIED");
    expect(manifest.truthBoundary).toMatchObject({
      simulatedIndustrialEnvironment: true,
      realFactoryVerified: false,
      realMesVerified: false,
      openSuposRuntimeVerified: false,
    });
  });

  it("可复现：同一 seed 两次运行，业务结论完全一致（只有时间戳与运行时 ID 变化）", async () => {
    const first = await runJudgeDemo({ workspace: workspaceDir(), aiProvider: "none" });
    const second = await runJudgeDemo({ workspace: workspaceDir(), aiProvider: "none" });
    expect(second).toMatchObject({
      contextId: first.contextId,
      businessKey: first.businessKey,
      orderQuantity: first.orderQuantity,
      productionCompletedQuantity: first.productionCompletedQuantity,
      difference: first.difference,
      sourceSystems: first.sourceSystems,
      exceptionCode: first.exceptionCode,
      exceptionId: first.exceptionId,
      evidenceCount: first.evidenceCount,
      ruleEvaluationCount: first.ruleEvaluationCount,
      executionStatus: first.executionStatus,
      outcomeStatus: first.outcomeStatus,
      traceStatus: first.traceStatus,
    });
    expect(second.artifacts.readback).toBeTruthy();
  });

  it("AI 关闭时核心演示照样通过；AI 只给候选动作，不批准不执行", async () => {
    const withoutAi = await runJudgeDemo({ workspace: workspaceDir(), aiProvider: "none" });
    expect(withoutAi.verdict).toBe("JUDGE_DEMO_VERIFIED");
    expect(withoutAi.aiProvider).toBe("disabled");
    expect(withoutAi.stages.find((item) => item.id === "decision")!.status).toBe("blocked");

    const withAi = await runJudgeDemo({ workspace: workspaceDir(), aiProvider: "deterministic" });
    expect(withAi.aiProvider).toBe("decision-deterministic-demo");
    expect(withAi.manifest.ai.canApprove).toBe(false);
    expect(withAi.manifest.ai.canExecute).toBe(false);
    expect(withAi.manifest.ai.humanDecisionRequired).toBe(true);
  });
});

describe("demo:judge 备用场景（evidence-broken）", () => {
  it("异常仍被发现，但审批与执行被回源闸门阻止，输出 EVIDENCE_NOT_VERIFIABLE", async () => {
    const result = await runJudgeDemo({ scenario: "evidence-broken", workspace: workspaceDir(), aiProvider: "none" });
    expect(result.verdict).toBe("JUDGE_DEMO_VERIFIED"); // 期望行为成立 = 演示通过
    expect(result.exceptionCode).toBe("ORDER_PRODUCTION_COMPLETION_SHORTFALL");
    expect(result.traceStatus).toBe("EVIDENCE_NOT_VERIFIABLE");
    expect(result.traceFailures.some((item) => item.endsWith("raw_hash.match"))).toBe(true);
    expect(result.governanceStatus).toBe("EVIDENCE_NOT_VERIFIABLE");
    expect(result.executionStatus).toBe("blocked");
    expect(result.outcomeStatus).toBe("blocked_by_traceability_gate");
    expect(result.artifacts.readback).toBeNull();
    const governance = result.stages.find((item) => item.id === "governance")!;
    const execution = result.stages.find((item) => item.id === "execution")!;
    expect(governance.status).toBe("blocked");
    expect(execution.status).toBe("blocked");
    expect(execution.proof).toContain("未触发任何下游动作");
    expect(result.truthFlags.TRACEABILITY_GATE_LOCALLY_VERIFIED).toBe(true);
  });

  it("故障注入只改留存载荷，不改账本（所以能被检出而不是被掩盖）", async () => {
    const result = await runJudgeDemo({ scenario: "evidence-broken", workspace: workspaceDir(), aiProvider: "none" });
    expect(result.manifest.sources.production?.rawHash).toBeTruthy();
    const stream = readFileSync(result.artifacts.unsStream, "utf8");
    expect(stream).toContain("MO-IND-002");
    expect(result.difference).toBe(4); // 异常数值仍来自账本事实
  });

  it("injectRawHashMismatch 只触碰指定的那一条事件", () => {
    const messages = [
      { topic: "a", payload: JSON.stringify({ messageId: "m1", entity: { businessKey: "MO-IND-002" }, event: { eventType: "PRODUCTION_COMPLETED" }, facts: { completedQty: { value: 96 } } }) },
      { topic: "b", payload: JSON.stringify({ messageId: "m2", entity: { businessKey: "SO-IND-002" }, event: { eventType: "ORDER_CREATED" }, facts: { qty: { value: 100 } } }) },
    ];
    const result = injectRawHashMismatch(messages);
    expect(result.touched).toEqual(["m1"]);
    expect(JSON.parse(result.messages[0]!.payload).facts.completedQty.value).toBe(100);
    expect(result.messages[1]!.payload).toBe(messages[1]!.payload);
  });
});

describe("参数解析与工作区安全", () => {
  it("只接受声明过的场景与 AI 模式", () => {
    expect(parseJudgeArgs([]).scenario).toBe("production-shortfall");
    expect(parseJudgeArgs(["--scenario", "evidence-broken"]).scenario).toBe("evidence-broken");
    expect(() => parseJudgeArgs(["--scenario", "quality-failure"])).toThrow(/UNKNOWN_JUDGE_SCENARIO/);
    expect(() => parseJudgeArgs(["--ai", "magic"])).toThrow(/UNKNOWN_JUDGE_AI_MODE/);
    expect(JUDGE_SCENARIOS).toEqual(["production-shortfall", "evidence-broken"]);
  });

  it("evidence:verify 默认读取 judge 工作区的载荷与库", () => {
    const options = parseEvidenceVerifyArgs(["--context", "ctx-1"]);
    expect(options.context).toBe("ctx-1");
    expect(options.streamPath).toContain(".preview/judge-demo");
    expect(options.storePath).toContain("pack-cases.sqlite");
    expect(options.tenant).toBe("demo-manufacturing");
  });

  it("reset 只能删 judge 专属目录：其它路径一律拒绝", () => {
    expect(() => assertSafeJudgeWorkspace(process.cwd())).toThrow(/JUDGE_WORKSPACE_RESET_FORBIDDEN/);
    expect(() => assertSafeJudgeWorkspace(resolve(process.cwd(), ".preview"))).toThrow(/JUDGE_WORKSPACE_RESET_FORBIDDEN/);
    expect(() => assertSafeJudgeWorkspace("/")).toThrow(/JUDGE_WORKSPACE_RESET_FORBIDDEN/);
    expect(() => assertSafeJudgeWorkspace(resolve(process.cwd(), "data/pack-cases/pack-cases.sqlite")))
      .toThrow(/JUDGE_WORKSPACE_OUTSIDE_PREVIEW_ROOT|JUDGE_WORKSPACE_RESET_FORBIDDEN_DATABASE_FILE/);
    expect(() => assertSafeJudgeWorkspace(resolve(process.cwd(), ".preview/../src")))
      .toThrow(/JUDGE_WORKSPACE_OUTSIDE_PREVIEW_ROOT/);
    const safe = assertSafeJudgeWorkspace(resolve(process.cwd(), ".preview/judge-safe-check"));
    expect(safe).toContain(".preview/judge-safe-check");
  });

  it("reset 不存在的目录也安全（幂等）", () => {
    const dir = `.preview/judge-reset-noop-${process.pid}`;
    const result = resetJudgeWorkspace(dir);
    expect(result.removed).toBe(true);
    expect(existsSync(result.rootDir)).toBe(false);
  });

  it("默认数据库与生产数据库不会被 reset 触碰", () => {
    const probe = mkdtempSync(join(tmpdir(), "fep-judge-safety-"));
    const custom = join(probe, "custom.sqlite");
    writeFileSync(custom, "sentinel", "utf8");
    try {
      expect(() => resetJudgeWorkspace(custom)).toThrow();
      expect(readFileSync(custom, "utf8")).toBe("sentinel");
    } finally {
      rmSync(probe, { recursive: true, force: true });
    }
  });
});
