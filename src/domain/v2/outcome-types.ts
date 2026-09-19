import type { FulfillmentExceptionCode } from "./rule-types.js";

export type OutcomeComparison = "eq" | "lte" | "gte";
export type OutcomeBetterDirection = "lower" | "higher" | "toward_target";
export type OutcomeStatus =
  | "target_met"
  | "improved"
  | "unchanged"
  | "worsened"
  | "insufficient_evidence";

export type OutcomeDefinitionRecord = {
  tenantId: string;
  id: string;
  version: string;
  name: string;
  exceptionCode: FulfillmentExceptionCode;
  baselineMetricKey: string;
  currentEvidenceField: string;
  comparison: OutcomeComparison;
  targetValue: string | number;
  betterDirection: OutcomeBetterDirection;
  enabled: boolean;
  contentHash: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type OutcomeEvaluationRecord = {
  tenantId: string;
  id: string;
  contextId: string;
  exceptionId: string;
  definitionId: string;
  definitionVersion: string;
  ruleEvaluationId: string;
  resolutionCaseId?: string;
  automationRunId?: string;
  evidenceIds: string[];
  baseline: unknown;
  current: unknown;
  status: OutcomeStatus;
  definitionSnapshotHash: string;
  evaluatedBy: string;
  evaluatedAt: string;
};
