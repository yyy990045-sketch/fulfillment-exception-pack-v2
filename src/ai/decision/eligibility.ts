import type { ActionType } from "../../types.js";
import type { V2Exception } from "../../domain/v2/index.js";
import type { DecisionActionEligibility } from "./types.js";

export interface DecisionActionEligibilityResolver {
  resolve(exception: V2Exception): DecisionActionEligibility[];
}

const ACTIONS: ActionType[] = ["supplement_evidence", "urge_follow_up", "reject_overclaim", "review_quotation", "create_task"];

export class DefaultDecisionActionEligibilityResolver implements DecisionActionEligibilityResolver {
  resolve(exception: V2Exception): DecisionActionEligibility[] {
    const code = exception.code;
    const eligible = new Map<ActionType, DecisionActionEligibility>();
    for (const actionType of ACTIONS) eligible.set(actionType, {
      actionType,
      eligible: false,
      reason: "not_supported_for_current_exception",
    });
    eligible.set("create_task", { actionType: "create_task", eligible: true, reason: "human_follow_up_allowed" });
    eligible.set("supplement_evidence", { actionType: "supplement_evidence", eligible: true, reason: "current_exception_can_require_more_evidence" });
    if (["PAYMENT_BALANCE_OUTSTANDING", "CUSTOMER_RECEIPT_CLAIM_MISMATCH", "SHIPMENT_QUANTITY_SHORTFALL"].includes(code)) {
      eligible.set("urge_follow_up", { actionType: "urge_follow_up", eligible: true, reason: "operational_follow_up_available" });
    }
    if (code === "QUOTE_ORDER_QUANTITY_MISMATCH") {
      eligible.set("review_quotation", { actionType: "review_quotation", eligible: true, reason: "exception_relates_to_quote_and_order" });
    }
    eligible.set("reject_overclaim", {
      actionType: "reject_overclaim",
      eligible: false,
      reason: "requires_entitlement_or_policy_proof",
    });
    return ACTIONS.map((actionType) => eligible.get(actionType)!);
  }
}
