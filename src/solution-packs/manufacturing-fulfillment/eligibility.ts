import type { PackDecisionEligibilityContribution } from "../core/types.js";

export function manufacturingEligibility(exceptionCode: string): PackDecisionEligibilityContribution[] | undefined {
  if (["PAYMENT_BALANCE_OUTSTANDING", "CUSTOMER_RECEIPT_CLAIM_MISMATCH", "SHIPMENT_QUANTITY_SHORTFALL"].includes(exceptionCode)) {
    return [{ actionType: "urge_follow_up", eligible: true, reason: "operational_follow_up_available" }];
  }
  if (exceptionCode === "QUOTE_ORDER_QUANTITY_MISMATCH") {
    return [{ actionType: "review_quotation", eligible: true, reason: "exception_relates_to_quote_and_order" }];
  }
  return undefined;
}
