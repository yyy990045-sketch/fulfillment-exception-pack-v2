export type OperationalResolutionTarget =
  | "no_case"
  | "triaged"
  | "confirmed"
  | "proposed_draft"
  | "pending_approval"
  | "approved"
  | "executed"
  | "closed"
  | "rejected";

export type OperationalPortfolioSpec = {
  businessKey: string;
  openedAt: string;
  quoteQty: number;
  orderQty: number;
  productionPlannedQty: number;
  productionCompletedQty: number;
  qualityInspectedQty: number;
  qualityPassedQty: number;
  shipmentQty: number;
  receivableAmount: number;
  paymentAmount: number;
  claimedReceivedQty: number;
  resolutionTarget: OperationalResolutionTarget;
  resolutionExceptionCode?: string;
};

export const OPERATIONAL_PORTFOLIO: OperationalPortfolioSpec[] = [
  { businessKey: "SO-OPS-001", openedAt: "2026-08-01T00:00:00.000Z", quoteQty: 100, orderQty: 100, productionPlannedQty: 100, productionCompletedQty: 100, qualityInspectedQty: 100, qualityPassedQty: 96, shipmentQty: 96, receivableAmount: 100000, paymentAmount: 80000, claimedReceivedQty: 80, resolutionTarget: "no_case" },
  { businessKey: "SO-OPS-002", openedAt: "2026-08-05T00:00:00.000Z", quoteQty: 100, orderQty: 100, productionPlannedQty: 100, productionCompletedQty: 100, qualityInspectedQty: 100, qualityPassedQty: 98, shipmentQty: 98, receivableAmount: 90000, paymentAmount: 90000, claimedReceivedQty: 98, resolutionTarget: "triaged", resolutionExceptionCode: "QUALITY_NONCONFORMING_QUANTITY_DETECTED" },
  { businessKey: "SO-OPS-003", openedAt: "2026-08-10T00:00:00.000Z", quoteQty: 100, orderQty: 95, productionPlannedQty: 95, productionCompletedQty: 95, qualityInspectedQty: 95, qualityPassedQty: 92, shipmentQty: 92, receivableAmount: 80000, paymentAmount: 60000, claimedReceivedQty: 90, resolutionTarget: "confirmed", resolutionExceptionCode: "CUSTOMER_RECEIPT_CLAIM_MISMATCH" },
  { businessKey: "SO-OPS-004", openedAt: "2026-08-15T00:00:00.000Z", quoteQty: 100, orderQty: 100, productionPlannedQty: 100, productionCompletedQty: 98, qualityInspectedQty: 100, qualityPassedQty: 96, shipmentQty: 96, receivableAmount: 100000, paymentAmount: 100000, claimedReceivedQty: 96, resolutionTarget: "proposed_draft", resolutionExceptionCode: "QUALITY_NONCONFORMING_QUANTITY_DETECTED" },
  { businessKey: "SO-OPS-005", openedAt: "2026-08-20T00:00:00.000Z", quoteQty: 100, orderQty: 100, productionPlannedQty: 100, productionCompletedQty: 100, qualityInspectedQty: 100, qualityPassedQty: 99, shipmentQty: 99, receivableAmount: 100000, paymentAmount: 90000, claimedReceivedQty: 99, resolutionTarget: "pending_approval", resolutionExceptionCode: "PAYMENT_BALANCE_OUTSTANDING" },
  { businessKey: "SO-OPS-006", openedAt: "2026-08-25T00:00:00.000Z", quoteQty: 100, orderQty: 100, productionPlannedQty: 100, productionCompletedQty: 100, qualityInspectedQty: 100, qualityPassedQty: 97, shipmentQty: 97, receivableAmount: 100000, paymentAmount: 85000, claimedReceivedQty: 95, resolutionTarget: "approved", resolutionExceptionCode: "CUSTOMER_RECEIPT_CLAIM_MISMATCH" },
  { businessKey: "SO-OPS-007", openedAt: "2026-09-01T00:00:00.000Z", quoteQty: 100, orderQty: 100, productionPlannedQty: 100, productionCompletedQty: 100, qualityInspectedQty: 100, qualityPassedQty: 95, shipmentQty: 95, receivableAmount: 100000, paymentAmount: 100000, claimedReceivedQty: 95, resolutionTarget: "executed", resolutionExceptionCode: "QUALITY_NONCONFORMING_QUANTITY_DETECTED" },
  { businessKey: "SO-OPS-008", openedAt: "2026-09-05T00:00:00.000Z", quoteQty: 100, orderQty: 100, productionPlannedQty: 100, productionCompletedQty: 100, qualityInspectedQty: 100, qualityPassedQty: 100, shipmentQty: 100, receivableAmount: 100000, paymentAmount: 100000, claimedReceivedQty: 100, resolutionTarget: "no_case" },
  { businessKey: "SO-OPS-009", openedAt: "2026-09-08T00:00:00.000Z", quoteQty: 100, orderQty: 90, productionPlannedQty: 90, productionCompletedQty: 90, qualityInspectedQty: 90, qualityPassedQty: 88, shipmentQty: 88, receivableAmount: 80000, paymentAmount: 70000, claimedReceivedQty: 85, resolutionTarget: "rejected", resolutionExceptionCode: "CUSTOMER_RECEIPT_CLAIM_MISMATCH" },
  { businessKey: "SO-OPS-010", openedAt: "2026-09-10T00:00:00.000Z", quoteQty: 100, orderQty: 100, productionPlannedQty: 100, productionCompletedQty: 90, qualityInspectedQty: 100, qualityPassedQty: 94, shipmentQty: 94, receivableAmount: 100000, paymentAmount: 90000, claimedReceivedQty: 94, resolutionTarget: "closed", resolutionExceptionCode: "QUALITY_NONCONFORMING_QUANTITY_DETECTED" },
];
