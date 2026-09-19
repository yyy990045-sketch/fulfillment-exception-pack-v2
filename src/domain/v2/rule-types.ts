import type { BusinessEntityType, EvidenceValueType, SourceDocument, SourceSystem, V2Evidence } from "./types.js";

export type RuleStatus = "draft" | "active" | "retired";

export type RuleDefinition = {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string;
  exceptionType: ExceptionCode;
  enabled: boolean;
  createdAt: string;
  metadata: Record<string, unknown>;
};

export type FactAggregation = "single_latest" | "sum_latest_per_entity";

export type FactSelector = {
  key: string;
  entityType: BusinessEntityType;
  field: string;
  valueType: EvidenceValueType;
  aggregation: FactAggregation;
};

export type NumericComparisonOperator = "lt" | "lte" | "gt" | "gte" | "eq" | "neq";

export type MetricDefinition = {
  key: string;
  type: "absolute_difference" | "positive_difference" | "difference_ratio" | "ratio";
};

export type ExceptionEvidenceRole = "expected" | "actual" | "claim" | "context";

export type RulePresentation = {
  title: string;
  summaryTemplate: string;
};

export type NumericRuleConfig = {
  expected: FactSelector;
  actual: FactSelector;
  condition: {
    operator: NumericComparisonOperator;
  };
  metrics: MetricDefinition[];
  evidenceRoles: Record<string, ExceptionEvidenceRole>;
  presentation: RulePresentation;
  severity: "low" | "medium" | "high" | "critical";
};

export type RuleVersion = {
  id: string;
  tenantId: string;
  ruleId: string;
  version: string;
  status: RuleStatus;
  config: NumericRuleConfig;
  contentHash: string;
  createdAt: string;
};

export type FactObservationStatus = "resolved" | "missing" | "ambiguous" | "invalid";

export type FactObservation = {
  selectorKey: string;
  status: FactObservationStatus;
  value: number | null;
  entityIds: string[];
  evidenceIds: string[];
  sourceSystemIds: string[];
  observedAt: string | null;
  candidateEvidenceIds: string[];
};

export type RuleEvaluationStatus = "matched" | "not_matched" | "insufficient_evidence" | "ambiguous_evidence" | "invalid";

export type RuleEvaluation = {
  id: string;
  tenantId: string;
  contextId: string;
  ruleId: string;
  ruleVersionId: string;
  status: RuleEvaluationStatus;
  observations: Record<string, FactObservation>;
  metrics: Record<string, number>;
  inputHash: string;
  matchKey: string;
  evaluatedAt: string;
  metadata: Record<string, unknown>;
};

export type ExceptionCode = string;
export type FulfillmentExceptionCode = ExceptionCode;

export type V2Exception = {
  id: string;
  tenantId: string;
  contextId: string;
  ruleId: string;
  ruleVersionId: string;
  ruleEvaluationId: string;
  latestRuleEvaluationId: string;
  code: ExceptionCode;
  status: "detected";
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  summary: string;
  metrics: Record<string, number>;
  entityIds: string[];
  evidenceIds: string[];
  matchKey: string;
  createdAt: string;
  lastDetectedAt: string;
  metadata: Record<string, unknown>;
};

export type ExceptionEvidenceItem = V2Evidence & {
  evidenceId: string;
  role: ExceptionEvidenceRole;
};

export type ExceptionEvidenceBundle = {
  id: string;
  tenantId: string;
  contextId: string;
  exceptionId: string;
  observations: Record<string, FactObservation>;
  evidenceIds: string[];
  evidence: ExceptionEvidenceItem[];
  sourceDocuments: SourceDocument[];
  sourceSystems: SourceSystem[];
};

export type RuleExecutionResult = {
  evaluation: RuleEvaluation;
  exception?: V2Exception;
  evidenceBundle?: ExceptionEvidenceBundle;
};
