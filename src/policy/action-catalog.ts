import type { ActionType } from "../types.js";
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
  },
  supplement_evidence: {
    actionType: "supplement_evidence",
    label: "补充证据",
    effectClass: "internal_evidence_request",
    customerFacing: false,
    financialMovement: false,
    legalEffect: false,
    reversible: true,
  },
  urge_follow_up: {
    actionType: "urge_follow_up",
    label: "跟进催办",
    effectClass: "external_communication",
    customerFacing: true,
    financialMovement: false,
    legalEffect: false,
    reversible: true,
  },
  review_quotation: {
    actionType: "review_quotation",
    label: "复核报价",
    effectClass: "internal_review",
    customerFacing: false,
    financialMovement: false,
    legalEffect: false,
    reversible: true,
  },
  reject_overclaim: {
    actionType: "reject_overclaim",
    label: "驳回超额主张",
    effectClass: "customer_decision",
    customerFacing: true,
    financialMovement: true,
    legalEffect: true,
    reversible: false,
  },
};

export function getPolicyActionMetadata(actionType: ActionType): PolicyActionMetadata {
  return ACTION_METADATA[actionType];
}

export function listPolicyActionMetadata(): PolicyActionMetadata[] {
  return Object.values(ACTION_METADATA);
}
