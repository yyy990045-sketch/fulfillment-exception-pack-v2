import type { CaseRecord, EvidenceItem, GoldCase, Severity } from "../types.js";
import { buildConflictIssues } from "../conflict/detect.js";

export type ReportCitation = {
  evidenceId: string;
  sourceId: string;
  sourceVersion: string;
  location: string;
  quote: string;
};

export type ReportFact = {
  field: string;
  value: string | number | null;
  sourceId: string;
  citation: ReportCitation;
};

export type ReportConflict = {
  issueId?: string;
  field: string;
  severity: Severity;
  leftValue: string | number | null;
  rightValue: string | number | null;
  citationIds: string[];
  resolution: "unresolved" | "resolved" | "needs_evidence";
};

export type ReportAction = {
  type: string;
  summary: string;
  status: string;
  receipt?: string;
  externalRequestId?: string;
  receiptSource?: "local-ledger";
};

export type CaseReport = {
  reportVersion: "fulfillment-report-v1";
  generatedAt: string;
  caseId: string;
  title: string;
  pack: GoldCase["pack"];
  ownerRole: string;
  status: CaseRecord["status"];
  summary: string;
  facts: ReportFact[];
  conflicts: ReportConflict[];
  gaps: string[];
  actions: ReportAction[];
  conclusion: string;
  conclusionCitationIds: string[];
  auditTrail: CaseRecord["events"];
  conflictReviews: NonNullable<CaseRecord["conflictReviews"]>;
  conflictIssues: ReturnType<typeof buildConflictIssues>;
  reportDecision?: CaseRecord["reportDecision"];
};

function locationOf(evidence: EvidenceItem) {
  const locator = evidence.locator;
  return [
    locator.fileName,
    locator.sheet,
    locator.cell,
    locator.row ? `行${locator.row}` : undefined,
    locator.line ? `L${locator.line}` : undefined,
    locator.page ? `P${locator.page}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

function citationOf(evidence: EvidenceItem): ReportCitation {
  return {
    evidenceId: evidence.id,
    sourceId: evidence.sourceId,
    sourceVersion: evidence.sourceVersion,
    location: locationOf(evidence),
    quote: evidence.quote,
  };
}

const statusLabel: Record<CaseRecord["status"], string> = {
  new: "新收",
  triaged: "已分流",
  confirmed: "已确认",
  proposed: "待审批",
  approved: "已批准",
  executed: "已执行",
  verified: "已核验",
  closed: "已结案",
  rejected: "已驳回",
};

export function buildReport(gold: GoldCase, runtime: CaseRecord): CaseReport {
  const pack = runtime.pack;
  const evidence = pack?.evidence ?? [];
  const citationById = new Map(evidence.map((item) => [item.id, citationOf(item)]));
  const facts = evidence
    .filter((item) => item.support !== "unsupported")
    .map((item) => ({
      field: item.field,
      value: item.value,
      sourceId: item.sourceId,
      citation: citationById.get(item.id)!,
    }));
  const conflicts = (pack?.conflicts ?? []).map((conflict) => ({
    issueId: conflict.issueId,
    field: conflict.field,
    severity: conflict.severity,
    leftValue: conflict.leftValue,
    rightValue: conflict.rightValue,
    citationIds: [conflict.leftEvidenceId, conflict.rightEvidenceId],
    resolution: conflict.resolution,
  }));
  const conflictIssues = pack?.conflictIssues ?? buildConflictIssues(pack?.conflicts ?? []);
  const unresolved = conflictIssues.length;
  const gaps = pack?.gaps ?? [];
  const actions = runtime.actions.map((action) => ({
    type: action.type,
    summary: action.summary,
    status: action.status,
    ...(action.receipt ? { receipt: action.receipt } : {}),
    ...(action.externalRequestId ? { externalRequestId: action.externalRequestId } : {}),
    ...(action.receiptSource ? { receiptSource: action.receiptSource } : {}),
  }));
  const conclusion =
    runtime.status === "closed"
      ? "处理动作已有回执并完成核验，案件已结案。"
      : `案件目前为“${statusLabel[runtime.status]}”；${unresolved ? `发现 ${unresolved} 处信息不一致` : "目前没有发现信息不一致"}${gaps.length ? `，另有 ${gaps.length} 项材料缺口` : ""}，现在还不能直接按方案处理。`;
  const conclusionCitationIds = conflicts.flatMap((conflict) => conflict.citationIds);
  return {
    reportVersion: "fulfillment-report-v1",
    generatedAt: new Date().toISOString(),
    caseId: gold.id,
    title: gold.title,
    pack: gold.pack,
    ownerRole: gold.ownerRole,
    status: runtime.status,
    summary: conflictIssues.length || gaps.length ? `已查看 ${evidence.length} 条材料，发现 ${conflictIssues.length} 个业务问题，另有 ${gaps.length} 项待补材料。` : `已查看 ${evidence.length} 条材料，目前没有发现信息不一致。`,
    facts,
    conflicts,
    gaps,
    actions,
    conclusion,
    conclusionCitationIds,
    auditTrail: runtime.events,
    conflictReviews: runtime.conflictReviews ?? [],
    conflictIssues,
    ...(runtime.reportDecision ? { reportDecision: runtime.reportDecision } : {}),
  };
}
