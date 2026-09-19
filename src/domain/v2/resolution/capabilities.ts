import type { V2Exception } from "../rule-types.js";
import { RESOLUTION_OWNER_ROLES } from "../../../authorization.js";
import {
  canAcceptResolution,
  canApproveResolution,
  canCloseResolution,
  canExecuteResolution,
  canProposeResolution,
  canReviewResolution,
  canSubmitResolution,
  type ResolutionActionDecision,
} from "./authorization.js";
import type { ResolutionCase } from "./types.js";

export type ResolutionCapabilityActor = {
  tenantId: string;
  organization: string;
  organizationSource: "demo" | "claim" | "tenant_fallback";
  user: string;
  subjectId: string;
  roles: string[];
  authnMethod: "demo-header" | "jwt-hs256";
};

export type ResolutionCapabilities = {
  canAccept: ResolutionActionDecision;
  canReview: ResolutionActionDecision;
  canPropose: ResolutionActionDecision;
  canSubmit: ResolutionActionDecision;
  canApprove: ResolutionActionDecision;
  canExecute: ResolutionActionDecision;
  canClose: ResolutionActionDecision;
};

export type ResolutionCapabilitiesProjection = {
  currentActor: ResolutionCapabilityActor;
  resolutionCapabilities: ResolutionCapabilities;
  assignableOwnerRoles: string[];
};

export function buildResolutionCapabilities(input: {
  currentActor: ResolutionCapabilityActor;
  exception: V2Exception;
  hasEvidenceBundle: boolean;
  resolutionCase?: ResolutionCase;
}): ResolutionCapabilitiesProjection {
  const { currentActor, exception, hasEvidenceBundle, resolutionCase } = input;
  const subject = { subjectId: currentActor.subjectId, roles: currentActor.roles };

  return {
    currentActor,
    resolutionCapabilities: {
      canAccept: canAcceptResolution(subject, {
        hasResolutionCase: Boolean(resolutionCase),
        exceptionStatus: exception.status,
        hasEvidenceBundle,
      }),
      canReview: resolutionCase ? canReviewResolution(subject, resolutionCase) : {
        applicable: false,
        allowed: false,
        reasonCode: "ACTION_NOT_APPLICABLE",
        reason: "当前流程不适用",
      },
      canPropose: resolutionCase ? canProposeResolution(subject, resolutionCase) : {
        applicable: false,
        allowed: false,
        reasonCode: "ACTION_NOT_APPLICABLE",
        reason: "当前流程不适用",
      },
      canSubmit: resolutionCase ? canSubmitResolution(subject, resolutionCase) : {
        applicable: false,
        allowed: false,
        reasonCode: "ACTION_NOT_APPLICABLE",
        reason: "当前流程不适用",
      },
      canApprove: resolutionCase ? canApproveResolution(subject, resolutionCase) : {
        applicable: false,
        allowed: false,
        reasonCode: "ACTION_NOT_APPLICABLE",
        reason: "当前流程不适用",
      },
      canExecute: resolutionCase ? canExecuteResolution(subject, resolutionCase) : {
        applicable: false,
        allowed: false,
        reasonCode: "ACTION_NOT_APPLICABLE",
        reason: "当前流程不适用",
      },
      canClose: resolutionCase ? canCloseResolution(subject, resolutionCase) : {
        applicable: false,
        allowed: false,
        reasonCode: "ACTION_NOT_APPLICABLE",
        reason: "当前流程不适用",
      },
    },
    assignableOwnerRoles: [...RESOLUTION_OWNER_ROLES],
  };
}
