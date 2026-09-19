import type { PackDecisionEligibilityContribution } from "../core/types.js";

export function financeEligibility(exceptionCode: string): PackDecisionEligibilityContribution[] | undefined {
  if (exceptionCode === "FINANCE.RECEIVABLE_PAYMENT_BALANCE_OUTSTANDING") {
    return [{ actionType: "urge_follow_up", eligible: true, reason: "finance_follow_up_allowed" }];
  }
  return undefined;
}
