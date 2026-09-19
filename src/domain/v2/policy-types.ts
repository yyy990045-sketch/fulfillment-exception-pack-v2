import type { ActionType } from "../../types.js";

export type PolicyMode = "human_only" | "approval_required" | "auto_eligible";
export type PolicyCandidateSource = "human" | "ai_recommendation";

export type PolicyDefinitionRecord = {
  tenantId: string;
  id: string;
  version: string;
  name: string;
  priority: number;
  enabled: boolean;
  conditions: unknown;
  decision: unknown;
  contentHash: string;
  createdAt: string;
};

export type PolicyEvaluationRecord = {
  tenantId: string;
  id: string;
  contextId: string;
  exceptionId: string;
  candidateActionType: ActionType;
  candidateSource: PolicyCandidateSource;
  sourceRecommendationId?: string;
  sourceOptionId?: string;
  policySnapshotHash: string;
  decision: unknown;
  evaluatedBy: string;
  evaluatedAt: string;
};
