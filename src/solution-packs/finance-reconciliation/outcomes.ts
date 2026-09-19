import type { OutcomeDefinitionInput } from "../../outcomes/index.js";

export const financeOutcomeDefinitions: OutcomeDefinitionInput[] = [
  {
    id: "finance.receivable-payment-balance-outstanding",
    version: "1.0.0",
    name: "Finance receivable payment outstanding",
    exceptionCode: "FINANCE.RECEIVABLE_PAYMENT_BALANCE_OUTSTANDING",
    baselineMetricKey: "outstandingAmount",
    currentEvidenceField: "outstandingAmount",
    comparison: "eq",
    targetValue: 0,
    betterDirection: "lower",
    enabled: true,
    metadata: { syntheticPortfolio: true, unit: "currency" },
  },
];
