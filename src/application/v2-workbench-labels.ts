export const V2_ENTITY_LABELS: Record<string, string> = {
  quote: "报价",
  sales_order: "销售订单",
  production_order: "生产订单",
  quality_event: "质量检验",
  shipment: "发货",
  receivable: "应收",
  payment: "回款",
  complaint: "客诉",
  contract: "合同",
};

export const V2_EVENT_LABELS: Record<string, string> = {
  QUOTE_CREATED: "报价创建",
  ORDER_CREATED: "订单创建",
  PRODUCTION_STARTED: "生产开始",
  PRODUCTION_COMPLETED: "生产完成",
  QUALITY_INSPECTED: "质量检验",
  QUALITY_PASSED: "质量合格",
  QUALITY_FAILED: "质量不合格",
  SHIPMENT_CREATED: "发货创建",
  SHIPMENT_DISPATCHED: "发货发出",
  SHIPMENT_SIGNED: "客户签收",
  RECEIVABLE_CREATED: "应收创建",
  PAYMENT_RECEIVED: "回款到账",
  COMPLAINT_OPENED: "客诉创建",
  COMPLAINT_UPDATED: "客诉更新",
};

export const V2_EXCEPTION_LABELS: Record<string, string> = {
  SHIPMENT_QUANTITY_SHORTFALL: "发货数量低于订单数量",
  PAYMENT_BALANCE_OUTSTANDING: "回款尚未结清",
  CUSTOMER_RECEIPT_CLAIM_MISMATCH: "客户收货主张与发货记录不一致",
  QUOTE_ORDER_QUANTITY_MISMATCH: "报价与订单数量不一致",
  ORDER_PRODUCTION_COMPLETION_SHORTFALL: "订单与生产完成数量不一致",
  QUALITY_NONCONFORMING_QUANTITY_DETECTED: "质检存在未通过数量",
  QUALITY_SHIPMENT_QUANTITY_MISMATCH: "质检合格数量与发货数量不一致",
};

export const V2_FIELD_LABELS: Record<string, string> = {
  qty: "数量",
  plannedQty: "计划数量",
  completedQty: "完成数量",
  inspectedQty: "检验数量",
  passedQty: "合格数量",
  failedQty: "未通过数量",
  claimedReceivedQty: "客户主张收到",
  amount: "金额",
};

export function v2EntityLabel(value: string) {
  return V2_ENTITY_LABELS[value] ?? value;
}

export function v2EventLabel(value: string) {
  return V2_EVENT_LABELS[value] ?? value;
}

export function v2ExceptionLabel(value: string) {
  return V2_EXCEPTION_LABELS[value] ?? value;
}

export function v2FieldLabel(value: string) {
  return V2_FIELD_LABELS[value] ?? value;
}
