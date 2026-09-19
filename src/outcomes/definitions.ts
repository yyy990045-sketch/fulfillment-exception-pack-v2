import { createHash } from "node:crypto";
import type { V2SqliteStore } from "../domain/v2/index.js";
import type { OutcomeDefinitionInput } from "./types.js";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function outcomeDefinitionContentHash(input: OutcomeDefinitionInput) {
  return createHash("sha256").update(stableJson(input)).digest("hex");
}

export const DEFAULT_MANUFACTURING_OUTCOME_DEFINITIONS: OutcomeDefinitionInput[] = [
  {
    id: "outcome-customer-receipt-verified-difference",
    version: "1.0.0",
    name: "Customer receipt verified difference",
    exceptionCode: "CUSTOMER_RECEIPT_CLAIM_MISMATCH",
    baselineMetricKey: "difference",
    currentEvidenceField: "verifiedReceiptDifference",
    comparison: "eq",
    targetValue: 0,
    betterDirection: "lower",
    enabled: true,
    metadata: { syntheticPortfolio: true, unit: "quantity" },
  },
  {
    id: "outcome-payment-outstanding-amount",
    version: "1.0.0",
    name: "Payment outstanding amount",
    exceptionCode: "PAYMENT_BALANCE_OUTSTANDING",
    baselineMetricKey: "outstandingAmount",
    currentEvidenceField: "outstandingAmount",
    comparison: "eq",
    targetValue: 0,
    betterDirection: "lower",
    enabled: true,
    metadata: { syntheticPortfolio: true, unit: "currency" },
  },
  {
    id: "outcome-quality-open-nonconforming",
    version: "1.0.0",
    name: "Open nonconforming quantity",
    exceptionCode: "QUALITY_NONCONFORMING_QUANTITY_DETECTED",
    baselineMetricKey: "nonconformingQty",
    currentEvidenceField: "openNonconformingQty",
    comparison: "eq",
    targetValue: 0,
    betterDirection: "lower",
    enabled: true,
    metadata: { syntheticPortfolio: true, unit: "quantity" },
  },
];

export function provisionDefaultManufacturingOutcomeDefinitions(
  store: V2SqliteStore,
  tenantId = "demo-manufacturing",
) {
  const createdAt = "2026-09-01T00:00:00.000Z";
  return DEFAULT_MANUFACTURING_OUTCOME_DEFINITIONS.map((definition) => store.saveOutcomeDefinition({
    tenantId,
    ...definition,
    contentHash: outcomeDefinitionContentHash(definition),
    createdAt,
  }));
}
