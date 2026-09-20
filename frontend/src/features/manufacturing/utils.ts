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
    route_quotation_to_review: "送入报价复核",
    approve_or_change_quotation_terms: "批准或变更报价条款",
    review_quotation: "复核报价（历史）",
    create_task: "创建任务",
  };
  return labels[actionType] ?? actionType;
}

export function actionTypeDescription(actionType: string) {
  const descriptions: Record<string, string> = {
    supplement_evidence: "补充缺失材料或核验依据。",
    urge_follow_up: "向业务相关方发起跟进或催办。",
    reject_overclaim: "驳回缺少依据或超出业务边界的客户主张。",
    route_quotation_to_review: "将报价或商业条款差异交由授权人员复核。",
    approve_or_change_quotation_terms: "涉及报价或商业条款的正式业务决定，必须由人工处理。",
    review_quotation: "历史复核动作，仅供历史记录展示。",
    create_task: "创建内部跟进任务。",
  };
  return descriptions[actionType] ?? "业务处理动作。";
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
    approval_required: "需要独立审批",
    auto_eligible: "可进入受控内部流程",
  };
  return labels[mode] ?? "处理方式未记录";
}

export function policyReasonLabel(reason: string) {
  const labels: Record<string, string> = {
    customer_or_legal_consequence: "涉及客户或法律后果，需要人工决策。",
    legal_effect_requires_human_decision: "涉及法律影响，必须由人工决策。",
    financial_movement_requires_human_decision: "涉及财务影响，必须由人工决策。",
    external_customer_communication: "涉及对外沟通，需要独立审批。",
    human_review_transition: "该动作本身是进入人工复核，不需要额外审批。",
    commercial_terms_decision_requires_human: "涉及报价或商业条款变更，必须由人工决策。",
    business_review_required: "需要业务复核。",
    default_deny: "未命中自动处理条件，按默认治理策略交人工。",
  };
  return labels[reason] ?? "治理要求已记录。";
}

export function policyEffectClassLabel(effectClass: string) {
  const labels: Record<string, string> = {
    internal_task: "内部任务",
    internal_evidence_request: "内部补证",
    external_communication: "对外沟通",
    internal_review: "内部复核",
    commercial_decision: "商业条款决策",
    customer_decision: "客户决策",
  };
  return labels[effectClass] ?? "业务动作";
}

export function decisionProviderLabel(provider: string) {
  const normalized = provider.trim().toLowerCase();
  if (normalized.includes("deterministic")) return "本地确定性建议";
  if (normalized === "openai" || normalized.startsWith("openai-")) return "OpenAI 建议生成";
  if (normalized === "jev" || normalized.startsWith("jev-")) return "Jev 建议生成";
  return "其他建议生成来源";
}

export function evidenceSupportLabel(support: string) {
  const labels: Record<string, string> = {
    supported: "已支持",
    partial: "部分支持",
    unsupported: "不支持",
  };
  return labels[support] ?? "支持状态未记录";
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
