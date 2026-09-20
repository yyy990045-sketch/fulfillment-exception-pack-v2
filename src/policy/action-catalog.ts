import type { ActionType, LegacyActionType, PersistedActionType } from "../types.js";
import type { PolicyActionMetadata } from "./types.js";

const ACTION_METADATA: Record<ActionType, PolicyActionMetadata> = {
  create_task: {
    actionType: "create_task",
    label: "创建任务",
    effectClass: "internal_task",
    customerFacing: false,
    financialMovement: false,
    legalEffect: false,
    reversible: true,
    humanReviewTransition: false,
    requiresApprovalBeforeExecution: false,
    materialBusinessEffect: false,
  },
  supplement_evidence: {
    actionType: "supplement_evidence",
    label: "补充证据",
    effectClass: "internal_evidence_request",
    customerFacing: false,
    financialMovement: false,
    legalEffect: false,
    reversible: true,
    humanReviewTransition: false,
    requiresApprovalBeforeExecution: false,
    materialBusinessEffect: false,
  },
  urge_follow_up: {
    actionType: "urge_follow_up",
    label: "跟进催办",
    effectClass: "external_communication",
    customerFacing: true,
    financialMovement: false,
    legalEffect: false,
    reversible: true,
    humanReviewTransition: false,
    requiresApprovalBeforeExecution: true,
    materialBusinessEffect: true,
  },
  route_quotation_to_review: {
    actionType: "route_quotation_to_review",
    label: "送入报价复核",
    effectClass: "internal_review",
    customerFacing: false,
    financialMovement: false,
    legalEffect: false,
    reversible: true,
    humanReviewTransition: true,
    requiresApprovalBeforeExecution: false,
    materialBusinessEffect: false,
  },
  approve_or_change_quotation_terms: {
    actionType: "approve_or_change_quotation_terms",
    label: "批准或变更报价条款",
    effectClass: "commercial_decision",
    customerFacing: true,
    financialMovement: true,
    legalEffect: false,
    reversible: false,
    humanReviewTransition: false,
    requiresApprovalBeforeExecution: true,
    materialBusinessEffect: true,
  },
  reject_overclaim: {
    actionType: "reject_overclaim",
    label: "驳回超额主张",
    effectClass: "customer_decision",
    customerFacing: true,
    financialMovement: true,
    legalEffect: true,
    reversible: false,
    humanReviewTransition: false,
    requiresApprovalBeforeExecution: true,
    materialBusinessEffect: true,
  },
};

const LEGACY_ACTION_METADATA: Record<LegacyActionType, PolicyActionMetadata> = {
  review_quotation: {
    actionType: "review_quotation",
    label: "复核报价（历史）",
    effectClass: "internal_review",
    customerFacing: false,
    financialMovement: false,
    legalEffect: false,
    reversible: true,
    humanReviewTransition: false,
    requiresApprovalBeforeExecution: true,
    materialBusinessEffect: false,
  },
};

export function isWritableActionType(value: string): value is ActionType {
  return Object.prototype.hasOwnProperty.call(ACTION_METADATA, value);
}

export function getPolicyActionMetadata(actionType: PersistedActionType): PolicyActionMetadata {
  return actionType === "review_quotation"
    ? LEGACY_ACTION_METADATA[actionType]
    : ACTION_METADATA[actionType];
}

export function listPolicyActionMetadata(): PolicyActionMetadata[] {
  return Object.values(ACTION_METADATA);
}

export function listWritableActionTypes(): ActionType[] {
  return Object.keys(ACTION_METADATA) as ActionType[];
}
