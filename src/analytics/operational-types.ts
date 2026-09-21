export type OperationalBucket = "day" | "week" | "month";
export type OperationalTimeBasis = "context_opened" | "exception_occurrence";
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
  timeBasis?: OperationalTimeBasis;
  bucket?: OperationalBucket;
  contextType?: string;
  exceptionCode?: string;
  severity?: OperationalSeverity;
  resolutionStatus?: OperationalResolutionStatus;
  /** 工业空间维度（UNS）：Site / Line */
  site?: string;
  line?: string;
  /** 来源系统维度：ERP / MES / QMS / WMS / Finance … */
  sourceSystem?: string;
};

/** 本轮为工业仿真新增的可选分析维度（不重构既有投影，只做最小字段扩展）。 */
export const OPERATIONAL_INDUSTRIAL_DIMENSIONS = ["site", "line", "sourceSystem"] as const;
export type OperationalIndustrialDimension = (typeof OPERATIONAL_INDUSTRIAL_DIMENSIONS)[number];

export type OperationalMetricDefinitions = {
  governanceCoverageRate: string;
  resolutionClosureRate: string;
  ruleTriggerRate: string;
  exceptionOccurrenceAt: string;
  sourceSystemInvolvement: string;
  outcomeMeasurementCoverage: string;
  observedTargetMetRate: string;
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
  /** 工业空间归属（来自 Context 的 UNS 绑定；没有绑定时为 null） */
  siteId: string | null;
  lineId: string | null;
};

/** Context 的工业归属投影：供现有 Context 页面/看板直接消费，不需要理解 ISA-95。 */
export type OperationalIndustrialContext = {
  enterpriseId: string;
  siteId: string;
  areaId: string;
  lineId: string;
};

export type OperationalIndustrialBreakdownRow = {
  dimension: OperationalIndustrialDimension;
  value: string;
  exceptionCount: number;
  contextCount: number;
};
