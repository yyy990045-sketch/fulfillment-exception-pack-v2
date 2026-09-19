import type { ActionRecord } from "../../../types.js";
import { createHash } from "node:crypto";
import { approve, assertTransition, execute, submitForApproval, verifyAndClose } from "../../../case/runtime.js";
import { isAssignableOwnerRole } from "../../../authorization.js";
import type { V2Exception, ExceptionEvidenceBundle } from "../rule-types.js";
import {
  assertResolutionActorContext,
  assertResolutionActionAllowed,
  canApproveResolution,
  canCloseResolution,
  canExecuteResolution,
  type ResolutionActorContext,
} from "./authorization.js";
import type {
  ResolutionActionInput,
  ResolutionCase,
  ResolutionReview,
} from "./types.js";

const nowIso = () => new Date().toISOString();

function withResolutionRuntime(current: ResolutionCase, runtime: ResolutionCase["runtime"], updatedAt: string): ResolutionCase {
  return {
    ...current,
    status: runtime.status,
    runtime,
    updatedAt,
  };
}

function assertStatusSync(resolution: ResolutionCase) {
  if (resolution.status !== resolution.runtime.status) throw new Error("resolution_status_desync");
  return resolution;
}

function assertHumanText(value: string, code: string) {
  if (!value.trim()) throw new Error(code);
}

export function resolutionCaseId(exceptionId: string) {
  return `resolution-case-${exceptionId}`;
}

export function acceptExceptionCase(input: {
  exception: V2Exception;
  bundle: ExceptionEvidenceBundle;
  ownerRole: string;
  rationale: string;
  actor: ResolutionActorContext;
  acceptedAt?: string;
}): ResolutionCase {
  assertResolutionActorContext(input.actor);
  assertHumanText(input.ownerRole, "resolution_owner_role_required");
  if (!isAssignableOwnerRole(input.ownerRole)) throw new Error("resolution_owner_role_not_assignable");
  assertHumanText(input.rationale, "resolution_acceptance_rationale_required");
  if (input.exception.status !== "detected") throw new Error("resolution_exception_not_detected");
  const id = resolutionCaseId(input.exception.id);
  const at = input.acceptedAt ?? nowIso();
  assertTransition("new", "triaged", input.actor.displayName, "接受异常进入处置");
  const runtime: ResolutionCase["runtime"] = {
    id,
    title: input.exception.title,
    tenantId: input.exception.tenantId,
    scope: "fulfillment:v2-resolution",
    status: "triaged",
    ownerRole: input.ownerRole,
    findings: [],
    actions: [],
    events: [
      { at, to: "new", actor: "system", reason: "v2_exception_intake" },
      { at, from: "new", to: "triaged", actor: input.actor.displayName, reason: "接受异常进入处置" },
    ],
  };
  return {
    id,
    tenantId: input.exception.tenantId,
    contextId: input.exception.contextId,
    exceptionId: input.exception.id,
    status: "triaged",
    ownerRole: input.ownerRole,
    origin: {
      kind: "v2_exception",
      contextId: input.exception.contextId,
      exceptionId: input.exception.id,
      exceptionCode: input.exception.code,
      matchKey: input.exception.matchKey,
      ruleId: input.exception.ruleId,
      ruleVersionId: input.exception.ruleVersionId,
      sourceRuleEvaluationId: input.exception.latestRuleEvaluationId,
      acceptedBy: input.actor.displayName,
      acceptedAt: at,
      acceptanceRationale: input.rationale,
      evidenceRefs: input.bundle.evidence.map((item) => ({ evidenceId: item.evidenceId, role: item.role })),
    },
    runtime,
    createdAt: at,
    updatedAt: at,
  };
}

export function reviewResolutionCase(
  current: ResolutionCase,
  input: { decision: ResolutionReview["decision"]; rationale: string; actor: ResolutionActorContext; reviewedAt?: string },
): ResolutionCase {
  assertResolutionActorContext(input.actor);
  assertHumanText(input.rationale, "resolution_review_rationale_required");
  if (current.status !== "triaged") throw new Error("resolution_review_not_allowed");
  const at = input.reviewedAt ?? nowIso();
  const review: ResolutionReview = {
    decision: input.decision,
    rationale: input.rationale,
    actor: input.actor.displayName,
    actorSubjectId: input.actor.subjectId,
    at,
  };
  if (input.decision === "needs_evidence") {
    return {
      ...current,
      review,
      updatedAt: at,
      runtime: {
        ...current.runtime,
        events: [...current.runtime.events, { at, from: "triaged", to: "triaged", actor: input.actor.displayName, reason: "仍需补充材料" }],
      },
    };
  }
  const to = input.decision === "confirm" ? "confirmed" : "rejected";
  assertTransition("triaged", to, input.actor.displayName, input.decision === "confirm" ? "确认异常进入处置" : "拒绝异常继续处置");
  return {
    ...current,
    status: to,
    review,
    updatedAt: at,
    runtime: {
      ...current.runtime,
      status: to,
      events: [...current.runtime.events, { at, from: "triaged", to, actor: input.actor.displayName, reason: input.decision === "confirm" ? "确认异常进入处置" : "拒绝异常继续处置" }],
    },
  };
}

export function proposeResolution(
  current: ResolutionCase,
  input: { actions: ResolutionActionInput[]; actor: ResolutionActorContext; proposedAt?: string },
): ResolutionCase {
  assertResolutionActorContext(input.actor);
  if (current.status !== "confirmed") throw new Error("resolution_proposal_not_allowed");
  if (!input.actions.length) throw new Error("resolution_actions_required");
  const at = input.proposedAt ?? nowIso();
  const allowedTypes = new Set<ActionRecord["type"]>(["supplement_evidence", "urge_follow_up", "reject_overclaim", "review_quotation", "create_task"]);
  const actions: ActionRecord[] = input.actions.map((action, index) => {
    if (!allowedTypes.has(action.type)) throw new Error("invalid_action_type");
    assertHumanText(action.summary, "resolution_action_summary_required");
    return {
      id: `${current.id}-act-${index + 1}`,
      type: action.type,
      summary: action.summary,
      status: "draft",
      idempotencyKey: `${current.id}:${action.type}:${index + 1}`,
      requiresApproval: true,
    };
  });
  assertTransition("confirmed", "proposed", input.actor.displayName, "提交处置方案");
  return {
    ...current,
    status: "proposed",
    proposedBy: input.actor.displayName,
    updatedAt: at,
    runtime: {
      ...current.runtime,
      status: "proposed",
      actions,
      proposedBySubjectId: input.actor.subjectId,
      events: [...current.runtime.events, { at, from: "confirmed", to: "proposed", actor: input.actor.displayName, reason: "提交处置方案" }],
    },
  };
}

export function submitResolution(
  current: ResolutionCase,
  actor: ResolutionActorContext,
  submittedAt = nowIso(),
): ResolutionCase {
  assertResolutionActorContext(actor);
  if (current.status !== "proposed") throw new Error("resolution_submit_not_allowed");
  const submitted = submitForApproval(current.runtime, actor.displayName);
  return assertStatusSync(withResolutionRuntime(current, {
    ...submitted,
    events: [...submitted.events.slice(0, -1), { ...submitted.events.at(-1)!, at: submittedAt }],
  }, submittedAt));
}

export function approveResolution(
  current: ResolutionCase,
  actor: ResolutionActorContext,
  approvedAt = nowIso(),
) {
  assertResolutionActorContext(actor);
  if (current.status !== "proposed") throw new Error("resolution_approval_not_allowed");
  if (!current.runtime.actions.length || current.runtime.actions.some((action) => action.status !== "pending_approval")) {
    throw new Error("resolution_approval_not_submitted");
  }
  const decision = canApproveResolution(actor, current);
  assertResolutionActionAllowed(decision);
  const approved = approve(current.runtime, actor.displayName, undefined, actor.roles);
  return assertStatusSync(withResolutionRuntime(current, approved, approvedAt));
}

export function resolutionExecutionPayloadHash(input: {
  resolutionCaseId: string;
  action: Pick<ActionRecord, "id" | "type" | "summary">;
  operationKey: string;
}) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

type ResolutionReceiptResult = {
  receipt: string;
  externalRequestId: string;
  receiptSource: "local-ledger";
  receiptAt: string;
};

export function executeResolution(
  current: ResolutionCase,
  actor: ResolutionActorContext,
  operationKey: string,
  receiptFactory: (action: ActionRecord, operationKey: string, payloadHash: string) => ResolutionReceiptResult,
  executedAt = nowIso(),
) {
  assertResolutionActorContext(actor);
  if (
    ["executed", "verified"].includes(current.status) &&
    current.runtime.actions.length > 0 &&
    current.runtime.actions.every((action) => action.receipt && ["succeeded", "verified"].includes(action.status))
  ) return current;
  if (current.status !== "approved") throw new Error("resolution_execution_not_allowed");
  const decision = canExecuteResolution(actor, current);
  assertResolutionActionAllowed(decision);
  const executed = execute(current.runtime, actor.displayName, operationKey, (action, operation) =>
    receiptFactory(action, operation, resolutionExecutionPayloadHash({
      resolutionCaseId: current.id,
      action,
      operationKey: operation,
    })));
  return assertStatusSync(withResolutionRuntime(current, executed, executedAt));
}

export function closeResolution(current: ResolutionCase, actor: ResolutionActorContext, closedAt = nowIso()) {
  assertResolutionActorContext(actor);
  if (current.status === "closed" && current.runtime.status === "closed") return current;
  if (current.status !== "executed") throw new Error("resolution_close_not_allowed");
  const decision = canCloseResolution(actor, current);
  if (!decision.allowed) throw new Error(decision.reasonCode === "RECEIPT_REQUIRED" ? "receipt_required" : decision.reasonCode);
  const closed = verifyAndClose(current.runtime, actor.displayName);
  return assertStatusSync(withResolutionRuntime(current, closed, closedAt));
}
