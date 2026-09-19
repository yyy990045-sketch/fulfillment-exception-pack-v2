import type { EvidenceItem, EvidenceRole, ThreadFact } from "./types.js";

export { resolutionStatusLabel } from "../../lib/presentation.js";

export const evidenceRoleLabels: Record<EvidenceRole, string> = {
  expected: "规则期望",
  actual: "系统记录",
  claim: "客户主张",
  context: "上下文证据",
};

export function formatBusinessValue(fact: Pick<ThreadFact, "value" | "valueType"> | { value: unknown; valueType?: string }) {
  if (fact.value === null || fact.value === undefined) return "—";
  if (typeof fact.value !== "number") return String(fact.value);
  const formatted = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(fact.value);
  return fact.valueType === "currency" && !formatted.includes("¥") ? `¥${formatted}` : formatted;
}

export function formatMetricValue(value: unknown) {
  if (typeof value === "number") return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
  if (value === null || value === undefined) return "—";
  return String(value);
}

export function metricLabel(key: string) {
  const labels: Record<string, string> = {
    difference: "差异",
    outstandingAmount: "未结清",
    shortfall: "短少",
    nonconformingQty: "未通过数量",
    passRatio: "合格率",
    receivedQuantity: "记录收到",
    claimedReceivedQty: "客户主张收到",
    shippedQty: "发货数量",
    expected: "规则期望",
    actual: "系统记录",
    verifiedReceiptDifference: "已验证差异",
    openNonconformingQty: "待处理不合格数量",
    baselineDifference: "基准差异",
  };
  return labels[key] ?? key;
}

export function exceptionStatusLabel(status: string) {
  const labels: Record<string, string> = {
    detected: "已发现",
    open: "待处理",
    confirmed: "已确认",
    resolved: "已解决",
    closed: "已结案",
  };
  return labels[status] ?? status;
}

export function actionTypeLabel(actionType: string) {
  const labels: Record<string, string> = {
    supplement_evidence: "补充证据",
    urge_follow_up: "跟进催办",
    reject_overclaim: "驳回超额主张",
    review_quotation: "复核报价",
    create_task: "创建任务",
  };
  return labels[actionType] ?? actionType;
}

export function governanceActionStatusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "方案草稿",
    pending_approval: "待审批",
    authorized: "已授权",
    executing: "执行中",
    succeeded: "已完成",
    failed: "执行失败",
    verified: "已核验",
  };
  return labels[status] ?? "状态未记录";
}

export function policyModeLabel(mode: string) {
  const labels: Record<string, string> = {
    human_only: "仅人工决策",
    approval_required: "需人工审批",
    auto_eligible: "可进入自动执行评估",
  };
  return labels[mode] ?? "处理方式未记录";
}

export function contextTypeLabel(contextType: string) {
  const labels: Record<string, string> = {
    sales_order: "销售订单",
    finance_reconciliation: "财务对账",
  };
  return labels[contextType] ?? contextType;
}

export function formatShortDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function sourceSystemLabel(systemType: string, fallback: string) {
  const labels: Record<string, string> = {
    erp: "订单系统",
    mes: "生产系统",
    qms: "质量系统",
    wms: "仓储系统",
    crm: "客户系统",
    finance: "财务系统",
    service: "客户服务记录",
    manual: "人工记录",
    file: "文件来源",
  };
  if (systemType === "service") return labels.service;
  const normalized = `${systemType} ${fallback}`.toLowerCase();
  if (normalized.includes("customer-service") || normalized.includes("customer service")) return "客户服务记录";
  return labels[systemType] ?? fallback;
}

const businessFactLabels: Record<string, string> = {
  qty: "数量",
  amount: "金额",
  plannedQty: "计划数量",
  completedQty: "完成数量",
  inspectedQty: "检验数量",
  passedQty: "合格数量",
  failedQty: "未通过数量",
  claimedReceivedQty: "客户主张收到",
  outstandingAmount: "未结清金额",
  verifiedReceiptDifference: "已验证差异",
  openNonconformingQty: "待处理不合格数量",
  difference: "差异",
  shortfall: "短少",
};

export function businessFactLabel(key: string) {
  return businessFactLabels[key] ?? "业务事实";
}

export function exceptionBadgeLabel(ruleCode: string) {
  const code = ruleCode.toUpperCase();
  if (code.includes("CUSTOMER_RECEIPT_CLAIM_MISMATCH") || code.includes("CUSTOMER_CLAIM")) return "签收差异";
  if (code.includes("PAYMENT_BALANCE_OUTSTANDING") || code.includes("PAYMENT")) return "回款未清";
  if (code.includes("QUALITY_NONCONFORMING") || code.includes("QUALITY")) return "质量异常";
  if (code.includes("SHIPMENT_QUANTITY_SHORTFALL") || code.includes("SHIPMENT")) return "发货短少";
  if (code.includes("QUOTE_ORDER")) return "报价订单差异";
  if (code.includes("PRODUCTION")) return "生产短少";
  return "需要关注";
}

export function fieldLabel(field: string) {
  const labels: Record<string, string> = {
    qty: "数量",
    amount: "金额",
    plannedQty: "计划数量",
    completedQty: "完成数量",
    inspectedQty: "检验数量",
    passedQty: "合格数量",
    failedQty: "未通过数量",
    claimedReceivedQty: "客户主张收到",
    outstandingAmount: "未结清金额",
    verifiedReceiptDifference: "已验证差异",
    openNonconformingQty: "待处理不合格数量",
  };
  return labels[field] ?? field;
}

export function formatLocator(locator: Record<string, unknown> | undefined) {
  if (!locator) return [];
  const labels: Record<string, string> = {
    fileName: "文件",
    sheet: "工作表",
    row: "行",
    cell: "单元格",
  };
  return Object.entries(locator)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => ({ label: labels[key] ?? key, value: String(value) }));
}

export function evidenceTitle(item: EvidenceItem) {
  const role = evidenceRoleLabels[item.role] ?? item.role;
  return `${role} · ${fieldLabel(item.field)}`;
}
