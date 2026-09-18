import type { CaseRecord, GoldCase } from "../types.js";
import { approve, execute, ingest, openCase, propose, reviewConflicts, submitForApproval, verifyAndClose } from "../case/runtime.js";

export type AgentRole = "Intake" | "Evidence" | "Review" | "Resolution" | "Verification";

export const AGENT_ORDER: AgentRole[] = ["Intake", "Evidence", "Review", "Resolution", "Verification"];

export const AGENT_CONTRACT: Record<AgentRole, { input: string; output: string; tools: string[]; stop: string }> = {
  Intake: { input: "案件与材料清单", output: "Case.new", tools: ["openCase"], stop: "缺 tenant/scope 立即停止" },
  Evidence: { input: "GoldMaterial[]", output: "EvidencePack", tools: ["extractCase"], stop: "无 locator 不得升格为事实" },
  Review: { input: "EvidencePack", output: "Finding[]", tools: ["detectConflicts"], stop: "无证据冲突只记缺口" },
  Resolution: { input: "Finding[]", output: "Action draft", tools: ["propose", "submitForApproval"], stop: "写操作保持草案" },
  Verification: { input: "回执", output: "Case.closed", tools: ["execute", "verifyAndClose"], stop: "无回执不得关闭" },
};

export function permissions(role: AgentRole) {
  return {
    role,
    canWriteTongyue: false,
    canApprove: role === "Resolution",
    canExecute: role === "Verification",
    ...AGENT_CONTRACT[role],
  };
}

function shouldRun(role: AgentRole, startAt: AgentRole) {
  return AGENT_ORDER.indexOf(role) >= AGENT_ORDER.indexOf(startAt);
}

function pause(runtime: CaseRecord, log: AgentRole[], role: AgentRole) {
  return { runtime: { ...runtime, paused: true, pausedAfter: role, graphLog: log }, log };
}

export function runGraph(gold: GoldCase, opts?: { pauseAfter?: AgentRole; approver?: string; resumeFrom?: CaseRecord }) {
  const approver = opts?.approver ?? (gold.pack === "it-alert" ? "工程师" : "销售总监");
  const log: AgentRole[] = opts?.resumeFrom?.graphLog ? [...opts.resumeFrom.graphLog] : [];
  const startAt: AgentRole = opts?.resumeFrom?.pausedAfter
    ? AGENT_ORDER[AGENT_ORDER.indexOf(opts.resumeFrom.pausedAfter) + 1] ?? "Verification"
    : "Intake";
  let runtime: CaseRecord = opts?.resumeFrom
    ? { ...opts.resumeFrom, paused: false, pausedAfter: undefined }
    : openCase(gold);

  if (shouldRun("Intake", startAt)) {
    if (!opts?.resumeFrom) runtime = openCase(gold);
    log.push("Intake");
    if (opts?.pauseAfter === "Intake") return pause(runtime, log, "Intake");
  }

  if (shouldRun("Evidence", startAt)) {
    runtime = ingest(gold, runtime);
    log.push("Evidence");
    if (opts?.pauseAfter === "Evidence") return pause(runtime, log, "Evidence");
  }

  if (shouldRun("Review", startAt)) {
    runtime = reviewConflicts(runtime, gold.ownerRole, runtime.pack?.conflicts.map((conflict) => conflict.id) ?? []);
    if (runtime.pack?.gaps?.length) {
      log.push("Review");
      return pause(runtime, log, "Review");
    }
    runtime = propose(runtime, gold.ownerRole);
    log.push("Review");
    if (opts?.pauseAfter === "Review") return pause(runtime, log, "Review");
  }

  if (shouldRun("Resolution", startAt)) {
    runtime = submitForApproval(runtime, gold.ownerRole);
    log.push("Resolution");
    if (opts?.pauseAfter === "Resolution") return pause(runtime, log, "Resolution");
  }

  if (runtime.actions.length === 0 && runtime.findings.length === 0) {
    runtime = { ...runtime, status: "closed", paused: false, graphLog: [...log, "Verification"] };
    return { runtime, log: [...log, "Verification"] };
  }

  if (shouldRun("Verification", startAt)) {
    if (runtime.status !== "approved") runtime = approve(runtime, approver);
    runtime = execute(runtime, approver);
    runtime = verifyAndClose(runtime, approver);
    log.push("Verification");
  }

  return { runtime: { ...runtime, paused: false, pausedAfter: undefined, graphLog: log }, log };
}

export function resume(gold: GoldCase, paused: CaseRecord, approver?: string) {
  if (!paused.paused || !paused.pausedAfter) throw new Error("not_paused");
  if (paused.pausedAfter === "Review" && paused.pack?.gaps?.length) return { runtime: paused, log: paused.graphLog ?? [] };
  return runGraph(gold, { resumeFrom: paused, approver });
}
