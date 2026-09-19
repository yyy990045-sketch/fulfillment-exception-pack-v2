import type { ActionType } from "../types.js";
import type { PolicyActionMetadata } from "./types.js";

const ACTION_METADATA: Record<ActionType, PolicyActionMetadata> = {
  create_task: {
    actionType: "create_task",
    effectClass: "internal_task",
    customerFacing: false,
    financialMovement: false,
    legalEffect: false,
    reversible: true,
  },
  supplement_evidence: {
    actionType: "supplement_evidence",
    effectClass: "internal_evidence_request",
    customerFacing: false,
    financialMovement: false,
    legalEffect: false,
    reversible: true,
  },
  urge_follow_up: {
    actionType: "urge_follow_up",
    effectClass: "external_communication",
    customerFacing: true,
    financialMovement: false,
    legalEffect: false,
    reversible: true,
  },
  review_quotation: {
    actionType: "review_quotation",
    effectClass: "internal_review",
    customerFacing: false,
    financialMovement: false,
    legalEffect: false,
    reversible: true,
  },
  reject_overclaim: {
    actionType: "reject_overclaim",
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
