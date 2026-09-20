import type { ActionType } from "../../types.js";
import type { V2Exception } from "../../domain/v2/index.js";
import type { DecisionActionEligibility } from "./types.js";
import { registerBuiltInSolutionPacks, solutionPackRegistry } from "../../solution-packs/index.js";

export interface DecisionActionEligibilityResolver {
  resolve(exception: V2Exception): DecisionActionEligibility[];
}

const ACTIONS: ActionType[] = [
  "supplement_evidence",
  "urge_follow_up",
  "reject_overclaim",
  "route_quotation_to_review",
  "approve_or_change_quotation_terms",
  "create_task",
];

export class DefaultDecisionActionEligibilityResolver implements DecisionActionEligibilityResolver {
  resolve(exception: V2Exception): DecisionActionEligibility[] {
    const eligible = new Map<ActionType, DecisionActionEligibility>();
    for (const actionType of ACTIONS) eligible.set(actionType, {
      actionType,
      eligible: false,
      reason: "not_supported_for_current_exception",
    });
    eligible.set("create_task", { actionType: "create_task", eligible: true, reason: "human_follow_up_allowed" });
    eligible.set("supplement_evidence", { actionType: "supplement_evidence", eligible: true, reason: "current_exception_can_require_more_evidence" });
    registerBuiltInSolutionPacks();
    for (const pack of solutionPackRegistry.list()) {
      for (const contribution of pack.decisionEligibilityResolver?.(exception.code) ?? []) {
        eligible.set(contribution.actionType, contribution);
      }
    }
    eligible.set("reject_overclaim", {
      actionType: "reject_overclaim",
      eligible: false,
      reason: "requires_entitlement_or_policy_proof",
    });
    eligible.set("approve_or_change_quotation_terms", {
      actionType: "approve_or_change_quotation_terms",
      eligible: false,
      reason: "requires_human_commercial_decision",
    });
    return ACTIONS.map((actionType) => eligible.get(actionType)!);
  }
}
