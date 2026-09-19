import type { ActionType } from "../../types.js";

export type AutomationRunStatus = "succeeded" | "failed" | "blocked";
export type AutomationTriggerSource = "human_request" | "system";
export type AutomationReceiptStatus = "succeeded" | "failed";
export type AutomationReceiptSource = "internal-work-item";
export type InternalWorkItemKind = "task" | "evidence_request";
export type InternalWorkItemSource = "policy_automation";
export type InternalWorkItemStatus = "open" | "completed" | "cancelled";

export type AutomationRunRecord = {
  tenantId: string;
  id: string;
  contextId: string;
  exceptionId: string;
  policyEvaluationId: string;
  candidateActionType: ActionType;
  sourceRecommendationId?: string;
  sourceOptionId?: string;
  executor: string;
  executorVersion: string;
  operationKey: string;
  status: AutomationRunStatus;
  effectId?: string;
  receiptId?: string;
  triggerSource: AutomationTriggerSource;
  triggeredBy: string;
  createdAt: string;
  completedAt: string;
};

export type AutomationReceiptRecord = {
  tenantId: string;
  id: string;
  automationRunId: string;
  effectId: string;
  receiptSource: AutomationReceiptSource;
  status: AutomationReceiptStatus;
  payloadHash: string;
  createdAt: string;
};

export type InternalWorkItemRecord = {
  tenantId: string;
  id: string;
  contextId: string;
  exceptionId: string;
  kind: InternalWorkItemKind;
  source: InternalWorkItemSource;
  actionType: ActionType;
  title: string;
  description: string;
  status: InternalWorkItemStatus;
  createdBy: string;
  createdAt: string;
  metadata: Record<string, unknown>;
};
