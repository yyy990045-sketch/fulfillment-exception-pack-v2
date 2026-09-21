/**
 * `npm run evidence:verify -- --context <contextId>`
 *
 * 逐条证据检查回源链：
 *
 *   Evidence → Source Ledger → rawHash → mappingVersion → sourceLocator → Canonical Event → 来源系统
 *
 * 全部成立 → `EVIDENCE_TRACE_VERIFIED`（退出码 0）
 * 任意断链 → `FAIL`（退出码 1）
 *
 * 拿不到留存载荷时**不算通过**：没有载荷就没有"rawHash 与内容一致"这句话。
 */
import { join, resolve } from "node:path";
import { DEMO_SIMULATION_TENANT } from "../simulator/manufacturing/emitter.js";
import { JUDGE_WORKSPACE_DIR, openExistingJudgeStore } from "../demo/judge/workspace.js";
import { UNS_STREAM_ARTIFACT_NAME, buildEvidenceTrace, type EvidenceTraceReport } from "./index.js";

export type EvidenceVerifyOptions = {
  context: string | null;
  exception: string | null;
  tenant: string;
  storePath: string;
  streamPath: string;
  json: boolean;
};

function valueOf(argv: string[], flag: string) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

export function parseEvidenceVerifyArgs(argv: string[]): EvidenceVerifyOptions {
  const workspace = resolve(valueOf(argv, "--workspace") ?? JUDGE_WORKSPACE_DIR);
  return {
    context: valueOf(argv, "--context") ?? null,
    exception: valueOf(argv, "--exception") ?? null,
    tenant: valueOf(argv, "--tenant") ?? DEMO_SIMULATION_TENANT,
    storePath: resolve(valueOf(argv, "--store") ?? join(workspace, "pack-cases.sqlite")),
    streamPath: resolve(valueOf(argv, "--stream") ?? join(workspace, UNS_STREAM_ARTIFACT_NAME)),
    json: argv.includes("--json"),
  };
}

export function formatEvidenceTrace(report: EvidenceTraceReport) {
  const lines: string[] = [
    `context=${report.contextId} exception=${report.exceptionId ?? "-"} provenance=${report.provenanceMode}`,
    `payloadSource=${report.payloadSource.path ?? "-"} available=${report.payloadSource.available} entries=${report.payloadSource.entries}`,
    `chain=${report.hops.join(" → ")}`,
    "",
  ];
  for (const link of report.evidence) {
    lines.push(`EVIDENCE ${link.evidenceId}  ${link.field}=${String(link.value)} (${link.valueType})  role=${link.role}  source=${link.sourceSystemId}  provenance=${link.provenanceClass}`);
    lines.push(`  ledger   ${link.ledger ? link.ledger.recordId : "MISSING"}`);
    if (link.ledger) {
      lines.push(`  rawHash  declared=${link.ledger.rawHash.slice(0, 16)}… recomputed=${link.ledger.rawHashRecomputed?.slice(0, 16) ?? "n/a"}…`);
      lines.push(`  mapping  ${link.ledger.mappingId}@${link.ledger.mappingVersion}`);
      lines.push(`  topic    ${link.unsTopic ?? "MISSING"}`);
      lines.push(`  canonical ${link.canonicalEventId ?? "MISSING"}`);
    }
    for (const check of link.checks) {
      lines.push(`  ${check.status === "pass" ? "✓" : "✗"} ${check.id.padEnd(24)} ${check.detail}`);
    }
    lines.push("");
  }
  if (report.failures.length) {
    lines.push("failures:");
    for (const failure of report.failures) lines.push(`  - ${failure}`);
    lines.push("");
  }
  if (report.platformObservedCount) {
    lines.push(`note: ${report.platformObservedCount} 条证据为平台自观测（例如执行后回读），不主张连接器来源，也不能作为决策依据。`);
    lines.push("");
  }
  lines.push(`status=${report.status}`);
  lines.push(report.status);
  return lines.join("\n");
}

function verifyOne(options: EvidenceVerifyOptions, contextId: string, store: ReturnType<typeof openExistingJudgeStore>["store"]) {
  return buildEvidenceTrace({
    store,
    tenantId: options.tenant,
    contextId,
    exceptionId: options.exception,
    payloadSourcePath: options.streamPath,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseEvidenceVerifyArgs(process.argv.slice(2));
  let handle: ReturnType<typeof openExistingJudgeStore> | null = null;
  try {
    handle = openExistingJudgeStore(options.storePath);
    const contextIds = options.context
      ? [options.context]
      : handle.store.listContexts(options.tenant).map((item) => item.id);
    if (!contextIds.length) {
      console.error(`NO_CONTEXT_FOUND tenant=${options.tenant} store=${options.storePath}（先运行 npm run demo:judge）`);
      process.exit(1);
    }
    const reports = contextIds.map((contextId) => verifyOne(options, contextId, handle!.store));
    for (const report of reports) {
      console.log(formatEvidenceTrace(report));
      console.log("");
    }
    if (options.json) console.log(JSON.stringify(reports, null, 2));
    const failed = reports.filter((item) => item.status !== "EVIDENCE_TRACE_VERIFIED");
    if (failed.length) {
      console.error(`FAIL: ${failed.length}/${reports.length} context(s) not verified`);
      process.exit(1);
    }
    console.log(`EVIDENCE_TRACE_VERIFIED (${reports.length}/${reports.length}) — 断链 0；平台自观测 ${reports.reduce((sum, item) => sum + item.platformObservedCount, 0)} 条（不作为决策依据）`);
    process.exit(0);
  } catch (error) {
    console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  } finally {
    handle?.close();
  }
}
