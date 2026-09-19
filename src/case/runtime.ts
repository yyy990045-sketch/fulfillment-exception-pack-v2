import type { ActionRecord, ActionType, CaseRecord, CaseStatus, ConflictReview, EvidencePack, Finding, GoldCase } from "../types.js";
import { buildConflictIssues, detectConflicts, gapsFrom } from "../conflict/detect.js";
import { EvidenceError, extractCase } from "../evidence/extract.js";
import { RESOLUTION_APPROVER_ROLES, subjectHasAnyRole } from "../authorization.js";

const TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  new: ["triaged"],
  triaged: ["confirmed", "rejected"],
  confirmed: ["proposed"],
  rejected: [],
  proposed: ["approved", "rejected"],
  approved: ["executed"],
  executed: ["verified"],
  verified: ["closed"],
  closed: [],
};

const nowIso = () => new Date().toISOString();

export function canTransition(from: CaseStatus, to: CaseStatus) {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: CaseStatus, to: CaseStatus, actor: string, reason: string) {
  if (!actor.trim()) throw new Error("human_actor_required");
  if (!reason.trim()) throw new Error("transition_reason_required");
  if (!canTransition(from, to)) throw new Error(`invalid_risk_case_transition:${from}->${to}`);
}

export function actionMayExecute(status: CaseStatus) {
  return status === "approved" || status === "executed" || status === "verified";
}

function actionForFinding(typeHint: ActionType | undefined, field: string): ActionType {
  if (typeHint) return typeHint;
  if (field === "amount" || field === "qty") return "reject_overclaim";
  if (field === "status") return "review_quotation";
  return "supplement_evidence";
}

export function openCase(gold: GoldCase): CaseRecord {
  return {
    id: gold.id,
    title: gold.title,
    tenantId: gold.tenantId,
    scope: gold.scope,
    status: "new",
    ownerRole: gold.ownerRole,
    findings: [],
    actions: [],
    events: [{ at: nowIso(), to: "new", actor: "system", reason: "intake" }],
  };
}

export function ingest(gold: GoldCase, runtime: CaseRecord, opts?: { scope?: string; tenantId?: string }): CaseRecord {
  const tenantId = opts?.tenantId ?? gold.tenantId;
  const scope = opts?.scope ?? gold.scope;
  const evidence = extractCase(gold, { tenantId, scope });
  const conflicts = detectConflicts(evidence);
  const pack: EvidencePack = {
    schemaVersion: "evidence-pack-v1",
    tenantId,
    caseId: gold.id,
    evidence,
    structuredFields: Object.fromEntries(evidence.map((e) => [`${e.sourceId}:${e.sourceVersion}:${e.field}`, e.value])),
    conflicts,
    conflictIssues: buildConflictIssues(conflicts),
    gaps: gapsFrom(evidence),
    traceId: `tr-${gold.id}`,
  };
  const findings: Finding[] = conflicts.map((c) => ({
    id: `f-${c.id}`,
    field: c.field,
    statement: `${c.field} 冲突：${String(c.leftValue)} vs ${String(c.rightValue)}`,
    evidenceIds: [c.leftEvidenceId, c.rightEvidenceId],
    conflictId: c.id,
    severity: c.severity,
    status: "candidate",
  }));
  return {
    ...runtime,
    pack,
    findings,
    status: runtime.status,
  };
}

export type ConflictReviewInput = Omit<ConflictReview, "actor" | "at">;

export function reviewConflicts(runtime: CaseRecord, actor: string, entries: Array<string | ConflictReviewInput> = []): CaseRecord {
  if (!actor.trim()) throw new Error("human_actor_required");
  const pack = runtime.pack;
  const conflicts = pack?.conflicts ?? [];
  const knownIds = new Set(conflicts.map((conflict) => conflict.id));
  const issues = pack?.conflictIssues ?? buildConflictIssues(conflicts);
  const issueById = new Map(issues.map((issue) => [issue.id, issue]));
  const issueForConflict = new Map(conflicts.map((conflict) => [conflict.id, conflict.issueId ?? conflict.id]));
  const normalized = entries.map((entry) => typeof entry === "string" ? ({ conflictId: entry, decision: "acknowledge" as const, rationale: "用户标记已核对" }) : entry);
  const unique = [...new Map(normalized.map((entry) => [entry.conflictId, entry])).values()];
  if (unique.some((entry) => !knownIds.has(entry.conflictId))) throw new Error("invalid_conflict_id");
  if (unique.some((entry) => !entry.rationale?.trim())) throw new Error("review_rationale_required");
  const evidenceById = new Map((pack?.evidence ?? []).map((item) => [item.id, item]));
  const conflictById = new Map(conflicts.map((conflict) => [conflict.id, conflict]));
  for (const entry of unique) {
    const conflict = conflictById.get(entry.conflictId)!;
    if (entry.decision === "accept_left" && entry.selectedEvidenceId !== conflict.leftEvidenceId) throw new Error("invalid_review_evidence");
    if (entry.decision === "accept_right" && entry.selectedEvidenceId !== conflict.rightEvidenceId) throw new Error("invalid_review_evidence");
    if (entry.selectedEvidenceId && !evidenceById.has(entry.selectedEvidenceId)) throw new Error("invalid_review_evidence");
  }
  const existingReviews = runtime.conflictReviews ?? [];
  const existingIssueIds = new Set(runtime.reviewedIssueIds ?? existingReviews.map((review) => review.issueId ?? issueForConflict.get(review.conflictId) ?? review.conflictId));
  const newlyReviewed = unique.filter((entry) => !existingIssueIds.has(issueForConflict.get(entry.conflictId) ?? entry.conflictId));
  if (!newlyReviewed.length) return runtime;
  const addedReviews: ConflictReview[] = newlyReviewed.map((entry) => ({ ...entry, issueId: issueForConflict.get(entry.conflictId), actor, at: nowIso() }));
  const reviews = [...existingReviews, ...addedReviews];
  const reviewedPairSet = new Set(runtime.reviewedConflictIds ?? []);
  for (const entry of newlyReviewed) {
    const issue = issueById.get(issueForConflict.get(entry.conflictId) ?? entry.conflictId);
    for (const conflictId of issue?.conflictIds ?? [entry.conflictId]) reviewedPairSet.add(conflictId);
  }
  const reviewed = [...reviewedPairSet];
  const reviewedIssues = [...new Set([...existingIssueIds, ...newlyReviewed.map((entry) => issueForConflict.get(entry.conflictId) ?? entry.conflictId)])];
  const resolvedConflicts = conflicts.map((conflict) => {
    const review = reviews.find((item) => (item.issueId ?? issueForConflict.get(item.conflictId) ?? item.conflictId) === (conflict.issueId ?? conflict.id));
    if (!review) return conflict;
    if (review.decision === "accept_left" || review.decision === "accept_right") return { ...conflict, resolution: "resolved" as const };
    if (review.decision === "needs_evidence") return { ...conflict, resolution: "needs_evidence" as const };
    return conflict;
  });
  const resolvedIssues = issues.map((issue) => {
    const review = reviews.find((item) => (item.issueId ?? issue.id) === issue.id);
    if (!review) return issue;
    if (review.decision === "accept_left" || review.decision === "accept_right") return { ...issue, resolution: "resolved" as const };
    if (review.decision === "needs_evidence") return { ...issue, resolution: "needs_evidence" as const };
    return issue;
  });
  let current: CaseRecord = {
    ...runtime,
    reviewedConflictIds: reviewed,
    reviewedIssueIds: reviewedIssues,
    conflictReviews: reviews,
    pack: pack ? { ...pack, conflicts: resolvedConflicts, conflictIssues: resolvedIssues } : pack,
    events: [...runtime.events, { at: nowIso(), from: runtime.status, to: runtime.status, actor, reason: "核对差异" }],
  };
  if (reviewedIssues.length < issues.length || ["confirmed", "proposed", "approved", "executed", "verified", "closed", "rejected"].includes(current.status)) return current;
  if (current.status === "new") {
    assertTransition(current.status, "triaged", actor, "分流");
    current = { ...current, status: "triaged", events: [...current.events, { at: nowIso(), from: "new", to: "triaged", actor, reason: "分流" }] };
  }
  if (current.status === "triaged") {
    assertTransition(current.status, "confirmed", actor, "确认差异");
    current = { ...current, status: "confirmed", events: [...current.events, { at: nowIso(), from: "triaged", to: "confirmed", actor, reason: "确认差异" }] };
  }
  return current;
}

function deriveActionTypes(runtime: CaseRecord): ActionType[] {
  const evidence = runtime.pack?.evidence ?? [];
  const conflicts = runtime.pack?.conflicts ?? [];
  const types = new Set<ActionType>();
  const has = (kind: string, key: string) => evidence.some((item) => item.sourceKind === kind && item.compareKey === key);
  const valuesDiffer = (key: string) => {
    const values = new Set(evidence.filter((item) => item.compareKey === key).map((item) => String(item.value)));
    return values.size > 1;
  };
  if (evidence.some((item) => item.sourceKind === "alert") || evidence.filter((item) => item.sourceKind === "complaint").length >= 9) types.add("create_task");
  if (evidence.some((item) => item.sourceKind === "email" && item.compareKey === "totalAmount") || (has("complaint", "totalAmount") && evidence.some((item) => item.sourceKind !== "complaint" && item.compareKey === "totalAmount"))) types.add("reject_overclaim");
  if (runtime.pack?.gaps?.some((gap) => gap.endsWith("orderId"))) types.add("supplement_evidence");
  if (runtime.pack?.gaps?.some((gap) => gap.endsWith("party")) && !runtime.pack?.gaps?.some((gap) => gap.endsWith("orderId"))) types.add("urge_follow_up");
  if (conflicts.some((conflict) => conflict.field === "model" || conflict.field === "qty")) types.add("supplement_evidence");
  if (conflicts.some((conflict) => conflict.field === "amount") && !valuesDiffer("unitPrice") && !evidence.some((item) => item.sourceKind === "email")) types.add("supplement_evidence");
  if ((conflicts.some((conflict) => conflict.field === "date") && evidence.some((item) => item.sourceKind === "quote") && evidence.some((item) => item.sourceKind === "order")) || (conflicts.some((conflict) => conflict.field === "status") && evidence.some((item) => item.sourceKind === "quote") && evidence.some((item) => item.sourceKind === "order")) || valuesDiffer("unitPrice") || valuesDiffer("quoteValidUntil") || valuesDiffer("quoteStatus") || has("complaint", "promise")) types.add("review_quotation");
  if (conflicts.some((conflict) => conflict.field === "status") && evidence.some((item) => item.sourceKind === "payment") && evidence.some((item) => item.sourceKind === "complaint")) types.add("urge_follow_up");
  if (!types.size && (evidence.some((item) => item.sourceKind === "complaint") || evidence.some((item) => item.compareKey === "settlementStatus" && String(item.value) === "未收") || evidence.some((item) => item.compareKey === "receivedAmount" && String(item.value) === "0"))) types.add("urge_follow_up");
  const order: ActionType[] = ["supplement_evidence", "reject_overclaim", "review_quotation", "urge_follow_up", "create_task"];
  return order.filter((type) => types.has(type));
}

export function propose(runtime: CaseRecord, actor: string): CaseRecord {
  const conflicts = runtime.pack?.conflicts ?? [];
  const issues = runtime.pack?.conflictIssues ?? buildConflictIssues(conflicts);
  if (issues.length && (runtime.reviewedIssueIds?.length ?? 0) < issues.length) throw new Error("review_required");
  if (runtime.pack?.gaps?.length) throw new Error("gaps_required");
  if (!["new", "triaged", "confirmed"].includes(runtime.status)) throw new Error("proposal_not_allowed");
  let current = runtime;
  const steps: Array<[CaseStatus, string]> = current.status === "new"
    ? [["triaged", "分流"], ["confirmed", "冲突可回源"], ["proposed", "生成行动草案"]]
    : current.status === "triaged"
      ? [["confirmed", "冲突可回源"], ["proposed", "生成行动草案"]]
      : current.status === "confirmed"
        ? [["proposed", "生成行动草案"]]
        : [];
  for (const [to, reason] of steps) {
    assertTransition(current.status, to, actor, reason);
    current = {
      ...current,
      status: to,
      events: [...current.events, { at: nowIso(), from: current.status, to, actor, reason }],
    };
  }
  const actions: ActionRecord[] = deriveActionTypes(current).map((type, i) => ({
    id: `${runtime.id}-act-${i + 1}`,
    type,
    summary: actionSummary(type, runtime.id),
    status: "draft",
    idempotencyKey: `${runtime.id}:${type}`,
    requiresApproval: true,
  }));
  if (actions.length === 0 && (current.findings.length > 0 || (current.pack?.gaps.length ?? 0) > 0)) {
    const type = actionForFinding(undefined, current.findings[0]?.field ?? "qty");
    actions.push({
      id: `${runtime.id}-act-1`,
      type,
      summary: actionSummary(type, runtime.id),
      status: "draft",
      idempotencyKey: `${runtime.id}:${type}`,
      requiresApproval: true,
    });
  }
  return { ...current, actions };
}

function actionSummary(type: ActionType, caseId: string) {
  if (type === "reject_overclaim") return `驳回无订单证据的超额索赔（${caseId}）`;
  if (type === "review_quotation") return `请销售总监复核报价与订单差异（${caseId}）`;
  if (type === "urge_follow_up") return `催办补齐责任人/回款（${caseId}）`;
  if (type === "create_task") return `创建跟进任务（${caseId}）`;
  return `补证：补齐订单号或变更单（${caseId}）`;
}

export function submitForApproval(runtime: CaseRecord, actor: string) {
  if (runtime.status !== "proposed") throw new Error("proposal_required");
  return {
    ...runtime,
    actions: runtime.actions.map((a) => (a.status === "draft" ? { ...a, status: "pending_approval" as const } : a)),
    events: [...runtime.events, { at: nowIso(), from: runtime.status, to: runtime.status, actor, reason: "草案提交审批" }],
  };
}

export function approve(runtime: CaseRecord, actor: string, actionId?: string, actorRoles: string[] = []) {
  if (!subjectHasAnyRole({ subjectId: actor, roles: actorRoles }, RESOLUTION_APPROVER_ROLES)) throw new Error("forbidden_approver");
  if (!runtime.actions.length) {
    if (runtime.findings.length || runtime.status !== "proposed") throw new Error("approval_not_pending");
    return {
      ...runtime,
      status: "closed" as const,
      events: [...runtime.events, { at: nowIso(), from: runtime.status, to: "closed", actor, reason: "无冲突结案" }],
    };
  }
  if (runtime.actions.some((action) => action.status !== "pending_approval" && action.status !== "draft")) throw new Error("approval_not_pending");
  assertTransition(runtime.status, "approved", actor, "批准行动");
  const actions = runtime.actions.map((a) => {
    if (actionId && a.id !== actionId && a.status === "pending_approval") return a;
    if (a.status === "draft" || a.status === "pending_approval") {
      return { ...a, status: "authorized" as const, approvedBy: actor };
    }
    return a;
  });
  return {
    ...runtime,
    status: "approved" as const,
    actions,
    events: [...runtime.events, { at: nowIso(), from: runtime.status, to: "approved", actor, reason: "批准" }],
  };
}

type ExecutionReceipt = { receipt: string; externalRequestId?: string; receiptSource?: "local-ledger"; receiptAt?: string };
type ReceiptFactory = (action: ActionRecord, operationKey: string) => ExecutionReceipt;

const defaultReceiptFactory: ReceiptFactory = (action, operationKey) => ({
  receipt: `local-ledger:${operationKey}:${action.id}`,
  externalRequestId: `${operationKey}:${action.id}`,
  receiptSource: "local-ledger",
  receiptAt: nowIso(),
});

export function execute(runtime: CaseRecord, actor: string, idempotencyKey?: string, receiptFactory: ReceiptFactory = defaultReceiptFactory) {
  if (!actionMayExecute(runtime.status)) {
    throw new Error("approval_required");
  }
  if (runtime.status !== "approved" && runtime.actions.every((action) => ["succeeded", "verified"].includes(action.status) && action.receipt)) return runtime;
  if (!runtime.actions.length || runtime.actions.some((action) => action.status !== "authorized" && action.status !== "executing" && action.status !== "succeeded")) {
    throw new Error("actions_not_ready");
  }
  const operationKey = idempotencyKey || runtime.executionIdempotencyKey || `${runtime.id}:execute`;
  const actions = runtime.actions.map((a) => {
    if (a.status !== "authorized" && a.status !== "executing") return a;
    const result = receiptFactory(a, operationKey);
    return { ...a, status: "succeeded" as const, receipt: result.receipt, externalRequestId: result.externalRequestId, receiptSource: result.receiptSource, receiptAt: result.receiptAt };
  });
  assertTransition(runtime.status, "executed", actor, "登记外部能力回执");
  return {
    ...runtime,
    status: "executed" as const,
    executionIdempotencyKey: operationKey,
    actions,
    events: [...runtime.events, { at: nowIso(), from: runtime.status, to: "executed", actor, reason: "外部能力回执已登记" }],
  };
}

export function verifyAndClose(runtime: CaseRecord, actor: string) {
  if (!runtime.actions.length || runtime.actions.some((a) => !["succeeded", "verified"].includes(a.status) || !a.receipt || a.receiptSource !== "local-ledger")) throw new Error("receipt_required");
  let current = runtime;
  assertTransition(current.status, "verified", actor, "核验回执");
  current = {
    ...current,
    status: "verified",
    actions: current.actions.map((a) => (a.status === "succeeded" ? { ...a, status: "verified" as const } : a)),
    events: [...current.events, { at: nowIso(), from: current.status, to: "verified", actor, reason: "核验" }],
  };
  assertTransition(current.status, "closed", actor, "结案");
  return {
    ...current,
    status: "closed" as const,
    events: [...current.events, { at: nowIso(), from: "verified", to: "closed", actor, reason: "结案" }],
  };
}

export function runHappyPath(gold: GoldCase, approver = "销售总监"): CaseRecord {
  let runtime = openCase(gold);
  runtime = ingest(gold, runtime);
  if (gold.negatives.includes("no_scope")) {
    throw new EvidenceError("NO_SCOPE", "测试要求无 scope");
  }
  runtime = reviewConflicts(runtime, gold.ownerRole, runtime.pack?.conflicts.map((conflict) => conflict.id) ?? []);
  if (runtime.pack?.gaps?.length) {
    return { ...runtime, paused: true, pausedAfter: "Review", graphLog: ["Intake", "Evidence", "Review"] };
  }
  runtime = propose(runtime, gold.ownerRole);
  runtime = submitForApproval(runtime, gold.ownerRole);
  if (runtime.actions.length === 0 && runtime.findings.length === 0) {
    runtime = {
      ...runtime,
      status: "closed",
      events: [...runtime.events, { at: nowIso(), from: runtime.status, to: "closed", actor: approver, reason: "无冲突结案" }],
    };
    return runtime;
  }
  runtime = approve(runtime, approver, undefined, [approver]);
  runtime = execute(runtime, approver);
  runtime = verifyAndClose(runtime, approver);
  return runtime;
}

export { EvidenceError };
