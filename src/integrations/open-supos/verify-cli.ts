/**
 * `npm run open-supos:verify` —— open supOS 真实运行时验收闸门。
 *
 * 设计原则（与 docs/open-supos-integration.md 的 truth boundary 一致）：
 *   1. 只有真实运行时存在时才可能 PASS；缺少运行时证据一律 BLOCKED/FAIL，绝不猜 PASS。
 *   2. MQTT / 摄入 / 规则 / 异常 / 重放 这组检查直接复用已经过测试的
 *      `runOpenSupOSRuntimeVerification`，不另写一套 ingestion 逻辑。
 *   3. 运行时健康、UNS 可见性、分析投影这三项需要额外证据，缺一项就不能算通过。
 *
 * 退出码：全部 PASS 才 0；BLOCKED 或 FAIL 都返回非 0。
 * 输出不含任何 credential / token / 完整 JWT。
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  runOpenSupOSRuntimeVerification,
  type OpenSupOSRuntimeVerificationSummary,
  type RuntimeVerificationResult,
} from "./runtime-verify.js";

export type GateStatus = "pass" | "fail" | "blocked";

export type GateCheck = {
  id: string;
  label: string;
  status: GateStatus;
  detail: string;
};

export type OpenSupOSVerificationGateReport = {
  schemaVersion: "open-supos-verification-gate/v1";
  status: GateStatus;
  blocker: string | null;
  checks: GateCheck[];
  runtime: OpenSupOSRuntimeVerificationSummary | null;
  startedAt: string;
  completedAt: string;
};

export type GateDependencies = {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  runRuntimeVerification?: () => Promise<RuntimeVerificationResult>;
  runProjectionExport?: (outputPath: string) => { detectedExceptions: number; exceptionTypes: number };
  projectionOutputPath?: string;
  timeoutMs?: number;
  now?: () => Date;
};

const EXPECTED_UNS_MESSAGES = 11;

/** 检查项顺序固定：无论运行时是否可用，报告里都完整出现，避免「没跑就不提」。 */
const CHECK_ORDER: Array<[string, string]> = [
  ["runtime.health", "open supOS runtime health"],
  ["runtime.components", "gateway / emqx / nodered / keycloak / db / minio"],
  ["mqtt.publish", "MQTT publish"],
  ["mqtt.subscribe", "MQTT subscribe"],
  ["connector.ingest", "connector ingest"],
  ["domain.commit", "domain commit (context/entity/event/evidence)"],
  ["rule.evaluated", "rule evaluated"],
  ["exception.created", "exception created"],
  ["replay.idempotent", "duplicate replay safe"],
  ["runtime.real_transport", "MQTT transport is the real runtime"],
  ["uns.data_exists", "UNS holds the published data"],
  ["analytics.projection", "analytics projection updated"],
];

class CheckCollector {
  private readonly collected = new Map<string, GateCheck>();

  set(id: string, status: GateStatus, detail: string) {
    const label = CHECK_ORDER.find(([key]) => key === id)?.[1] ?? id;
    this.collected.set(id, { id, label, status, detail });
  }

  setMany(ids: string[], status: GateStatus, detail: string) {
    for (const id of ids) this.set(id, status, detail);
  }

  ordered(): GateCheck[] {
    return CHECK_ORDER.map(([id, label]) =>
      this.collected.get(id) ?? { id, label, status: "blocked" as GateStatus, detail: "not evaluated" });
  }
}

async function httpOk(input: {
  fetchImpl: typeof fetch;
  url: string;
  timeoutMs: number;
}): Promise<{ ok: boolean; status?: number; detail: string }> {
  try {
    const response = await input.fetchImpl(input.url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(input.timeoutMs),
    });
    if (!response.ok) {
      return { ok: false, status: response.status, detail: `HTTP ${response.status}` };
    }
    return { ok: true, status: response.status, detail: "HTTP 200" };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.name : "request_failed" };
  }
}

function parseComponentHealth(raw: string | undefined) {
  return (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const index = item.indexOf("=");
      if (index <= 0) return null;
      return { name: item.slice(0, index).trim(), url: item.slice(index + 1).trim() };
    })
    .filter((item): item is { name: string; url: string } => Boolean(item?.url));
}

export async function runOpenSupOSVerificationGate(
  dependencies: GateDependencies = {},
): Promise<OpenSupOSVerificationGateReport> {
  const env = dependencies.env ?? process.env;
  const now = dependencies.now ?? (() => new Date());
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const timeoutMs = dependencies.timeoutMs ?? Number(env.OPEN_SUPOS_VERIFY_TIMEOUT_MS || 60_000);
  const startedAt = now().toISOString();
  const collector = new CheckCollector();
  let runtimeSummary: OpenSupOSRuntimeVerificationSummary | null = null;

  // 1. open supOS 运行时健康（gateway / 组件）
  const healthUrl = env.OPEN_SUPOS_RUNTIME_HEALTH_URL?.trim();
  if (!healthUrl) {
    collector.set("runtime.health", "blocked", "OPEN_SUPOS_RUNTIME_HEALTH_URL 未配置：没有运行时证据");
  } else {
    const result = await httpOk({ fetchImpl, url: healthUrl, timeoutMs });
    collector.set("runtime.health", result.ok ? "pass" : "fail", result.detail);
  }
  const components = parseComponentHealth(env.OPEN_SUPOS_COMPONENT_HEALTH);
  if (components.length === 0) {
    collector.set("runtime.components", "blocked", "OPEN_SUPOS_COMPONENT_HEALTH 未配置：无法证明核心组件健康");
  } else {
    const failures: string[] = [];
    for (const component of components) {
      const result = await httpOk({ fetchImpl, url: component.url, timeoutMs });
      if (!result.ok) failures.push(`${component.name}:${result.detail}`);
    }
    collector.set(
      "runtime.components",
      failures.length === 0 ? "pass" : "fail",
      failures.length === 0 ? `${components.length} components healthy` : failures.join(" "),
    );
  }

  // 2. MQTT + 摄入 + 领域写入 + 规则 + 异常 + 重放（复用已测试的 harness）
  const runRuntime = dependencies.runRuntimeVerification
    ?? (() => runOpenSupOSRuntimeVerification({ env }));
  let runtimeResult: RuntimeVerificationResult;
  try {
    runtimeResult = await runRuntime();
  } catch (error) {
    const code = error instanceof Error ? error.message : "runtime_verification_failed";
    collector.setMany([
      "mqtt.publish",
      "mqtt.subscribe",
      "connector.ingest",
      "domain.commit",
      "rule.evaluated",
      "exception.created",
      "replay.idempotent",
      "runtime.real_transport",
      "uns.data_exists",
      "analytics.projection",
    ], "blocked", code);
    const checks = collector.ordered();
    return {
      schemaVersion: "open-supos-verification-gate/v1",
      status: "blocked",
      blocker: code,
      checks,
      runtime: null,
      startedAt,
      completedAt: now().toISOString(),
    };
  }

  if (runtimeResult.status === "disabled") {
    collector.setMany([
      "mqtt.publish",
      "mqtt.subscribe",
      "connector.ingest",
      "domain.commit",
      "rule.evaluated",
      "exception.created",
      "replay.idempotent",
      "runtime.real_transport",
      "uns.data_exists",
      "analytics.projection",
    ], "blocked", "OPEN_SUPOS_ENABLED != true");
  } else {
    const report = runtimeResult.report;
    runtimeSummary = runtimeResult.summary;
    collector.set("mqtt.publish", report.brokerProbeRoundTrip && report.messagesPublished === EXPECTED_UNS_MESSAGES ? "pass" : "fail", `published=${report.messagesPublished} brokerProbe=${report.brokerProbeRoundTrip}`);
    collector.set("mqtt.subscribe", report.mqttConnected && report.mqttSubscribed ? "pass" : "fail", `connected=${report.mqttConnected} subscribed=${report.mqttSubscribed}`);
    collector.set("connector.ingest", report.messagesIngested === EXPECTED_UNS_MESSAGES ? "pass" : "fail", `ingested=${report.messagesIngested}/${EXPECTED_UNS_MESSAGES}`);
    collector.set("domain.commit", report.domain.events === 11 && report.domain.evidence === 11 ? "pass" : "fail", `events=${report.domain.events} evidence=${report.domain.evidence} entities=${report.domain.entities}`);
    collector.set("rule.evaluated", report.rules.evaluations === 7 ? "pass" : "fail", `evaluations=${report.rules.evaluations} matched=${report.rules.matched} notMatched=${report.rules.notMatched}`);
    collector.set("exception.created", report.rules.exceptions === 4 ? "pass" : "fail", `exceptions=${report.rules.exceptions}`);
    collector.set("replay.idempotent", report.duplicateBatchStable ? "pass" : "fail", `duplicateBatchStable=${report.duplicateBatchStable}`);
    if (runtimeResult.status === "simulated") {
      collector.set("runtime.real_transport", "fail", "注入式 transport 不算真实运行时");
    } else {
      collector.set("runtime.real_transport", "pass", "real mqtt transport");
    }

    // 3. UNS 中确实有数据（open supOS 侧可查询/可见）
    const unsUrl = env.OPEN_SUPOS_UNS_VERIFY_URL?.trim();
    if (!unsUrl) {
      collector.set("uns.data_exists", "blocked", "OPEN_SUPOS_UNS_VERIFY_URL 未配置：无法证明数据进入 open supOS UNS");
    } else {
      try {
        const response = await fetchImpl(unsUrl, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
        const body = await response.text();
        const missing = report.receipts
          .map((receipt) => receipt.messageId)
          .filter((messageId) => !body.includes(messageId));
        const ok = response.ok && missing.length === 0;
        collector.set(
          "uns.data_exists",
          ok ? "pass" : "fail",
          ok ? `all ${report.receipts.length} messageIds visible in UNS` : `HTTP ${response.status} missing=${missing.length}`,
        );
      } catch (error) {
        collector.set("uns.data_exists", "fail", error instanceof Error ? error.name : "request_failed");
      }
    }

    // 4. 分析投影里能看到这批异常
    if (env.OPEN_SUPOS_PROJECTION_VERIFY !== "true") {
      collector.set("analytics.projection", "blocked", "OPEN_SUPOS_PROJECTION_VERIFY != true");
    } else {
      const outputPath = resolve(dependencies.projectionOutputPath ?? ".preview/open-supos/projection.sql");
      const runExport = dependencies.runProjectionExport ?? defaultProjectionExport;
      try {
        const exported = runExport(outputPath);
        const expected = Number(env.OPEN_SUPOS_EXPECTED_EXCEPTIONS || "4");
        const ok = exported.detectedExceptions >= expected && existsSync(outputPath);
        collector.set(
          "analytics.projection",
          ok ? "pass" : "fail",
          `detectedExceptions=${exported.detectedExceptions} expected>=${expected} exceptionTypes=${exported.exceptionTypes}`,
        );
      } catch (error) {
        collector.set("analytics.projection", "fail", error instanceof Error ? error.message : "export_failed");
      }
    }
  }

  const checks = collector.ordered();
  const failed = checks.filter((item) => item.status === "fail");
  const blocked = checks.filter((item) => item.status === "blocked");
  const status: GateStatus = failed.length > 0 ? "fail" : blocked.length > 0 ? "blocked" : "pass";
  return {
    schemaVersion: "open-supos-verification-gate/v1",
    status,
    blocker: status === "pass"
      ? null
      : failed[0]
        ? `CHECK_FAILED:${failed[0].id}`
        : `CHECK_BLOCKED:${blocked[0]!.id}`,
    checks,
    runtime: runtimeSummary,
    startedAt,
    completedAt: now().toISOString(),
  };
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

export function formatGateReport(report: OpenSupOSVerificationGateReport) {
  const symbol: Record<GateStatus, string> = { pass: "PASS", fail: "FAIL", blocked: "BLOCKED" };
  const lines = report.checks.map((item) => `${symbol[item.status].padEnd(8)}${item.id.padEnd(24)}${item.detail}`);
  lines.push("");
  lines.push(JSON.stringify({
    schemaVersion: report.schemaVersion,
    status: report.status,
    blocker: report.blocker,
    checks: report.checks.length,
    failed: report.checks.filter((item) => item.status === "fail").map((item) => item.id),
    blocked: report.checks.filter((item) => item.status === "blocked").map((item) => item.id),
  }, null, 2));
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = await runOpenSupOSVerificationGate();
  console.log(formatGateReport(report));
  process.exit(report.status === "pass" ? 0 : 1);
}
