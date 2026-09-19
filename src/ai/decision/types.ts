import type { ActionType } from "../../types.js";
import type {
  DecisionRecommendationDisposition,
  DecisionRecommendationRecord,
} from "../../domain/v2/decision-types.js";
import type {
  BusinessEntity,
  ExceptionEvidenceBundle,
  RuleEvaluation,
  SourceDocument,
  SourceSystem,
  V2Exception,
} from "../../domain/v2/index.js";

export type DecisionHistorySummary = {
  sameExceptionCount: number;
  sameExceptionWithResolutionCount: number;
  actionTypeCounts: Record<ActionType, number>;
  resolutionStatusCounts: Record<string, number>;
  closedResolutionCaseCount: number;
  rejectedResolutionCaseCount: number;
  outcomeMeasured: false;
};

export type DecisionActionEligibility = {
  actionType: ActionType;
  eligible: boolean;
  reason: string;
};

export type DecisionContextFact = {
  role: "context";
  entityId: string;
  entityType: BusinessEntity["entityType"];
  businessKey: string;
  attributes: BusinessEntity["attributes"];
};

export type DecisionRecommendationInput = {
  tenantId: string;
  contextId: string;
  exceptionId: string;
  exception: {
    id: string;
    code: V2Exception["code"];
    severity: V2Exception["severity"];
    title: string;
    summary: string;
    metrics: V2Exception["metrics"];
    matchKey: string;
    latestRuleEvaluationId: string;
  };
  rule: { id: string; code: string; version: string };
  evaluation: Pick<RuleEvaluation, "id" | "status" | "observations" | "metrics">;
  evidence: ExceptionEvidenceBundle["evidence"];
  sourceDocuments: SourceDocument[];
  sourceSystems: SourceSystem[];
  contextFacts: DecisionContextFact[];
  history: DecisionHistorySummary;
  eligibleActions: DecisionActionEligibility[];
};

export type DecisionSupportingFact = {
  kind: "expected" | "actual" | "metric" | "source_fact";
  key: string;
  value: string | number;
  evidenceIds: string[];
};

export type DecisionHistoryClaim = {
  key: string;
  value: string | number;
  statement: string;
};

export type DecisionOption = {
  id: string;
  actionType: ActionType;
  title: string;
  actionSummary: string;
  rationale: string;
  evidenceIds: string[];
  supportingFacts: DecisionSupportingFact[];
  historyClaims: DecisionHistoryClaim[];
  assumptions: string[];
  missingEvidence: string[];
};

export type DecisionRecommendationOutput = {
  executiveSummary: string;
  recommendedOptionId: string;
  options: DecisionOption[];
  uncertainties: string[];
  humanDecisionRequired: true;
  prohibitedConclusions: string[];
};

export type DecisionRecommendationValidation = {
  valid: boolean;
  citationErrors: string[];
  numericErrors: string[];
  historyErrors: string[];
  eligibilityErrors: string[];
  unsupportedClaims: string[];
  schemaErrors: string[];
  validatedAt: string;
};

export type DecisionRecommendationView = Omit<DecisionRecommendationRecord, "output" | "validation" | "historySnapshot" | "eligibility"> & {
  output: DecisionRecommendationOutput;
  validation: DecisionRecommendationValidation;
  historySnapshot: DecisionHistorySummary;
  eligibility: DecisionActionEligibility[];
  stale: boolean;
};

export type DecisionRecommendationSummary = Pick<
  DecisionRecommendationView,
  "id" | "tenantId" | "contextId" | "exceptionId" | "ruleEvaluationId" | "inputSnapshotHash" | "provider" | "model" | "status" | "createdBy" | "createdAt" | "stale"
>;

export type DecisionRecommendationProvider = {
  name: string;
  model: string;
  generate(request: { input: DecisionRecommendationInput; prompt: { system: string; user: string } }): Promise<unknown>;
};

export type DecisionDispositionView = DecisionRecommendationDisposition;

export class DecisionAiError extends Error {
  constructor(public readonly code: string, public readonly status = 422) {
    super(code);
    this.name = "DecisionAiError";
  }
}
