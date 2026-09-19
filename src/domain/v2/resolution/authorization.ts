import {
  isResolutionApprover,
  isResolutionOwner,
  type AuthorizationSubject,
} from "../../../authorization.js";
import type { ResolutionCase } from "./types.js";

export type ResolutionActionDecision = {
  applicable: boolean;
  allowed: boolean;
  reasonCode: string;
  reason: string;
};

const notApplicable = (): ResolutionActionDecision => ({
  applicable: false,
  allowed: false,
  reasonCode: "ACTION_NOT_APPLICABLE",
  reason: "当前流程不适用",
});

const allowed = (): ResolutionActionDecision => ({
  applicable: true,
  allowed: true,
  reasonCode: "ALLOWED",
  reason: "允许执行",
});

const denied = (reasonCode: string, reason: string): ResolutionActionDecision => ({
  applicable: true,
  allowed: false,
  reasonCode,
  reason,
});

function ownerDenied() {
  return denied("ROLE_NOT_ALLOWED", "当前角色没有治理操作权限");
}

function hasPendingApprovalActions(resolution: ResolutionCase) {
  return resolution.runtime.actions.length > 0 &&
    resolution.runtime.actions.every((action) => action.status === "pending_approval");
}

function hasDraftActions(resolution: ResolutionCase) {
  return resolution.runtime.actions.length > 0 &&
    resolution.runtime.actions.every((action) => action.status === "draft");
}

function hasCompleteReceipts(resolution: ResolutionCase) {
  return resolution.runtime.actions.length > 0 &&
    resolution.runtime.actions.every((action) =>
      Boolean(action.receipt) &&
      action.receiptSource === "local-ledger" &&
      ["succeeded", "verified"].includes(action.status),
    );
}

export function canAcceptResolution(subject: AuthorizationSubject, input: {
  hasResolutionCase: boolean;
  exceptionStatus: string;
  hasEvidenceBundle: boolean;
}) {
  if (input.hasResolutionCase) return notApplicable();
  if (input.exceptionStatus !== "detected") return denied("EXCEPTION_NOT_DETECTED", "当前异常尚未进入可受理状态");
  if (!input.hasEvidenceBundle) return denied("EXCEPTION_EVIDENCE_BUNDLE_REQUIRED", "缺少异常证据包，不能进入治理");
  return isResolutionOwner(subject) ? allowed() : ownerDenied();
}

export function canReviewResolution(subject: AuthorizationSubject, resolutionCase: ResolutionCase) {
  if (resolutionCase.status !== "triaged") return notApplicable();
  return isResolutionOwner(subject) ? allowed() : ownerDenied();
}

export function canProposeResolution(subject: AuthorizationSubject, resolutionCase: ResolutionCase) {
  if (resolutionCase.status !== "confirmed") return notApplicable();
  return isResolutionOwner(subject) ? allowed() : ownerDenied();
}

export function canSubmitResolution(subject: AuthorizationSubject, resolutionCase: ResolutionCase) {
  if (resolutionCase.status !== "proposed" || !hasDraftActions(resolutionCase)) return notApplicable();
  return isResolutionOwner(subject) ? allowed() : ownerDenied();
}

export function canApproveResolution(subject: AuthorizationSubject, resolutionCase: ResolutionCase) {
  if (resolutionCase.status !== "proposed" || !hasPendingApprovalActions(resolutionCase)) return notApplicable();
  const reviewSubjectId = resolutionCase.review?.actorSubjectId;
  const proposedBySubjectId = resolutionCase.runtime.proposedBySubjectId;
  if (!reviewSubjectId || !proposedBySubjectId) {
    return denied("APPROVAL_SUBJECT_IDENTITY_REQUIRED", "审批身份链不完整，不能审批");
  }
  if (reviewSubjectId === subject.subjectId || proposedBySubjectId === subject.subjectId) {
    return denied("SEGREGATION_OF_DUTIES_VIOLATION", "方案提出人与审批人必须分离");
  }
  return isResolutionApprover(subject)
    ? allowed()
    : denied("ROLE_NOT_ALLOWED", "当前角色没有审批权限");
}

export function canExecuteResolution(subject: AuthorizationSubject, resolutionCase: ResolutionCase) {
  if (resolutionCase.status !== "approved") return notApplicable();
  return isResolutionApprover(subject)
    ? allowed()
    : denied("ROLE_NOT_ALLOWED", "当前角色没有执行已批准方案的权限");
}

export function canCloseResolution(subject: AuthorizationSubject, resolutionCase: ResolutionCase) {
  if (resolutionCase.status !== "executed") return notApplicable();
  if (!isResolutionApprover(subject)) return denied("ROLE_NOT_ALLOWED", "当前角色没有核验结案的权限");
  return hasCompleteReceipts(resolutionCase)
    ? allowed()
    : denied("RECEIPT_REQUIRED", "执行回执不完整，不能结案");
}
