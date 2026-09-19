import type {
  OutcomeBetterDirection,
  OutcomeComparison,
  OutcomeDefinitionRecord,
  OutcomeEvaluationRecord,
  OutcomeStatus,
} from "../domain/v2/index.js";

export type { OutcomeStatus };

export type OutcomeDefinitionInput = Pick<
  OutcomeDefinitionRecord,
  "id" | "version" | "name" | "exceptionCode" | "baselineMetricKey" | "currentEvidenceField" | "comparison" | "targetValue" | "betterDirection" | "enabled" | "metadata"
>;

export type OutcomeBaseline = {
  metricKey: string;
  value: number | string;
  source: "exception_metrics" | "rule_evaluation_metrics";
};

export type OutcomeCurrent = {
  field: string;
  value: number | string | null;
  evidenceIds: string[];
};

export type OutcomeTruthfulness = {
  evidenceBacked: boolean;
  causalAttribution: false;
};

export type OutcomeEvaluationView = OutcomeEvaluationRecord & {
  baseline: OutcomeBaseline;
  current: OutcomeCurrent;
  status: OutcomeStatus;
  targetValue: number | string;
  comparison: OutcomeComparison;
  betterDirection: OutcomeBetterDirection;
  measuredAt: string;
  truthfulness: OutcomeTruthfulness;
  syntheticEvidence: boolean;
  stale: boolean;
};

export type OutcomeEvaluationInput = {
  definitionId: string;
  evidenceIds: string[];
  resolutionCaseId?: string;
  automationRunId?: string;
};

export class OutcomeError extends Error {
  constructor(public readonly code: string, public readonly status = 422) {
    super(code);
    this.name = "OutcomeError";
  }
}
