import type { RuleDefinition, RuleVersion } from "../rule-types.js";
import { ruleVersionContentHash } from "../rule-engine.js";

const createdAt = "2026-09-18T00:00:00.000Z";

export function buildBaseFulfillmentRuleDefinitions(tenantId: string): RuleDefinition[] {
  return [
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
    {
      id: "rule-quote-order-quantity-mismatch",
      tenantId,
      code: "FULFILLMENT.QUOTE_ORDER_QUANTITY_MISMATCH",
      name: "报价与订单数量不一致",
      description: "报价数量和订单数量不一致时产生异常候选。",
      exceptionType: "QUOTE_ORDER_QUANTITY_MISMATCH",
      enabled: true,
      createdAt,
      metadata: { order: 4 },
    },
  ];
}

function version(tenantId: string, id: string, ruleId: string, config: RuleVersion["config"]): RuleVersion {
  return {
    id,
    tenantId,
    ruleId,
    version: "1.1.0",
    status: "active",
    config,
    contentHash: ruleVersionContentHash(config),
    createdAt,
  };
}

export function buildBaseFulfillmentRuleVersions(tenantId: string): RuleVersion[] {
  return [
    version(tenantId, "rule-version-shipment-quantity-shortfall-v1-1", "rule-shipment-quantity-shortfall", {
      expected: { key: "orderQty", entityType: "sales_order", field: "qty", valueType: "number", aggregation: "single_latest" },
      actual: { key: "shipmentQty", entityType: "shipment", field: "qty", valueType: "number", aggregation: "sum_latest_per_entity" },
      condition: { operator: "lt" },
      metrics: [
        { key: "difference", type: "absolute_difference" },
        { key: "shortfall", type: "positive_difference" },
        { key: "shortfallRatio", type: "difference_ratio" },
      ],
      evidenceRoles: { orderQty: "expected", shipmentQty: "actual" },
      presentation: {
        title: "发货数量低于订单数量",
        summaryTemplate: "订单数量 {expected}，累计发货数量 {actual}，差异 {difference}。",
      },
      severity: "medium",
    }),
    version(tenantId, "rule-version-payment-balance-outstanding-v1-1", "rule-payment-balance-outstanding", {
      expected: { key: "receivableAmount", entityType: "receivable", field: "amount", valueType: "currency", aggregation: "single_latest" },
      actual: { key: "paymentAmount", entityType: "payment", field: "amount", valueType: "currency", aggregation: "sum_latest_per_entity" },
      condition: { operator: "lt" },
      metrics: [
        { key: "difference", type: "absolute_difference" },
        { key: "outstandingAmount", type: "positive_difference" },
        { key: "paymentRatio", type: "ratio" },
      ],
      evidenceRoles: { receivableAmount: "expected", paymentAmount: "actual" },
      presentation: {
        title: "应收余额尚未全部覆盖",
        summaryTemplate: "应收金额 {expected}，已记录回款 {actual}，尚有 {outstandingAmount} 未覆盖。",
      },
      severity: "medium",
    }),
    version(tenantId, "rule-version-customer-receipt-claim-mismatch-v1-1", "rule-customer-receipt-claim-mismatch", {
      expected: { key: "shipmentQty", entityType: "shipment", field: "qty", valueType: "number", aggregation: "sum_latest_per_entity" },
      actual: { key: "claimedReceivedQty", entityType: "complaint", field: "claimedReceivedQty", valueType: "number", aggregation: "single_latest" },
      condition: { operator: "neq" },
      metrics: [{ key: "difference", type: "absolute_difference" }],
      evidenceRoles: { shipmentQty: "actual", claimedReceivedQty: "claim" },
      presentation: {
        title: "客户收货主张与系统发货记录不一致",
        summaryTemplate: "系统发货记录为 {expected} 件，客户主张收到 {actual} 件，存在 {difference} 件差异，需进一步核验。",
      },
      severity: "high",
    }),
    version(tenantId, "rule-version-quote-order-quantity-mismatch-v1-1", "rule-quote-order-quantity-mismatch", {
      expected: { key: "quoteQty", entityType: "quote", field: "qty", valueType: "number", aggregation: "single_latest" },
      actual: { key: "orderQty", entityType: "sales_order", field: "qty", valueType: "number", aggregation: "single_latest" },
      condition: { operator: "neq" },
      metrics: [{ key: "difference", type: "absolute_difference" }],
      evidenceRoles: { quoteQty: "expected", orderQty: "actual" },
      presentation: {
        title: "报价与订单数量不一致",
        summaryTemplate: "报价数量 {expected}，订单数量 {actual}，差异 {difference}。",
      },
      severity: "medium",
    }),
  ];
}

export const DEMO_RULE_DEFINITIONS = buildBaseFulfillmentRuleDefinitions("demo-industrial");
export const DEMO_RULE_VERSIONS = buildBaseFulfillmentRuleVersions("demo-industrial");
