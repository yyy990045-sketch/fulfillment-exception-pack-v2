export type StatusTone = "default" | "info" | "warning" | "danger" | "success";

const severityLabels: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "严重",
};

const resolutionStatusLabels: Record<string, string> = {
  no_case: "未进入治理",
  triaged: "待复核",
  confirmed: "已确认",
  proposed: "待审批",
  proposed_draft: "方案草案",
  pending_approval: "待审批",
  approved: "已批准",
  executed: "已执行",
  closed: "已结案",
  rejected: "已终止",
};

const outcomeStatusLabels: Record<string, string> = {
  target_met: "目标达成",
  improved: "改善",
  unchanged: "未变化",
  worsened: "恶化",
  insufficient_evidence: "证据不足",
};

const contextStatusLabels: Record<string, string> = {
  active: "进行中",
  closed: "已关闭",
  archived: "已归档",
};

const capabilityLabels: Record<string, string> = {
  rules: "规则检测",
  outcomes: "结果测量",
  presentation: "业务线程",
  decisionEligibility: "决策支持",
};

export function severityLabel(value: string | null | undefined) {
  return value ? severityLabels[value] ?? "未知等级" : "未知等级";
}

export function severityTone(value: string | null | undefined): StatusTone {
  if (value === "critical" || value === "high") return "danger";
  if (value === "medium") return "warning";
  return "default";
}

export function resolutionStatusLabel(status: string) {
  return resolutionStatusLabels[status] ?? "状态未记录";
}

export function resolutionStatusTone(status: string): StatusTone {
  if (status === "closed" || status === "approved") return "success";
  if (status === "executed" || status === "confirmed") return "info";
  if (status === "triaged" || status === "proposed" || status === "proposed_draft" || status === "pending_approval") {
    return "warning";
  }
  if (status === "rejected") return "danger";
  return "default";
}

export function outcomeStatusLabel(status: string) {
  return outcomeStatusLabels[status] ?? "状态未记录";
}

export function outcomeStatusTone(status: string): StatusTone {
  if (status === "target_met" || status === "improved") return "success";
  if (status === "worsened") return "danger";
  if (status === "insufficient_evidence") return "warning";
  return "default";
}

export function contextStatusLabel(status: string) {
  return contextStatusLabels[status] ?? "状态未记录";
}

export function contextStatusTone(status: string): StatusTone {
  if (status === "active") return "info";
  if (status === "closed") return "success";
  return "default";
}

export function packCapabilityLabel(capability: string) {
  return capabilityLabels[capability] ?? null;
}

export function isBusinessPackCapability(capability: string) {
  return capability in capabilityLabels;
}
