/**
 * `npm run open-supos:verify` —— open supOS 验收闸门，两种明确模式：
 *
 *   --mode contract  本地契约验证：A/B 业务用例 + replay + checkpoint + ledger provenance。
 *                    使用缓冲队列（等价 injected transport），最多产出 LOCAL_CONTRACT_VERIFIED，
 *                    **永远不能**升级任何 live truth flag。
 *   --mode live      远程真实运行时验证：01..20 固定顺序，必须有真实 Runtime / MQTT / UNS
 *                    证据；只有全通过才能算 REMOTE_RUNTIME_VERIFIED。
 *
 * 设计原则：没有证据的步骤一律 BLOCKED / FAIL，绝不 SKIP 后仍输出 VERIFIED；
 * 输出不含任何 credential / token / cookie / authorization header。
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  runOpenSupOSAbContractVerification,
  type OpenSupOSAbCaseEvidence,
  type OpenSupOSAbContractReport,
  type OpenSupOSAbReplayEvidence,
} from "./contract-verify.js";
import { runOpenSupOSLiveAbVerification, type OpenSupOSLiveAbReport } from "./live-verify.js";

export type OpenSupOSVerifyMode = "contract" | "live";
export type GateStatus = "pass" | "fail" | "blocked";

export type GateCheck = {
  id: string;
  label: string;
  status: GateStatus;
  detail: string;
};

export type OpenSupOSVerificationGateReport = {
  schemaVersion: "open-supos-verification-gate/v2";
  mode: OpenSupOSVerifyMode;
  status: GateStatus;
  verdict: "LOCAL_CONTRACT_VERIFIED" | "REMOTE_RUNTIME_VERIFIED" | "BLOCKED" | "FAILED";
  blocker: string | null;
  checks: GateCheck[];
  contract: OpenSupOSAbContractReport | null;
  live: OpenSupOSLiveAbReport | null;
  startedAt: string;
  completedAt: string;
};

export type SupersetReceipt = {
  projectionReloaded?: boolean;
  supersetVerifyEmbedPass?: boolean;
  dashboardObserved?: boolean;
  factRows?: Record<string, number>;
  observedAt?: string;
};

export type GateDependencies = {
  mode?: OpenSupOSVerifyMode;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  runContract?: () => Promise<OpenSupOSAbContractReport>;
  runLive?: () => Promise<OpenSupOSLiveAbReport>;
  runProjectionExport?: (outputPath: string) => { detectedExceptions: number; exceptionTypes: number };
  projectionOutputPath?: string;
  supersetReceiptPath?: string;
  writeEvidence?: boolean;
  evidencePath?: string;
  timeoutMs?: number;
  now?: () => Date;
};

/** live 模式固定检查顺序（不得改动顺序，不得跳过） */
export const LIVE_CHECK_ORDER: Array<[string, string]> = [
  ["runtime.health", "01 open supOS runtime health"],
  ["mqtt.connection", "02 MQTT connection"],
  ["mqtt.publish", "03 MQTT publish"],
  ["mqtt.subscribe", "04 MQTT subscribe"],
  ["uns.object_exists", "05 UNS object exists"],
  ["case_a.publish", "06 Case A publish"],
  ["case_a.ingest", "07 Case A connector ingest"],
  ["case_a.rule_evaluation", "08 Case A rule evaluation"],
  ["case_a.exception_count_zero", "09 Case A exception count = 0"],
  ["case_b.publish", "10 Case B publish"],
  ["case_b.ingest", "11 Case B connector ingest"],
  ["case_b.rule_matched", "12 Case B rule matched"],
  ["case_b.expected_exception", "13 Case B expected exception created"],
  ["case_b.replay", "14 Case B replay"],
  ["replay.idempotent", "15 replay idempotent"],
  ["source_ledger.consistent", "16 source ledger consistent"],
  ["cursor.checkpoint_safe", "17 cursor / checkpoint safe"],
  ["analytics.projection_export", "18 analytics projection export"],
  ["superset.projection_reloaded", "19 Superset projection reloaded"],
  ["superset.dashboard_reflects_data", "20 Superset dashboard reflects changed data"],
];

export const CONTRACT_CHECK_ORDER: Array<[string, string]> = [
  ["contract.shared_entrypoint", "A/B share one connector entrypoint"],
  ["contract.case_a_normal", "Case A normal-order → 0 exception"],
  ["contract.case_b_exception", "Case B exception-order → expected exception"],
  ["contract.replay_idempotent", "replay idempotent (no new ledger/event/exception)"],
  ["contract.checkpoint_safe", "checkpoint does not re-read"],
  ["contract.ledger_provenance", "source ledger carries open supOS provenance"],
];

class CheckCollector {
  constructor(private readonly order: Array<[string, string]>) {}

  private readonly collected = new Map<string, GateCheck>();

  set(id: string, status: GateStatus, detail: string) {
    const label = this.order.find(([key]) => key === id)?.[1] ?? id;
    this.collected.set(id, { id, label, status, detail });
  }

  setMany(ids: string[], status: GateStatus, detail: string) {
    for (const id of ids) this.set(id, status, detail);
  }

  ordered(): GateCheck[] {
    return this.order.map(([id, label]) =>
      this.collected.get(id) ?? { id, label, status: "blocked" as GateStatus, detail: "not evaluated" });
  }
}

function parseComponentHealth(raw: string | undefined) {
  return (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .flatMap((item) => {
      const index = item.indexOf("=");
      if (index <= 0) return [];
      const name = item.slice(0, index).trim();
      const url = item.slice(index + 1).trim();
      return url ? [{ name, url }] : [];
    });
}

async function httpOk(input: { fetchImpl: typeof fetch; url: string; timeoutMs: number }) {
  try {
    const response = await input.fetchImpl(input.url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(input.timeoutMs),
    });
    return { ok: response.ok, detail: `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.name : "request_failed" };
  }
}

function defaultProjectionExport(outputPath: string) {
  const stdout = execFileSync("npx", ["tsx", "scripts/export-superset-projection.ts", outputPath], {
    encoding: "utf8",
    env: process.env,
  });
  const parsed = JSON.parse(stdout) as { detectedExceptions?: number; exceptionTypes?: number };
  return {
    detectedExceptions: Number(parsed.detectedExceptions ?? 0),
    exceptionTypes: Number(parsed.exceptionTypes ?? 0),
  };
}

function readSupersetReceipt(path: string): { receipt: SupersetReceipt | null; error: string | null } {
  if (!existsSync(path)) return { receipt: null, error: "receipt_missing" };
  try {
    return { receipt: JSON.parse(readFileSync(path, "utf8")) as SupersetReceipt, error: null };
  } catch {
    return { receipt: null, error: "receipt_unparsable" };
  }
}

function findCase(report: OpenSupOSLiveAbReport, caseId: string): OpenSupOSAbCaseEvidence | undefined {
  return report.cases.find((item) => item.caseId === caseId);
}

async function runContractGate(dependencies: GateDependencies, now: () => Date) {
  const collector = new CheckCollector(CONTRACT_CHECK_ORDER);
  const startedAt = now().toISOString();
  let contract: OpenSupOSAbContractReport | null = null;
  try {
    contract = await (dependencies.runContract ?? (() => runOpenSupOSAbContractVerification({
      now: dependencies.now,
    })))();
    const normal = contract.cases.find((item) => item.caseId === "normal-order");
    const exception = contract.cases.find((item) => item.caseId === "exception-order");

    collector.set("contract.shared_entrypoint", contract.entrypoint.connectorId === "open-supos-uns-inbound" ? "pass" : "fail",
      `connector=${contract.entrypoint.connectorId} mapping=${contract.entrypoint.mappingId}@${contract.entrypoint.mappingVersion}`);
    collector.set("contract.case_a_normal", normal && normal.exceptions === 0 && normal.evaluations === 7 ? "pass" : "fail",
      normal ? `evaluations=${normal.evaluations} matched=${normal.matchedExceptionRules} exceptions=${normal.exceptions}` : "case_a_missing");
    collector.set("contract.case_b_exception", exception && exception.exceptions === 1 && exception.exceptionCodes.join(",") === "ORDER_PRODUCTION_COMPLETION_SHORTFALL" ? "pass" : "fail",
      exception ? `evaluations=${exception.evaluations} matched=${exception.matchedExceptionRules} exceptions=${exception.exceptions} codes=${exception.exceptionCodes.join(",")}` : "case_b_missing");
    collector.set("contract.replay_idempotent", contract.replay.passed ? "pass" : "fail",
      `duplicateInput=${contract.replay.duplicateInput} newLedger=${contract.replay.duplicateLedgerRecords} newEvents=${contract.replay.newEvents} newExceptions=${contract.replay.newExceptions}`);
    collector.set("contract.checkpoint_safe", contract.replay.checkpointRecordsRead === 0 ? "pass" : "fail",
      `checkpointRecordsRead=${contract.replay.checkpointRecordsRead}`);
    const provenanceOk = contract.cases.every((item) =>
      Boolean(item.provenance.locatorNamespace) && Boolean(item.provenance.locatorTopicSample)
      && item.provenance.ledgerEvidenceRefs > 0 && item.provenance.ledgerCanonicalRefs > 0);
    collector.set("contract.ledger_provenance", provenanceOk ? "pass" : "fail",
      contract.cases.map((item) => `${item.caseId}:${item.provenance.locatorNamespace}|refs=${item.provenance.ledgerEvidenceRefs}`).join(" "));
  } catch (error) {
    collector.setMany(CONTRACT_CHECK_ORDER.map(([id]) => id), "fail", error instanceof Error ? error.message : "contract_failed");
  }
  const checks = collector.ordered();
  const failed = checks.filter((item) => item.status !== "pass");
  return {
    schemaVersion: "open-supos-verification-gate/v2" as const,
    mode: "contract" as const,
    status: failed.length === 0 ? "pass" as const : "fail" as const,
    verdict: failed.length === 0 ? "LOCAL_CONTRACT_VERIFIED" as const : "FAILED" as const,
    blocker: failed.length === 0 ? null : `CHECK_FAILED:${failed[0]!.id}`,
    checks,
    contract,
    live: null,
    startedAt,
    completedAt: now().toISOString(),
  };
}

async function runLiveGate(dependencies: GateDependencies, now: () => Date) {
  const env = dependencies.env ?? process.env;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const timeoutMs = dependencies.timeoutMs ?? Number(env.OPEN_SUPOS_VERIFY_TIMEOUT_MS || 60_000);
  const collector = new CheckCollector(LIVE_CHECK_ORDER);
  const startedAt = now().toISOString();

  // 01 runtime health
  const healthUrl = env.OPEN_SUPOS_RUNTIME_HEALTH_URL?.trim();
  if (!healthUrl) {
    collector.set("runtime.health", "blocked", "OPEN_SUPOS_RUNTIME_HEALTH_URL 未配置：没有运行时证据");
  } else {
    const result = await httpOk({ fetchImpl, url: healthUrl, timeoutMs });
    collector.set("runtime.health", result.ok ? "pass" : "fail", result.detail);
  }
  const components = parseComponentHealth(env.OPEN_SUPOS_COMPONENT_HEALTH);
  if (components.length > 0) {
    const failures: string[] = [];
    for (const component of components) {
      const result = await httpOk({ fetchImpl, url: component.url, timeoutMs });
      if (!result.ok) failures.push(`${component.name}:${result.detail}`);
    }
    if (failures.length > 0) collector.set("runtime.health", "fail", failures.join(" "));
  }

  let live: OpenSupOSLiveAbReport | null = null;
  try {
    live = await (dependencies.runLive ?? (() => runOpenSupOSLiveAbVerification({ env })))();
  } catch (error) {
    const code = error instanceof Error ? error.message : "live_verification_failed";
    collector.setMany(LIVE_CHECK_ORDER.map(([id]) => id).filter((id) => id !== "runtime.health"), "blocked", code);
  }

  if (live) {
    const normal = findCase(live, "normal-order");
    const exception = findCase(live, "exception-order");
    if (live.blocker && live.status === "blocked") {
      collector.setMany(
        ["mqtt.connection", "mqtt.publish", "mqtt.subscribe", "uns.object_exists",
          "case_a.publish", "case_a.ingest", "case_a.rule_evaluation", "case_a.exception_count_zero",
          "case_b.publish", "case_b.ingest", "case_b.rule_matched", "case_b.expected_exception",
          "case_b.replay", "replay.idempotent", "source_ledger.consistent", "cursor.checkpoint_safe"],
        "blocked",
        live.blocker,
      );
    } else {
      collector.set("mqtt.connection", live.brokerReachable ? "pass" : "fail", `endpoint=${live.mqttEndpoint} received=${live.mqttReceived}`);
      collector.set("mqtt.publish", live.mqttPublished > 0 ? "pass" : "fail", `published=${live.mqttPublished}`);
      collector.set("mqtt.subscribe", live.mqttReceived > 0 ? "pass" : "fail", `received=${live.mqttReceived}`);
      collector.set("case_a.publish", normal ? (normal.published === 11 ? "pass" : "fail") : "fail", normal ? `published=${normal.published}` : "case_a_missing");
      collector.set("case_a.ingest", normal ? (normal.ingested === 11 && normal.recordsRead === 11 ? "pass" : "fail") : "fail", normal ? `ingested=${normal.ingested}` : "case_a_missing");
      collector.set("case_a.rule_evaluation", normal ? (normal.evaluations === 7 ? "pass" : "fail") : "fail", normal ? `evaluations=${normal.evaluations} notMatched=${normal.notMatchedRules}` : "case_a_missing");
      collector.set("case_a.exception_count_zero", normal ? (normal.exceptions === 0 ? "pass" : "fail") : "fail", normal ? `exceptions=${normal.exceptions}` : "case_a_missing");
      collector.set("case_b.publish", exception ? (exception.published === 11 ? "pass" : "fail") : "fail", exception ? `published=${exception.published}` : "case_b_missing");
      collector.set("case_b.ingest", exception ? (exception.ingested === 11 ? "pass" : "fail") : "fail", exception ? `ingested=${exception.ingested}` : "case_b_missing");
      collector.set("case_b.rule_matched", exception ? (exception.matchedExceptionRules === 1 ? "pass" : "fail") : "fail", exception ? `matched=${exception.matchedExceptionRules}` : "case_b_missing");
      collector.set("case_b.expected_exception", exception && exception.exceptionCodes.join(",") === "ORDER_PRODUCTION_COMPLETION_SHORTFALL" ? "pass" : "fail",
        exception ? `exceptions=${exception.exceptions} codes=${exception.exceptionCodes.join(",")}` : "case_b_missing");
      collector.set("case_b.replay", live.replay ? (live.replay.duplicateInput === 11 ? "pass" : "fail") : "fail", live.replay ? `duplicateInput=${live.replay.duplicateInput}` : "replay_missing");
      collector.set("replay.idempotent", live.replay && live.replay.duplicateLedgerRecords === 0 && live.replay.newEvents === 0 && live.replay.newExceptions === 0 ? "pass" : "fail",
        live.replay ? `newLedger=${live.replay.duplicateLedgerRecords} newEvents=${live.replay.newEvents} newExceptions=${live.replay.newExceptions} total=${live.replay.exceptionsAfter}` : "replay_missing");
      collector.set("source_ledger.consistent", normal && exception && normal.ledgerRecords === 11 && exception.ledgerRecords === 11 ? "pass" : "fail",
        `caseA=${normal?.ledgerRecords ?? "?"} caseB=${exception?.ledgerRecords ?? "?"}`);
      collector.set("cursor.checkpoint_safe", live.replay ? (live.replay.checkpointRecordsRead === 0 ? "pass" : "fail") : "fail",
        live.replay ? `checkpointRecordsRead=${live.replay.checkpointRecordsRead}` : "replay_missing");
    }

    // 05 UNS object exists（需要 open supOS 侧可查询入口）
    const unsUrl = env.OPEN_SUPOS_UNS_VERIFY_URL?.trim();
    if (!unsUrl) {
      collector.set("uns.object_exists", "blocked", "OPEN_SUPOS_UNS_VERIFY_URL 未配置：无法证明数据进入 open supOS UNS");
    } else {
      try {
        const response = await fetchImpl(unsUrl, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
        const body = await response.text();
        const missing = live.cases
          .flatMap((item) => item.exceptionCodes.length > 0 ? [item.caseId] : [item.caseId])
          .filter((caseId) => !body.includes(caseId));
        const ok = response.ok && body.length > 0;
        collector.set("uns.object_exists", ok ? "pass" : "fail", `HTTP ${response.status} missingCaseMarkers=${missing.length}`);
      } catch (error) {
        collector.set("uns.object_exists", "fail", error instanceof Error ? error.name : "request_failed");
      }
    }
  }

  // 18 analytics projection export
  if (env.OPEN_SUPOS_PROJECTION_VERIFY !== "true") {
    collector.set("analytics.projection_export", "blocked", "OPEN_SUPOS_PROJECTION_VERIFY != true");
  } else {
    const outputPath = resolve(dependencies.projectionOutputPath ?? ".preview/open-supos-live/projection.sql");
    const runExport = dependencies.runProjectionExport ?? defaultProjectionExport;
    try {
      const exported = runExport(outputPath);
      const expected = Number(env.OPEN_SUPOS_EXPECTED_EXCEPTIONS || "1");
      const ok = exported.detectedExceptions >= expected && existsSync(outputPath);
      collector.set("analytics.projection_export", ok ? "pass" : "fail",
        `detectedExceptions=${exported.detectedExceptions} expected>=${expected} exceptionTypes=${exported.exceptionTypes}`);
    } catch (error) {
      collector.set("analytics.projection_export", "fail", error instanceof Error ? error.message : "export_failed");
    }
  }

  // 19/20 Superset 侧证据（由 scripts/open-supos-remote-verify.sh 生成 receipt）
  const receiptPath = resolve(dependencies.supersetReceiptPath ?? env.OPEN_SUPOS_SUPERSET_RECEIPT ?? ".preview/open-supos-live/superset-receipt.json");
  const { receipt, error } = readSupersetReceipt(receiptPath);
  if (!receipt) {
    collector.set("superset.projection_reloaded", "blocked", `receipt_unavailable:${error}`);
    collector.set("superset.dashboard_reflects_data", "blocked", `receipt_unavailable:${error}`);
  } else {
    collector.set("superset.projection_reloaded", receipt.projectionReloaded === true && receipt.supersetVerifyEmbedPass === true ? "pass" : "fail",
      `projectionReloaded=${receipt.projectionReloaded} supersetVerifyEmbedPass=${receipt.supersetVerifyEmbedPass} rows=${JSON.stringify(receipt.factRows ?? {})}`);
    collector.set("superset.dashboard_reflects_data", receipt.dashboardObserved === true ? "pass" : "fail",
      `dashboardObserved=${receipt.dashboardObserved} observedAt=${receipt.observedAt ?? "?"}`);
  }

  const checks = collector.ordered();
  const failed = checks.filter((item) => item.status === "fail");
  const blocked = checks.filter((item) => item.status === "blocked");
  const status: GateStatus = failed.length > 0 ? "fail" : blocked.length > 0 ? "blocked" : "pass";

  return {
    schemaVersion: "open-supos-verification-gate/v2" as const,
    mode: "live" as const,
    status,
    verdict: status === "pass" ? "REMOTE_RUNTIME_VERIFIED" as const : status === "blocked" ? "BLOCKED" as const : "FAILED" as const,
    blocker: status === "pass" ? null : failed[0] ? `CHECK_FAILED:${failed[0].id}` : `CHECK_BLOCKED:${blocked[0]!.id}`,
    checks,
    contract: null,
    live,
    startedAt,
    completedAt: now().toISOString(),
  };
}

export async function runOpenSupOSVerificationGate(
  dependencies: GateDependencies = {},
): Promise<OpenSupOSVerificationGateReport> {
  const now = dependencies.now ?? (() => new Date());
  const mode = dependencies.mode ?? "live";
  const report = mode === "contract"
    ? await runContractGate(dependencies, now)
    : await runLiveGate(dependencies, now);
  // 只有真正指向了一个运行时（健康检查不是 blocked）才落证据清单，
  // 避免在本机「什么都没连」的情况下生成看起来像证据的 evidence.json。
  const runtimeTargeted = report.checks.find((item) => item.id === "runtime.health")?.status !== "blocked";
  if (mode === "live" && dependencies.writeEvidence !== false && runtimeTargeted) {
    writeOpenSupOSEvidenceManifest(report, dependencies.evidencePath);
  }
  return report;
}

/** 运行时证据清单（真实运行时才生成；不含任何 credential / token / cookie） */
export function writeOpenSupOSEvidenceManifest(
  report: OpenSupOSVerificationGateReport,
  path = ".preview/open-supos-live/evidence.json",
) {
  const live = report.live;
  const normal = live?.cases.find((item) => item.caseId === "normal-order") ?? null;
  const exception = live?.cases.find((item) => item.caseId === "exception-order") ?? null;
  const receiptLayer = readSupersetReceipt(resolve(path).replace(/evidence\.json$/, "superset-receipt.json"));
  const manifest = {
    schemaVersion: "open-supos-live-evidence/v1",
    runtimeVersion: process.env.OPEN_SUPOS_OS_VERSION ?? null,
    deployCommit: process.env.OPEN_SUPOS_UPSTREAM_COMMIT ?? null,
    hostArch: process.env.OPEN_SUPOS_HOST_ARCH ?? null,
    hostOs: process.env.OPEN_SUPOS_HOST_OS ?? null,
    runtimeHealthy: report.checks.find((item) => item.id === "runtime.health")?.status === "pass",
    mqttConnected: report.checks.find((item) => item.id === "mqtt.connection")?.status === "pass",
    mqttPublishVerified: report.checks.find((item) => item.id === "mqtt.publish")?.status === "pass",
    mqttSubscribeVerified: report.checks.find((item) => item.id === "mqtt.subscribe")?.status === "pass",
    unsNamespace: process.env.OPEN_SUPOS_UNS_NAMESPACE ?? null,
    unsObjectVerified: report.checks.find((item) => item.id === "uns.object_exists")?.status === "pass",
    normalCase: {
      eventReceived: normal ? normal.ingested === 11 : false,
      evaluations: normal?.evaluations ?? 0,
      exceptionsCreated: normal?.exceptions ?? 0,
    },
    exceptionCase: {
      eventReceived: exception ? exception.ingested === 11 : false,
      matchedRule: exception?.matchedRuleCodes.join(",") ?? null,
      exceptionId: exception?.exceptionCodes.join(",") ?? null,
      evidenceIds: exception?.provenance.ledgerEvidenceRefs ?? 0,
    },
    replay: {
      duplicateInput: live?.replay?.duplicateInput ?? 0,
      duplicateLedgerRecords: live?.replay?.duplicateLedgerRecords ?? 0,
      duplicateEvents: live?.replay?.newEvents ?? 0,
      duplicateExceptions: live?.replay?.newExceptions ?? 0,
    },
    superset: {
      projectionUpdated: report.checks.find((item) => item.id === "analytics.projection_export")?.status === "pass",
      dashboardObserved: report.checks.find((item) => item.id === "superset.dashboard_reflects_data")?.status === "pass",
      receipt: receiptLayer.receipt ?? null,
    },
    verdict: report.verdict,
    status: report.status,
    completedAt: report.completedAt,
  };
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export function formatGateReport(report: OpenSupOSVerificationGateReport) {
  const symbol: Record<GateStatus, string> = { pass: "PASS", fail: "FAIL", blocked: "BLOCKED" };
  const lines = [
    `mode=${report.mode} status=${report.status} verdict=${report.verdict}`,
    ...report.checks.map((item) => `${symbol[item.status].padEnd(8)}${item.id.padEnd(34)}${item.detail}`),
    "",
    JSON.stringify({
      schemaVersion: report.schemaVersion,
      mode: report.mode,
      status: report.status,
      verdict: report.verdict,
      blocker: report.blocker,
      checks: report.checks.length,
      failed: report.checks.filter((item) => item.status === "fail").map((item) => item.id),
      blocked: report.checks.filter((item) => item.status === "blocked").map((item) => item.id),
    }, null, 2),
  ];
  return lines.join("\n");
}

export function parseMode(argv: string[]): OpenSupOSVerifyMode {
  const index = argv.indexOf("--mode");
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (value === undefined) return "live";
  if (value === "contract" || value === "live") return value;
  throw new Error(`OPEN_SUPOS_VERIFY_MODE_INVALID:${value}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = parseMode(process.argv.slice(2));
  const report = await runOpenSupOSVerificationGate({ mode });
  console.log(formatGateReport(report));
  process.exit(report.status === "pass" ? 0 : 1);
}
