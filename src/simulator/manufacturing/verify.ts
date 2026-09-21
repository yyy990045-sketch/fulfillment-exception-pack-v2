/**
 * `npm run simulator:verify` —— 制造业仿真 A/B 验证闸门（本地，无真实工厂）。
 *
 * 验证的是「同一套链路在不同业务输入下的判别力」，而不是「代码跑通了」：
 *   normal               → 0 异常
 *   production-shortfall → 恰好 1 个（ORDER_PRODUCTION_COMPLETION_SHORTFALL）
 *   quality-failure      → 命中质量异常（并产生 QMS→WMS 的真实因果级联）
 *   shipment-shortfall   → 恰好 1 个（SHIPMENT_QUANTITY_SHORTFALL）
 *   payment-shortfall    → 恰好 1 个（PAYMENT_BALANCE_OUTSTANDING）
 *
 * 另外验证：多系统来源、UNS topic 约定、mapping manifest 覆盖与双向翻译、
 * Canonical Event 与账本一致、以及全部场景重放幂等。
 *
 * 结论只能是 `INDUSTRIAL_SIMULATOR_LOCALLY_VERIFIED`：
 * 它证明的是仿真链路，**不等于**真实 MES/ERP/QMS/WMS/工厂已验证。
 */
import { assertMappingCoverage, INDUSTRIAL_MAPPING_MANIFEST, mappingCoverageReport, UNS_TOPIC_CONVENTION } from "../../industrial/index.js";
import { DEMO_MANUFACTURING_HIERARCHY, resolveIndustrialSpace } from "../../industrial/hierarchy.js";
import { parseIndustrialUnsTopic } from "../../industrial/uns-topic.js";
import { DEMO_SIMULATION_TENANT, buildSimulationMessageStream } from "./emitter.js";
import { replayIndustrialSimulation, runIndustrialSimulation } from "./runner.js";
import { DEFAULT_SIMULATION_SEED, SIMULATION_SCENARIOS, type SimulationScenario } from "./scenarios.js";
import { LocalSimulatorTransport } from "./transport.js";
import { openIsolatedSimulationWorkspace } from "./workspace.js";

export type SimulatorCheckStatus = "pass" | "fail";

export type SimulatorCheck = {
  id: string;
  label: string;
  status: SimulatorCheckStatus;
  detail: string;
};

export type ScenarioEvidence = {
  scenario: string;
  label: string;
  contextId: string;
  messageCount: number;
  ledgerRecords: number;
  canonicalEvents: number;
  events: number;
  evidenceRows: number;
  evaluations: number;
  matchedRules: number;
  notMatchedRules: number;
  exceptions: number;
  exceptionCodes: string[];
  expectedExceptionCodes: string[];
  sourceSystems: string[];
  unsTopicSample: string;
  space: { enterpriseId: string; siteId: string; areaId: string; lineId: string } | null;
  replay: { idempotent: boolean; failures: string[] };
  passed: boolean;
};

export type SimulatorVerificationReport = {
  schemaVersion: "industrial-simulator-verification/v1";
  environment: "SIMULATED INDUSTRIAL ENVIRONMENT";
  verdict: "INDUSTRIAL_SIMULATOR_LOCALLY_VERIFIED" | "FAILED";
  status: "pass" | "fail";
  tenantId: string;
  seed: string;
  mapping: {
    id: string;
    version: string;
    contentHash: string;
    entryCount: number;
    coveredTargetCount: number;
    requiredTargetCount: number;
    missingTargets: string[];
  };
  unsTopicConvention: { id: string; version: string; segmentCount: number; template: string };
  scenarios: ScenarioEvidence[];
  checks: SimulatorCheck[];
  failures: string[];
  truthFlags: Record<string, boolean>;
  generatedAt: string;
};

const EXPECTED_SOURCE_SYSTEMS = ["CRM-DEMO", "ERP-DEMO", "FINANCE-DEMO", "MES-DEMO", "QMS-DEMO", "SERVICE-DEMO", "WMS-DEMO"];

function sameSet(left: string[], right: string[]) {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

async function verifyScenario(scenario: SimulationScenario, seed: string) {
  const workspace = openIsolatedSimulationWorkspace(`.preview/simulator-verify/${scenario.id}`);
  try {
    const run = await runIndustrialSimulation({
      store: workspace.store,
      scenario,
      transport: new LocalSimulatorTransport(),
      seed,
      speed: 0,
    });
    const replay = await replayIndustrialSimulation({
      store: workspace.store,
      scenario,
      transport: new LocalSimulatorTransport(),
      seed,
      speed: 0,
    });
    const failures: string[] = [];
    if (run.messageCount !== 16) failures.push(`messages=${run.messageCount}`);
    if (run.sync.recordsAccepted !== run.messageCount) failures.push(`accepted=${run.sync.recordsAccepted}`);
    if (run.sync.ledgerRecords !== run.messageCount) failures.push(`ledger=${run.sync.ledgerRecords}`);
    if (run.canonicalEvents.length !== run.messageCount) failures.push(`canonicalEvents=${run.canonicalEvents.length}`);
    if (run.eventCount !== run.messageCount) failures.push(`events=${run.eventCount}`);
    if (run.evaluationCount !== scenario.expectation.evaluations) failures.push(`evaluations=${run.evaluationCount}`);
    if (!sameSet(run.exceptionCodes, scenario.expectation.exceptionCodes)) failures.push(`exceptionCodes=${run.exceptionCodes.join(",")}`);
    if (!sameSet(run.sourceSystems, EXPECTED_SOURCE_SYSTEMS)) failures.push(`sourceSystems=${run.sourceSystems.join(",")}`);
    if (!replay.idempotent) failures.push(...replay.failures.map((item) => `replay:${item}`));
    if (run.summary.environment !== "SIMULATED INDUSTRIAL ENVIRONMENT") failures.push("environment_mislabeled");
    if (run.summary.truthfulness.realFactory !== false) failures.push("truthfulness_real_factory_leaked");
    return {
      scenario,
      evidence: {
        scenario: scenario.id,
        label: scenario.label,
        contextId: run.contextId,
        messageCount: run.messageCount,
        ledgerRecords: run.sync.ledgerRecords,
        canonicalEvents: run.canonicalEvents.length,
        events: run.eventCount,
        evidenceRows: run.evidenceCount,
        evaluations: run.evaluationCount,
        matchedRules: run.matchedRuleCount,
        notMatchedRules: run.notMatchedRuleCount,
        exceptions: run.exceptionCount,
        exceptionCodes: run.exceptionCodes,
        expectedExceptionCodes: [...scenario.expectation.exceptionCodes].sort(),
        sourceSystems: run.sourceSystems,
        unsTopicSample: run.topics[3] ?? run.topics[0] ?? "",
        space: run.space
          ? { enterpriseId: run.space.enterpriseId, siteId: run.space.siteId, areaId: run.space.areaId, lineId: run.space.lineId }
          : null,
        replay: { idempotent: replay.idempotent, failures: replay.failures },
        passed: failures.length === 0,
      } satisfies ScenarioEvidence,
      failures,
      run,
    };
  } finally {
    workspace.close();
  }
}

export async function runIndustrialSimulatorVerification(options: {
  seed?: string;
  now?: () => Date;
} = {}): Promise<SimulatorVerificationReport> {
  const seed = options.seed ?? DEFAULT_SIMULATION_SEED;
  const now = options.now ?? (() => new Date());
  const checks: SimulatorCheck[] = [];
  const failures: string[] = [];
  const scenarioEvidence: ScenarioEvidence[] = [];

  // ── 静态检查：层级 / topic 约定 / mapping manifest
  try {
    resolveIndustrialSpace(DEMO_MANUFACTURING_HIERARCHY, {
      enterpriseId: "demo-manufacturing",
      siteId: "factory-shanghai-01",
      areaId: "assembly-workshop",
      lineId: "line-a",
    });
    checks.push({ id: "isa95.hierarchy", label: "ISA-95 层级可解析（Enterprise→Site→Area→Line→Equipment）", status: "pass",
      detail: `nodes=${DEMO_MANUFACTURING_HIERARCHY.nodes.length}` });
  } catch (error) {
    checks.push({ id: "isa95.hierarchy", label: "ISA-95 层级可解析", status: "fail", detail: String(error) });
    failures.push("isa95.hierarchy");
  }

  const coverage = mappingCoverageReport(INDUSTRIAL_MAPPING_MANIFEST);
  try {
    assertMappingCoverage(INDUSTRIAL_MAPPING_MANIFEST);
    checks.push({ id: "mapping.coverage", label: "Mapping Manifest 覆盖 Order/Production/Quality/Shipment/Payment", status: "pass",
      detail: `entries=${coverage.entryCount} covered=${coverage.coveredTargetCount}/${coverage.requiredTargetCount} systems=${coverage.sourceSystems.join(",")}` });
  } catch (error) {
    checks.push({ id: "mapping.coverage", label: "Mapping Manifest 覆盖", status: "fail", detail: String(error) });
    failures.push("mapping.coverage");
  }

  try {
    const sample = buildSimulationMessageStream({
      scenario: SIMULATION_SCENARIOS[0]!,
      seed,
      manifest: INDUSTRIAL_MAPPING_MANIFEST,
      hierarchy: DEMO_MANUFACTURING_HIERARCHY,
    });
    const topics = sample.messages.map((item) => item.topic);
    const parsed = topics.map((topic) => parseIndustrialUnsTopic(topic));
    const conformant = parsed.every((item) =>
      item.enterpriseId && item.siteId && item.areaId && item.lineId && item.domain && item.entityId && item.eventType);
    checks.push({ id: "uns.topic_convention", label: "全部 topic 符合 11 段 UNS 约定", status: conformant ? "pass" : "fail",
      detail: `topics=${topics.length} domains=${[...new Set(parsed.map((item) => item.domain))].sort().join(",")}` });
    if (!conformant) failures.push("uns.topic_convention");
  } catch (error) {
    checks.push({ id: "uns.topic_convention", label: "全部 topic 符合 11 段 UNS 约定", status: "fail", detail: String(error) });
    failures.push("uns.topic_convention");
  }

  // ── 每个场景：完整链路 + 重放
  for (const scenario of SIMULATION_SCENARIOS) {
    const result = await verifyScenario(scenario, seed);
    scenarioEvidence.push(result.evidence);
    checks.push({
      id: `scenario.${scenario.id}`,
      label: scenario.label,
      status: result.evidence.passed ? "pass" : "fail",
      detail: [
        `evaluations=${result.evidence.evaluations}`,
        `matched=${result.evidence.matchedRules}`,
        `exceptions=${result.evidence.exceptions}`,
        `codes=${result.evidence.exceptionCodes.join(",") || "none"}`,
        `sources=${result.evidence.sourceSystems.length}`,
        `canonical=${result.evidence.canonicalEvents}`,
        `replay=${result.evidence.replay.idempotent ? "idempotent" : "NOT_IDEMPOTENT"}`,
      ].join(" "),
    });
    for (const failure of result.failures) failures.push(`${scenario.id}:${failure}`);
  }

  // ── 异常的判别力：normal 必须 0，production-shortfall 必须恰好 1
  const normal = scenarioEvidence.find((item) => item.scenario === "normal");
  const productionShortfall = scenarioEvidence.find((item) => item.scenario === "production-shortfall");
  const discriminating = Boolean(normal && normal.exceptions === 0 && productionShortfall && productionShortfall.exceptions === 1);
  checks.push({
    id: "discrimination.normal_vs_shortfall",
    label: "A/B 判别力：normal=0 与 production-shortfall=1 同时成立",
    status: discriminating ? "pass" : "fail",
    detail: `normal=${normal?.exceptions ?? "?"} production-shortfall=${productionShortfall?.exceptions ?? "?"}`,
  });
  if (!discriminating) failures.push("discrimination.normal_vs_shortfall");

  const allReplaysIdempotent = scenarioEvidence.every((item) => item.replay.idempotent);
  checks.push({
    id: "replay.idempotent_all",
    label: "全部场景重放幂等（新账本=0 / 新事件=0 / 新异常=0）",
    status: allReplaysIdempotent ? "pass" : "fail",
    detail: scenarioEvidence.map((item) => `${item.scenario}:${item.replay.idempotent ? "ok" : item.replay.failures.join("|")}`).join(" "),
  });
  if (!allReplaysIdempotent) failures.push("replay.idempotent_all");

  const multiSystem = scenarioEvidence.every((item) => item.sourceSystems.length === EXPECTED_SOURCE_SYSTEMS.length);
  checks.push({
    id: "multisystem.sources",
    label: "多系统来源成立（ERP/MES/QMS/WMS/Finance/CRM/Service）",
    status: multiSystem ? "pass" : "fail",
    detail: `${EXPECTED_SOURCE_SYSTEMS.length} 个来源系统在所有场景中均参与`,
  });
  if (!multiSystem) failures.push("multisystem.sources");

  const failed = checks.filter((item) => item.status === "fail");
  const pass = failed.length === 0;
  return {
    schemaVersion: "industrial-simulator-verification/v1",
    environment: "SIMULATED INDUSTRIAL ENVIRONMENT",
    verdict: pass ? "INDUSTRIAL_SIMULATOR_LOCALLY_VERIFIED" : "FAILED",
    status: pass ? "pass" : "fail",
    tenantId: DEMO_SIMULATION_TENANT,
    seed,
    mapping: {
      id: coverage.id,
      version: coverage.version,
      contentHash: coverage.contentHash,
      entryCount: coverage.entryCount,
      coveredTargetCount: coverage.coveredTargetCount,
      requiredTargetCount: coverage.requiredTargetCount,
      missingTargets: coverage.missingTargets,
    },
    unsTopicConvention: {
      id: UNS_TOPIC_CONVENTION.id,
      version: UNS_TOPIC_CONVENTION.version,
      segmentCount: UNS_TOPIC_CONVENTION.segmentCount,
      template: UNS_TOPIC_CONVENTION.template,
    },
    scenarios: scenarioEvidence,
    checks,
    failures,
    truthFlags: {
      INDUSTRIAL_SIMULATOR_IMPLEMENTED: true,
      INDUSTRIAL_SIMULATOR_LOCALLY_VERIFIED: pass,
      ISA95_UNS_HIERARCHY_IMPLEMENTED: true,
      UNS_TOPIC_CONVENTION_IMPLEMENTED: true,
      INDUSTRIAL_MAPPING_MANIFEST_IMPLEMENTED: true,
      CANONICAL_INDUSTRIAL_EVENT_IMPLEMENTED: true,
      MULTISYSTEM_INDUSTRIAL_FLOW_LOCALLY_VERIFIED: multiSystem && pass,
      INDUSTRIAL_REPLAY_LOCALLY_VERIFIED: allReplaysIdempotent,
      REAL_MES_VERIFIED: false,
      REAL_ERP_VERIFIED: false,
      REAL_QMS_VERIFIED: false,
      REAL_WMS_VERIFIED: false,
      REAL_FACTORY_VERIFIED: false,
    },
    generatedAt: now().toISOString(),
  };
}

export function formatSimulatorReport(report: SimulatorVerificationReport) {
  const lines = [
    `environment=${report.environment} status=${report.status} verdict=${report.verdict}`,
    `mapping=${report.mapping.id}@${report.mapping.version} entries=${report.mapping.entryCount} coverage=${report.mapping.coveredTargetCount}/${report.mapping.requiredTargetCount}`,
    ...report.checks.map((item) => `${item.status === "pass" ? "PASS" : "FAIL"}    ${item.id.padEnd(38)}${item.detail}`),
    "",
    JSON.stringify({
      schemaVersion: report.schemaVersion,
      environment: report.environment,
      status: report.status,
      verdict: report.verdict,
      scenarios: report.scenarios.map((item) => ({
        scenario: item.scenario,
        exceptions: item.exceptions,
        exceptionCodes: item.exceptionCodes,
        sourceSystems: item.sourceSystems.length,
        replayIdempotent: item.replay.idempotent,
        passed: item.passed,
      })),
      truthFlags: report.truthFlags,
      failures: report.failures,
    }, null, 2),
  ];
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const seedIndex = process.argv.indexOf("--seed");
  const report = await runIndustrialSimulatorVerification({
    ...(seedIndex >= 0 && process.argv[seedIndex + 1] ? { seed: process.argv[seedIndex + 1]! } : {}),
  });
  console.log(formatSimulatorReport(report));
  process.exit(report.status === "pass" ? 0 : 1);
}
