import type { EvidenceItem, EvidenceRole, ThreadFact } from "./types.js";

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
