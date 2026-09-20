import type { ActionType } from "../types.js";
import type { PolicyMode } from "../domain/v2/policy-types.js";
import { getPolicyActionMetadata } from "./action-catalog.js";

export function policyModeForActionV2(actionType: ActionType): PolicyMode {
  const metadata = getPolicyActionMetadata(actionType);
  if (metadata.materialBusinessEffect && (metadata.financialMovement || metadata.legalEffect || !metadata.reversible)) {
    return "human_only";
  }
  if (metadata.customerFacing || metadata.requiresApprovalBeforeExecution) return "approval_required";
  return "auto_eligible";
}
