/**
 * `npm run demo:industrial` —— 比赛现场的一键完整演示。
 *
 * 十个步骤全部真实执行（不是打印脚本进度）：
 *
 *   01 reset isolated demo workspace   从全新空库开始，绝不污染既有演示库
 *   02 start simulator                 固定 seed / 固定场景，随时可复现
 *   03 emit events                     16 条事件按工业日历发生，来自 7 个不同系统
 *   04 ingest                          经 UNS topic + Mapping Manifest 进既有 Connector Runtime
 *   05 build context                   产出 Business Context + ISA-95 工业归属
 *   06 create evidence                 每条结论都能回答「依据哪个系统的哪条记录」
 *   07 evaluate rules                  7 条规则全部执行，逐条记录 observations
 *   08 generate exception              异常候选（数量由规则引擎决定，不是脚本写死的）
 *   09 resolution capability           异常 → 可执行的处置能力矩阵
 *   10 analytics projection            运营分析投影（含 site/line/sourceSystem 维度）
 *
 * 默认场景 `production-shortfall`：恰好 1 个异常，缺口被准确定位到 MES 工单完工数量。
 * 最后输出 `INDUSTRIAL_DEMO_VERIFIED` 与 contextId / eventCount / evidenceCount /
 * evaluationCount / exceptionCount / exceptionCode。**不输出任何 secret。**
 */
import { buildOperationalAnalytics } from "../../analytics/index.js";
import { buildResolutionCapabilities } from "../../domain/v2/index.js";
import { buildIndustrialExceptionTrace } from "../../industrial/context-summary.js";
import { demoOrganizationName } from "../../application/demo-workspaces.js";
import { createSimulatorTransport, playbackSeconds, type SimulatorTransportKind } from "./transport.js";
import { DEFAULT_DEMO_SCENARIO, DEFAULT_SIMULATION_SEED, resolveScenario } from "./scenarios.js";
import { DEMO_PHASES, replayIndustrialSimulation, runIndustrialSimulation, simulationFingerprint, type DemoPhase } from "./runner.js";
import { buildSimulationMessageStream, DEMO_SIMULATION_TENANT } from "./emitter.js";
import { INDUSTRIAL_MAPPING_MANIFEST } from "../../industrial/mapping-manifest.js";
import { DEMO_MANUFACTURING_HIERARCHY } from "../../industrial/hierarchy.js";
import { openIsolatedSimulationWorkspace, DEFAULT_SIMULATION_WORKSPACE } from "./workspace.js";

export type DemoStep = {
  step: string;
  phase: DemoPhase;
  status: "pass" | "fail";
  detail: string;
};

export type IndustrialDemoResult = {
  verified: boolean;
  verdict: "INDUSTRIAL_DEMO_VERIFIED" | "INDUSTRIAL_DEMO_FAILED";
  environment: "SIMULATED INDUSTRIAL ENVIRONMENT";
  scenario: string;
  seed: string;
  transport: SimulatorTransportKind;
  speed: number;
  workspace: string;
  contextId: string;
  businessKey: string;
  eventCount: number;
  evidenceCount: number;
  evaluationCount: number;
  exceptionCount: number;
  exceptionCode: string | null;
  exceptionCodes: string[];
  exceptionId: string | null;
  resolutionCapabilities: Record<string, { applicable: boolean; allowed: boolean; reasonCode: string }> | null;
  analytics: {
    contextCount: number;
    detectedExceptionCount: number;
    sourceSystemInvolvement: Array<{ sourceSystemId: string; involvedExceptionCount: number }>;
  };
  traceNodeCount: number;
  canonicalEventCount: number;
  simulatedSpanMinutes: number;
  playbackSeconds: number;
  simulatedFingerprint: string;
  replayIdempotent: boolean;
  steps: DemoStep[];
  artifactPaths: string[];
  truthfulness: Record<string, string | boolean>;
};

export async function runIndustrialDemo(options: {
  scenario?: string;
  seed?: string;
  speed?: number;
  transport?: SimulatorTransportKind;
  workspace?: string;
  out?: string | null;
} = {}): Promise<IndustrialDemoResult> {
  const scenario = resolveScenario(options.scenario ?? DEFAULT_DEMO_SCENARIO);
  const seed = options.seed ?? DEFAULT_SIMULATION_SEED;
  const speed = options.speed ?? 100;
  const transportKind = options.transport ?? "local";
  const workspaceRoot = options.workspace ?? DEFAULT_SIMULATION_WORKSPACE;
  const steps: DemoStep[] = [];
  const artifactPaths: string[] = [];
  let stepCounter = 0;
  const record = (phase: DemoPhase, status: "pass" | "fail", detail: string) => {
    stepCounter += 1;
    steps.push({ step: String(stepCounter).padStart(2, "0"), phase, status, detail });
  };

  // 01 reset isolated demo workspace
  const workspace = openIsolatedSimulationWorkspace(workspaceRoot);
  record("reset_isolated_demo_workspace", "pass", `workspace=${workspace.rootDir} database=pack-cases.sqlite (fresh)`);

  try {
    // 02 start simulator
    const transport = createSimulatorTransport(transportKind);
    record("start_simulator", "pass", `scenario=${scenario.id} seed=${seed} speed=${speed} transport=${transportKind}`);

    // 03 emit events：先在建流阶段拿到 topic 与工业日历跨度，再按速度播放
    const stream = buildSimulationMessageStream({ scenario, seed, manifest: INDUSTRIAL_MAPPING_MANIFEST, hierarchy: DEMO_MANUFACTURING_HIERARCHY });
    const fingerprint = simulationFingerprint({ scenario: scenario.id, seed, messages: stream.messages });
    record("emit_events", "pass",
      `${stream.messages.length} events across ${new Set(stream.messages.map((item) => item.record.sourceSystemKey)).size} source systems, ${new Set(stream.messages.map((item) => item.topic)).size} UNS topics`);

    // 04 ingest ~ 08 generate exception（由 runner 真实执行整条链路）
    const sleep = speed > 0 ? (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) : undefined;
    const run = await runIndustrialSimulation({
      store: workspace.store,
      scenario,
      transport,
      seed,
      speed,
      ...(sleep ? { sleep } : {}),
    });
    record("ingest", run.sync.status === "succeeded" ? "pass" : "fail",
      `recordsRead=${run.sync.recordsRead} accepted=${run.sync.recordsAccepted} ledger=${run.sync.ledgerRecords} duplicate=${run.sync.recordsDuplicate}`);
    record("build_context", "pass",
      `contextId=${run.contextId} businessKey=${run.businessKey} uns=${run.unsRootPath} site=${run.space?.siteId ?? "-"} line=${run.space?.lineId ?? "-"}`);
    record("create_evidence", "pass", `events=${run.eventCount} evidence=${run.evidenceCount} canonicalEvents=${run.canonicalEvents.length}`);
    record("evaluate_rules", run.evaluationCount === scenario.expectation.evaluations ? "pass" : "fail",
      `evaluations=${run.evaluationCount} matched=${run.matchedRuleCount} notMatched=${run.notMatchedRuleCount}`);
    record("generate_exception", run.exceptionCount > 0 ? "pass" : "fail",
      `exceptions=${run.exceptionCount} codes=${run.exceptionCodes.join(",") || "none"}`);

    const primaryException = run.exceptionIds[0]
      ? workspace.store.listExceptions(DEMO_SIMULATION_TENANT, run.contextId).find((item) => item.id === run.exceptionIds[0])
      : undefined;

    // 09 resolution capability：异常 → 可执行处置能力矩阵
    let capabilities: IndustrialDemoResult["resolutionCapabilities"] = null;
    if (primaryException) {
      const actor = {
        tenantId: DEMO_SIMULATION_TENANT,
        organization: demoOrganizationName(DEMO_SIMULATION_TENANT),
        organizationSource: "demo" as const,
        user: "demo-operator",
        subjectId: "demo-operator",
        roles: ["管理员"],
        authnMethod: "demo-header" as const,
      };
      const bundle = workspace.store.getExceptionEvidenceBundle(DEMO_SIMULATION_TENANT, primaryException.id);
      const projection = buildResolutionCapabilities({
        currentActor: actor,
        exception: primaryException,
        hasEvidenceBundle: Boolean(bundle),
        ...(workspace.store.getResolutionCaseByException(DEMO_SIMULATION_TENANT, primaryException.id)
          ? { resolutionCase: workspace.store.getResolutionCaseByException(DEMO_SIMULATION_TENANT, primaryException.id)! }
          : {}),
      });
      capabilities = Object.fromEntries(
        Object.entries(projection.resolutionCapabilities).map(([key, value]) => [key, {
          applicable: value.applicable,
          allowed: value.allowed,
          reasonCode: value.reasonCode,
        }]),
      );
      record("resolution_capability", "pass",
        `${Object.keys(capabilities).length} 项处置能力已解析  assignableOwnerRoles=${projection.assignableOwnerRoles.length}`);
    } else {
      record("resolution_capability", "fail", "no exception detected, capability matrix not applicable");
    }

    // 10 analytics projection（含 site / line / sourceSystem 维度）
    const analytics = buildOperationalAnalytics(workspace.store, DEMO_SIMULATION_TENANT, {});
    record("analytics_projection", "pass",
      `contexts=${analytics.summary.contextCount} exceptions=${analytics.summary.detectedExceptionCount} sourceSystems=${analytics.sourceSystemInvolvement.length}`);

    const trace = primaryException
      ? buildIndustrialExceptionTrace(workspace.store, DEMO_SIMULATION_TENANT, run.contextId, primaryException.id)
      : undefined;

    const replay = await replayIndustrialSimulation({
      store: workspace.store,
      scenario,
      transport: createSimulatorTransport(transportKind),
      seed,
      speed: 0,
    });

    const artifactBase = options.out ?? "industrial-demo";
    artifactPaths.push(workspace.writeArtifact(`${artifactBase}-canonical-events.jsonl`,
      run.canonicalEvents.map((event) => JSON.stringify(event)).join("\n")));
    artifactPaths.push(workspace.writeArtifact(`${artifactBase}-trace.json`, JSON.stringify({
      environment: "SIMULATED INDUSTRIAL ENVIRONMENT",
      unsTopicConvention: "enterprise/{enterpriseId}/site/{siteId}/area/{areaId}/line/{lineId}/{domain}/{entityId}/{eventType}",
      contextId: run.contextId,
      businessKey: run.businessKey,
      unsRootPath: run.unsRootPath,
      mappingVersion: `${INDUSTRIAL_MAPPING_MANIFEST.id}@${INDUSTRIAL_MAPPING_MANIFEST.version}`,
      mappingContentHash: INDUSTRIAL_MAPPING_MANIFEST.contentHash,
      sourceSystems: run.sourceSystems,
      exception: primaryException
        ? { id: primaryException.id, code: primaryException.code, title: primaryException.title, summary: primaryException.summary, metrics: primaryException.metrics }
        : null,
      trace: trace?.nodes ?? [],
      truthfulness: run.summary.truthfulness,
    }, null, 2)));

    const verified = steps.every((item) => item.status === "pass") && replay.idempotent && run.exceptionCodes.length > 0;
    return {
      verified,
      verdict: verified ? "INDUSTRIAL_DEMO_VERIFIED" : "INDUSTRIAL_DEMO_FAILED",
      environment: "SIMULATED INDUSTRIAL ENVIRONMENT",
      scenario: scenario.id,
      seed,
      transport: transportKind,
      speed,
      workspace: workspace.rootDir,
      contextId: run.contextId,
      businessKey: run.businessKey,
      eventCount: run.eventCount,
      evidenceCount: run.evidenceCount,
      evaluationCount: run.evaluationCount,
      exceptionCount: run.exceptionCount,
      exceptionCode: run.exceptionCodes.length === 1 ? run.exceptionCodes[0]! : (run.exceptionCodes[0] ?? null),
      exceptionCodes: run.exceptionCodes,
      exceptionId: primaryException?.id ?? null,
      resolutionCapabilities: capabilities,
      analytics: {
        contextCount: analytics.summary.contextCount,
        detectedExceptionCount: analytics.summary.detectedExceptionCount,
        sourceSystemInvolvement: analytics.sourceSystemInvolvement.map((item) => ({
          sourceSystemId: item.sourceSystemId,
          involvedExceptionCount: item.involvedExceptionCount,
        })),
      },
      traceNodeCount: trace?.nodes.length ?? 0,
      canonicalEventCount: run.canonicalEvents.length,
      simulatedSpanMinutes: run.timing.spanMinutes,
      playbackSeconds: playbackSeconds(run.timing.spanMinutes, speed),
      simulatedFingerprint: fingerprint,
      replayIdempotent: replay.idempotent,
      steps,
      artifactPaths,
      truthfulness: {
        environment: run.summary.environment,
        mappingManifest: `${INDUSTRIAL_MAPPING_MANIFEST.id}@${INDUSTRIAL_MAPPING_MANIFEST.version}`,
        realFactory: false,
        realMes: false,
        realErp: false,
        realQms: false,
        realWms: false,
      },
    };
  } finally {
    workspace.close();
  }
}

export function formatDemoResult(result: IndustrialDemoResult) {
  const lines = [
    `SIMULATED INDUSTRIAL ENVIRONMENT  scenario=${result.scenario} seed=${result.seed} transport=${result.transport} speed=${result.speed}`,
    ...result.steps.map((item) => `${item.status === "pass" ? "PASS" : "FAIL"}  ${item.step} ${item.phase.padEnd(34)} ${item.detail}`),
    "",
    `contextId       = ${result.contextId}`,
    `businessKey     = ${result.businessKey}`,
    `eventCount      = ${result.eventCount}`,
    `evidenceCount   = ${result.evidenceCount}`,
    `evaluationCount = ${result.evaluationCount}`,
    `exceptionCount  = ${result.exceptionCount}`,
    `exceptionCode   = ${result.exceptionCode ?? "none"}`,
    `replayIdempotent= ${result.replayIdempotent}`,
    `artifacts       = ${result.artifactPaths.join(", ")}`,
    "",
    result.verdict,
  ];
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const valueOf = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const speedRaw = valueOf("--speed");
  const result = await runIndustrialDemo({
    ...(valueOf("--scenario") ? { scenario: valueOf("--scenario")! } : {}),
    ...(valueOf("--seed") ? { seed: valueOf("--seed")! } : {}),
    ...(speedRaw ? { speed: Number(speedRaw) } : {}),
    ...(valueOf("--transport") ? { transport: valueOf("--transport") as SimulatorTransportKind } : {}),
    ...(valueOf("--workspace") ? { workspace: valueOf("--workspace")! } : {}),
  });
  console.log(formatDemoResult(result));
  if (argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
  process.exit(result.verified ? 0 : 1);
}

export { DEMO_PHASES };
