import type { RuleDefinition, RuleVersion } from "../rule-types.js";
import { ruleVersionContentHash } from "../rule-engine.js";

const tenantId = "demo-industrial";
const createdAt = "2026-09-18T00:00:00.000Z";

export const DEMO_RULE_DEFINITIONS: RuleDefinition[] = [
  {
    id: "rule-shipment-quantity-shortfall",
    tenantId,
    code: "FULFILLMENT.SHIPMENT_QUANTITY_SHORTFALL",
    name: "发货数量短少",
    description: "订单数量大于有效发货数量时产生异常候选。",
    exceptionType: "SHIPMENT_QUANTITY_SHORTFALL",
    enabled: true,
    createdAt,
    metadata: { order: 1 },
  },
  {
    id: "rule-payment-balance-outstanding",
    tenantId,
    code: "FULFILLMENT.PAYMENT_BALANCE_OUTSTANDING",
    name: "回款余额未结清",
    description: "应收金额大于有效回款金额时产生异常候选。",
    exceptionType: "PAYMENT_BALANCE_OUTSTANDING",
    enabled: true,
    createdAt,
    metadata: { order: 2 },
  },
  {
    id: "rule-customer-receipt-claim-mismatch",
    tenantId,
    code: "FULFILLMENT.CUSTOMER_RECEIPT_CLAIM_MISMATCH",
    name: "客户签收声明不一致",
    description: "发货数量与客户声明的收到数量不一致时产生异常候选。",
    exceptionType: "CUSTOMER_RECEIPT_CLAIM_MISMATCH",
    enabled: true,
    createdAt,
    metadata: { order: 3 },
  },
];

function version(id: string, ruleId: string, config: RuleVersion["config"]): RuleVersion {
  return {
    id,
    tenantId,
    ruleId,
    version: "1.0.0",
    status: "active",
    config,
    contentHash: ruleVersionContentHash(config),
    createdAt,
  };
}

export const DEMO_RULE_VERSIONS: RuleVersion[] = [
  version("rule-version-shipment-quantity-shortfall-v1", "rule-shipment-quantity-shortfall", {
    expected: { key: "orderQty", entityType: "sales_order", field: "qty", valueType: "number", aggregation: "single_latest" },
    actual: { key: "shipmentQty", entityType: "shipment", field: "qty", valueType: "number", aggregation: "sum_latest_per_entity" },
    condition: { operator: "lt" },
  }),
  version("rule-version-payment-balance-outstanding-v1", "rule-payment-balance-outstanding", {
    expected: { key: "receivableAmount", entityType: "receivable", field: "amount", valueType: "currency", aggregation: "single_latest" },
    actual: { key: "paymentAmount", entityType: "payment", field: "amount", valueType: "currency", aggregation: "sum_latest_per_entity" },
    condition: { operator: "lt" },
  }),
  version("rule-version-customer-receipt-claim-mismatch-v1", "rule-customer-receipt-claim-mismatch", {
    expected: { key: "shipmentQty", entityType: "shipment", field: "qty", valueType: "number", aggregation: "sum_latest_per_entity" },
    actual: { key: "claimedReceivedQty", entityType: "complaint", field: "claimedReceivedQty", valueType: "number", aggregation: "single_latest" },
    condition: { operator: "neq" },
  }),
];
