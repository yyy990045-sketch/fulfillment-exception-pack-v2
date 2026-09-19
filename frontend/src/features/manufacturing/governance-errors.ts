import { ApiError } from "../../api/client.js";

const messages: Record<string, string> = {
  SEGREGATION_OF_DUTIES_VIOLATION: "复核/方案提出人与审批人必须分离，请切换独立审批人。",
  scope_forbidden: "当前身份没有执行该治理操作的权限。",
  resolution_review_not_allowed: "当前状态不能再次复核。",
  resolution_proposal_not_allowed: "当前状态不能拟定处置方案。",
  resolution_submit_not_allowed: "当前方案不能提交审批。",
  resolution_approval_not_submitted: "方案尚未提交审批。",
  resolution_approval_not_allowed: "当前状态不能审批该方案。",
  resolution_execution_not_allowed: "方案尚未批准或已执行，不能执行。",
  resolution_close_not_allowed: "尚未完成执行，不能结案。",
  receipt_required: "执行回执不完整，不能结案。",
  RESOLUTION_EXECUTION_IDEMPOTENCY_CONFLICT: "本次执行请求与已记录执行不一致。",
};

export function governanceErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 403 && error.code === "scope_forbidden") return messages.scope_forbidden;
    return messages[error.code] ?? `治理操作失败：${error.code}`;
  }
  if (error instanceof Error) return error.message;
  return "治理操作失败。";
}
