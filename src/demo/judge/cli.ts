/**
 * `npm run demo:judge` —— 比赛演示编排器 CLI。
 *
 *   npm run demo:judge                                  # 主场景 production-shortfall
 *   npm run demo:judge -- --scenario evidence-broken    # 备用：证据不可回源时被闸门阻止
 *   npm run demo:judge -- --json                        # 输出完整 judge manifest（机器可读）
 *   npm run demo:judge -- --ai none                     # 完全关闭 AI，仍能跑完整条链
 *
 * 输出是给评委看的分阶段文字（INPUT / PROCESS / OUTPUT / PROOF），不是一坨 JSON。
 */
import { JUDGE_SCENARIOS, JUDGE_BUSINESS_QUESTION, runJudgeDemo, type JudgeDemoResult, type JudgeStageResult } from "./runner.js";

export type JudgeCliOptions = {
  scenario: string;
  seed: string | null;
  speed: number;
  workspace: string;
  ai: "deterministic" | "configured" | "none";
  json: boolean;
  quiet: boolean;
};

function valueOf(argv: string[], flag: string) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

export function parseJudgeArgs(argv: string[]): JudgeCliOptions {
  const scenario = valueOf(argv, "--scenario") ?? "production-shortfall";
  if (!JUDGE_SCENARIOS.includes(scenario as never)) {
    throw new Error(`UNKNOWN_JUDGE_SCENARIO:${scenario}:expected=${JUDGE_SCENARIOS.join("|")}`);
  }
  const ai = (valueOf(argv, "--ai") ?? "deterministic") as JudgeCliOptions["ai"];
  if (!["deterministic", "configured", "none"].includes(ai)) throw new Error(`UNKNOWN_JUDGE_AI_MODE:${ai}`);
  const speedRaw = valueOf(argv, "--speed");
  const speed = speedRaw === undefined ? 0 : Number(speedRaw);
  if (!Number.isFinite(speed) || speed < 0) throw new Error(`INVALID_JUDGE_SPEED:${speedRaw}`);
  return {
    scenario,
    seed: valueOf(argv, "--seed") ?? null,
    speed,
    workspace: valueOf(argv, "--workspace") ?? ".preview/judge-demo",
    ai,
    json: argv.includes("--json"),
    quiet: argv.includes("--quiet"),
  };
}

const STATUS_LABEL: Record<JudgeStageResult["status"], string> = {
  pass: "PASS",
  fail: "FAIL",
  blocked: "BLOCKED",
};

export function formatJudgeResult(result: JudgeDemoResult) {
  const lines: string[] = [
    "═══ COMPETITION JUDGE DEMO ═══",
    "SIMULATED INDUSTRIAL ENVIRONMENT（高保真工业仿真，不是真实工厂）",
    "",
    `问题：${JUDGE_BUSINESS_QUESTION}`,
    "",
  ];
  for (const stage of result.stages) {
    lines.push(`[${stage.step}] ${stage.title}  ${STATUS_LABEL[stage.status]}`);
    lines.push(`     INPUT   ${stage.input}`);
    lines.push(`     PROCESS ${stage.process}`);
    lines.push(`     OUTPUT  ${stage.output}`);
    lines.push(`     PROOF   ${stage.proof}`);
    lines.push("");
  }
  lines.push("─── RESULT ───");
  lines.push(`contextId       = ${result.contextId}`);
  lines.push(`businessKey     = ${result.businessKey}`);
  lines.push(`orderQuantity   = ${result.orderQuantity}`);
  lines.push(`productionCompleted = ${result.productionCompletedQuantity}`);
  lines.push(`difference      = ${result.difference}`);
  lines.push(`sourceSystems   = ${result.sourceSystems.join(",")}`);
  lines.push(`exceptionCode   = ${result.exceptionCode ?? "none"}`);
  lines.push(`evidenceCount   = ${result.evidenceCount}`);
  lines.push(`ruleEvaluationCount = ${result.ruleEvaluationCount}`);
  lines.push(`traceStatus     = ${result.traceStatus}`);
  lines.push(`governanceStatus= ${result.governanceStatus}`);
  lines.push(`executionStatus = ${result.executionStatus}`);
  lines.push(`outcomeStatus   = ${result.outcomeStatus}`);
  lines.push(`aiProvider      = ${result.aiProvider}/${result.aiModel}`);
  lines.push("");
  lines.push(`evidence manifest = ${result.artifacts.evidenceManifest}`);
  lines.push(`uns stream        = ${result.artifacts.unsStream}`);
  if (result.artifacts.readback) lines.push(`execution readback= ${result.artifacts.readback}`);
  if (result.traceFailures.length) {
    lines.push("");
    lines.push("trace failures:");
    for (const failure of result.traceFailures) lines.push(`  - ${failure}`);
  }
  lines.push("");
  lines.push("复现这条结论：");
  lines.push(`  npm run evidence:verify -- --context ${result.contextId}`);
  lines.push("");
  lines.push(result.verdict);
  return lines.join("\n");
}

export async function runJudgeCli(options: JudgeCliOptions) {
  const result = await runJudgeDemo({
    scenario: options.scenario,
    ...(options.seed ? { seed: options.seed } : {}),
    speed: options.speed,
    workspace: options.workspace,
    aiProvider: options.ai,
    ...(options.quiet ? {} : {}),
  });
  if (!options.quiet) console.log(formatJudgeResult(result));
  if (options.json) console.log(JSON.stringify(result, null, 2));
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseJudgeArgs(process.argv.slice(2));
  const result = await runJudgeCli(options);
  process.exit(result.verdict === "JUDGE_DEMO_VERIFIED" ? 0 : 1);
}
