import type { OperationalMetricDefinitions, OperationalResolutionStatus, OperationalSeverity } from "./operational-types.js";

export const OPERATIONAL_RESOLUTION_STATUSES: OperationalResolutionStatus[] = [
  "no_case",
  "triaged",
  "confirmed",
  "proposed_draft",
  "pending_approval",
  "approved",
  "executed",
  "closed",
  "rejected",
];

export const OPERATIONAL_SEVERITIES: OperationalSeverity[] = ["low", "medium", "high", "critical"];

export const OPERATIONAL_METRIC_DEFINITIONS: OperationalMetricDefinitions = {
  governanceCoverageRate: "Exceptions with at least one Resolution Case / detected Exceptions",
  resolutionClosureRate: "Closed Resolution Cases / all Resolution Cases; this is not Exception resolution",
  ruleTriggerRate: "Matched evaluations / all evaluations; this is not accuracy, precision, or false-positive rate",
  exceptionOccurrenceAt: "Latest observedAt of the current Exception Evidence Bundle, falling back to Exception createdAt",
  sourceSystemInvolvement: "Number of Exceptions whose Evidence Bundle involves the source system; values can overlap and are not a mutually exclusive share",
};

export const OPERATIONAL_TRUTHFULNESS = {
  derivedFromDomainFacts: true,
  realBusinessOutcomeMeasured: false,
  financialImpactMeasured: false,
  ruleAccuracyMeasured: false,
  aiDecisionQualityMeasured: false,
  realExternalExecutionMeasured: false,
} as const;
