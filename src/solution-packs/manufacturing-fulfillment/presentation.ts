import type { PackPresentation } from "../core/types.js";

export const manufacturingPresentation: PackPresentation = {
  contextLabel: "制造履约上下文",
  entityLabels: {
    quote: "报价",
    sales_order: "销售订单",
    production_order: "生产订单",
    quality_event: "质量检验",
    shipment: "发货",
    receivable: "应收",
    payment: "回款",
    complaint: "客诉",
  },
  exceptionLabels: {
    SHIPMENT_QUANTITY_SHORTFALL: "发货数量低于订单数量",
    PAYMENT_BALANCE_OUTSTANDING: "回款尚未结清",
    CUSTOMER_RECEIPT_CLAIM_MISMATCH: "客户收货主张与发货记录不一致",
    QUOTE_ORDER_QUANTITY_MISMATCH: "报价与订单数量不一致",
    ORDER_PRODUCTION_COMPLETION_SHORTFALL: "订单与生产完成数量不一致",
    QUALITY_NONCONFORMING_QUANTITY_DETECTED: "质检存在未通过数量",
    QUALITY_SHIPMENT_QUANTITY_MISMATCH: "质检合格数量与发货数量不一致",
  },
  ruleLabels: {
    "MANUFACTURING.ORDER_PRODUCTION_COMPLETION_SHORTFALL": "订单与生产完成数量一致",
    "MANUFACTURING.QUALITY_SHIPMENT_QUANTITY_MISMATCH": "质检合格数量与发货数量一致",
  },
  stages: [
    { key: "quote", label: "报价", entityType: "quote", factSelectors: [{ key: "qty", field: "qty" }] },
    { key: "sales_order", label: "销售订单", entityType: "sales_order", factSelectors: [{ key: "qty", field: "qty" }] },
    { key: "production_order", label: "生产订单", entityType: "production_order", factSelectors: [{ key: "plannedQty", field: "plannedQty", label: "计划完成" }, { key: "completedQty", field: "completedQty", label: "生产完成" }] },
    { key: "quality_event", label: "质量检验", entityType: "quality_event", factSelectors: [{ key: "inspectedQty", field: "inspectedQty" }, { key: "passedQty", field: "passedQty" }, { key: "failedQty", field: "failedQty" }] },
    { key: "shipment", label: "发货", entityType: "shipment", factSelectors: [{ key: "qty", field: "qty" }] },
    { key: "receivable", label: "应收", entityType: "receivable", factSelectors: [{ key: "amount", field: "amount" }] },
    { key: "payment", label: "回款", entityType: "payment", factSelectors: [{ key: "amount", field: "amount" }] },
    { key: "complaint", label: "客诉", entityType: "complaint", factSelectors: [{ key: "claimedReceivedQty", field: "claimedReceivedQty" }] },
  ],
};
