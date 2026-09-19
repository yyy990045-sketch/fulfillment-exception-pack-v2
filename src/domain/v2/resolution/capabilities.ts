import type { V2Exception } from "../rule-types.js";
import {
  hasResolutionSegregationOfDutiesViolation,
  isResolutionApprover,
} from "./runtime.js";
import type { ResolutionCase } from "./types.js";

export const ASSIGNABLE_OWNER_ROLES = [
  "品质负责人",
  "销售总监",
  "工程师",
  "财务",
  "总经理",
  "管理员",
] as const;

export type CapabilityDecision = {
  applicable: boolean;
  allowed: boolean;
  reasonCode: string;
  reason: string;
};

export type ResolutionCapabilityActor = {
  tenantId: string;
  organization: string;
  user: string;
  subjectId: string;
  roles: string[];
  authnMethod: "demo-header" | "jwt-hs256";
};

export type ResolutionCapabilities = {
  canAccept: CapabilityDecision;
  canReview: CapabilityDecision;
  canPropose: CapabilityDecision;
  canSubmit: CapabilityDecision;
  canApprove: CapabilityDecision;
  canExecute: CapabilityDecision;
  canClose: CapabilityDecision;
};

export type ResolutionCapabilitiesProjection = {
  currentActor: ResolutionCapabilityActor;
  resolutionCapabilities: ResolutionCapabilities;
  assignableOwnerRoles: string[];
};

const notApplicable = (): CapabilityDecision => ({
  applicable: false,
  allowed: false,
  reasonCode: "ACTION_NOT_APPLICABLE",
  reason: "当前流程不适用",
});

const allowed = (): CapabilityDecision => ({
  applicable: true,
  allowed: true,
  reasonCode: "ALLOWED",
  reason: "允许执行",
});

const denied = (reasonCode: string, reason: string): CapabilityDecision => ({
  applicable: true,
  allowed: false,
  reasonCode,
  reason,
});

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

export function buildResolutionCapabilities(input: {
  currentActor: ResolutionCapabilityActor;
  exception: V2Exception;
  hasEvidenceBundle: boolean;
  resolutionCase?: ResolutionCase;
}): ResolutionCapabilitiesProjection {
  const { currentActor, exception, hasEvidenceBundle, resolutionCase } = input;
  const approverAllowed = isResolutionApprover(currentActor.user, currentActor.roles);

  const canAccept = resolutionCase
    ? notApplicable()
    : exception.status !== "detected"
      ? denied("EXCEPTION_NOT_DETECTED", "当前异常尚未进入可受理状态")
      : !hasEvidenceBundle
        ? denied("EXCEPTION_EVIDENCE_BUNDLE_REQUIRED", "缺少异常证据包，不能进入治理")
        : allowed();

  const canReview = resolutionCase?.status === "triaged" ? allowed() : notApplicable();
  const canPropose = resolutionCase?.status === "confirmed" ? allowed() : notApplicable();
  const canSubmit = resolutionCase?.status === "proposed" && hasDraftActions(resolutionCase)
    ? allowed()
    : notApplicable();

  const canApprove = resolutionCase?.status === "proposed" && hasPendingApprovalActions(resolutionCase)
    ? hasResolutionSegregationOfDutiesViolation(resolutionCase, currentActor.user)
      ? denied("SEGREGATION_OF_DUTIES_VIOLATION", "方案提出人与审批人必须分离")
      : approverAllowed
        ? allowed()
        : denied("ROLE_NOT_ALLOWED", "当前角色没有审批权限")
    : notApplicable();

  const canExecute = resolutionCase?.status === "approved"
    ? approverAllowed
      ? allowed()
      : denied("ROLE_NOT_ALLOWED", "当前角色没有执行已批准方案的权限")
    : notApplicable();

  const canClose = resolutionCase?.status === "executed"
    ? !approverAllowed
      ? denied("ROLE_NOT_ALLOWED", "当前角色没有核验结案的权限")
      : !hasCompleteReceipts(resolutionCase)
        ? denied("RECEIPT_REQUIRED", "执行回执不完整，不能结案")
        : allowed()
    : notApplicable();

  return {
    currentActor,
    resolutionCapabilities: {
      canAccept,
      canReview,
      canPropose,
      canSubmit,
      canApprove,
      canExecute,
      canClose,
    },
    assignableOwnerRoles: [...ASSIGNABLE_OWNER_ROLES],
  };
}
