import type { BusinessEntity, FulfillmentContext, V2Evidence } from "./types.js";
import type { V2SqliteStore } from "./sqlite-store.js";

export type FulfillmentExceptionCode =
  | "SHIPMENT_QUANTITY_SHORTFALL"
  | "PAYMENT_BALANCE_OUTSTANDING"
  | "CUSTOMER_RECEIPT_CLAIM_MISMATCH";

export type FulfillmentException = {
  id: string;
  tenantId: string;
  contextId: string;
  code: FulfillmentExceptionCode;
  ruleId: string;
  entityIds: string[];
  evidenceIds: string[];
  leftValue: number;
  rightValue: number;
  difference: number;
};

type FulfillmentReplay = ReturnType<V2SqliteStore["replayContext"]>;

type NumericFact = {
  entityIds: string[];
  evidenceIds: string[];
  value: number;
};

function numericFact(replay: FulfillmentReplay, entityType: BusinessEntity["entityType"], field: string): NumericFact | undefined {
  const entityIds = new Set(replay.entities.filter((entity) => entity.entityType === entityType).map((entity) => entity.id));
  const evidence = replay.evidence.filter((item) => item.entityId && entityIds.has(item.entityId) && item.field === field);
  const numeric = evidence.filter((item): item is V2Evidence & { value: number } => typeof item.value === "number" && Number.isFinite(item.value));
  if (!numeric.length) return undefined;
  return {
    entityIds: [...entityIds],
    evidenceIds: numeric.map((item) => item.id),
    value: numeric.reduce((sum, item) => sum + item.value, 0),
  };
}

function exception(context: FulfillmentContext, code: FulfillmentExceptionCode, ruleId: string, left: NumericFact, right: NumericFact): FulfillmentException {
  return {
    id: `${context.id}:${code}:${[...left.entityIds, ...right.entityIds].join(":")}`,
    tenantId: context.tenantId,
    contextId: context.id,
    code,
    ruleId,
    entityIds: [...left.entityIds, ...right.entityIds],
    evidenceIds: [...left.evidenceIds, ...right.evidenceIds],
    leftValue: left.value,
    rightValue: right.value,
    difference: Math.abs(left.value - right.value),
  };
}

export function evaluateFulfillmentExceptions(replay: FulfillmentReplay): FulfillmentException[] {
  const context = replay.context;
  if (!context) return [];

  const exceptions: FulfillmentException[] = [];
  const orderQty = numericFact(replay, "sales_order", "qty");
  const shipmentQty = numericFact(replay, "shipment", "qty");
  const receivableAmount = numericFact(replay, "receivable", "amount");
  const paymentAmount = numericFact(replay, "payment", "amount");
  const claimedReceivedQty = numericFact(replay, "complaint", "claimedReceivedQty");

  if (orderQty && shipmentQty && orderQty.value > shipmentQty.value) {
    exceptions.push(exception(context, "SHIPMENT_QUANTITY_SHORTFALL", "V2-RULE-SHIPMENT-SHORTFALL", orderQty, shipmentQty));
  }
  if (receivableAmount && paymentAmount && receivableAmount.value > paymentAmount.value) {
    exceptions.push(exception(context, "PAYMENT_BALANCE_OUTSTANDING", "V2-RULE-PAYMENT-BALANCE", receivableAmount, paymentAmount));
  }
  if (shipmentQty && claimedReceivedQty && shipmentQty.value !== claimedReceivedQty.value) {
    exceptions.push(exception(context, "CUSTOMER_RECEIPT_CLAIM_MISMATCH", "V2-RULE-CUSTOMER-RECEIPT-CLAIM", shipmentQty, claimedReceivedQty));
  }

  return exceptions;
}
