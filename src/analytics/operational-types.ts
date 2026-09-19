export type OperationalBucket = "day" | "week" | "month";
export type OperationalSeverity = "low" | "medium" | "high" | "critical";
export type OperationalResolutionStatus =
  | "no_case"
  | "triaged"
  | "confirmed"
  | "proposed_draft"
  | "pending_approval"
  | "approved"
  | "executed"
  | "closed"
  | "rejected";

export type OperationalAnalyticsFilters = {
  from?: string;
  to?: string;
  bucket?: OperationalBucket;
  contextType?: string;
  exceptionCode?: string;
  severity?: OperationalSeverity;
  resolutionStatus?: OperationalResolutionStatus;
};

export type OperationalMetricDefinitions = {
  governanceCoverageRate: string;
  resolutionClosureRate: string;
  ruleTriggerRate: string;
  exceptionOccurrenceAt: string;
  sourceSystemInvolvement: string;
};

export class OperationalAnalyticsError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "OperationalAnalyticsError";
  }
}

export type OperationalExceptionRow = {
  contextId: string;
  contextBusinessKey: string;
  exceptionId: string;
  code: string;
  label: string;
  severity: OperationalSeverity;
  occurrenceAt: string;
  resolutionStatus: OperationalResolutionStatus;
  sourceSystemIds: string[];
};
