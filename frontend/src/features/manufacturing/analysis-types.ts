import type { components } from "../../api/schema.js";

type GeneratedExplanation = components["schemas"]["GroundedExplanation"];
type GeneratedRootCause = components["schemas"]["RootCauseAnalysis"];
type GeneratedDecision = components["schemas"]["DecisionRecommendation"];

export type CitationStatement = {
  statement: string;
  evidenceIds: string[];
};

export type GroundedExplanationView = Omit<GeneratedExplanation, "output"> & {
  output: {
    executiveSummary: string;
    facts: CitationStatement[];
    discrepancy?: CitationStatement | null;
    uncertainties: CitationStatement[];
    questionsToVerify: string[];
    prohibitedConclusions: string[];
  };
  stale: boolean;
};

export type ExplanationSummaryView = {
  id: string;
  tenantId: string;
  contextId: string;
  exceptionId: string;
  ruleEvaluationId: string;
  inputSnapshotHash: string;
  provider: string;
  model: string;
  status: "generated" | "rejected";
  createdBy: string;
  createdAt: string;
  stale: boolean;
};
export type ExplanationListResponse = Omit<components["schemas"]["GroundedExplanationListResponse"], "explanations"> & {
  explanations: ExplanationSummaryView[];
};
export type ExplanationResponse = Omit<components["schemas"]["GroundedExplanationResponse"], "explanation"> & {
  explanation: GroundedExplanationView;
};

export type RootCauseAnalysisView = GeneratedRootCause;
export type RootCauseAnalysisSummaryView = components["schemas"]["RootCauseAnalysisSummary"];
export type RootCauseAnalysisListResponse = components["schemas"]["RootCauseAnalysisList"];

export type DecisionRecommendationView = GeneratedDecision;
export type DecisionRecommendationSummaryView = components["schemas"]["DecisionRecommendationSummary"];
export type DecisionRecommendationListResponse = components["schemas"]["DecisionRecommendationList"];

export type PolicyEvaluationView = components["schemas"]["PolicyEvaluation"];
export type PolicyEvaluationListResponse = components["schemas"]["PolicyEvaluationList"];
export type OutcomeEvaluationView = components["schemas"]["OutcomeEvaluation"];
export type OutcomeEvaluationListResponse = components["schemas"]["OutcomeEvaluationList"];
export type CurrentActorContextView = components["schemas"]["CurrentActorContext"];
export type CurrentActorContextResponseView = components["schemas"]["CurrentActorContextResponse"];
export type CapabilityDecisionView = components["schemas"]["CapabilityDecision"];
export type ResolutionCapabilitiesView = components["schemas"]["ResolutionCapabilities"];
export type ResolutionCapabilitiesResponseView = components["schemas"]["ResolutionCapabilitiesResponse"];

export type ResolutionActionView = {
  id: string;
  type: string;
  summary: string;
  status: string;
};

export type ResolutionRuntimeEventView = {
  at: string;
  actor: string;
  from?: string;
  to?: string;
  reason?: string;
};

export type ResolutionCaseView = {
  id: string;
  tenantId: string;
  contextId: string;
  exceptionId: string;
  status: string;
  ownerRole: string;
  createdAt: string;
  updatedAt: string;
  proposedBy?: string;
  review?: {
    decision: string;
    rationale: string;
    actor: string;
    at: string;
  };
  origin: {
    acceptedBy: string;
    acceptedAt: string;
    acceptanceRationale: string;
    sourceRuleEvaluationId: string;
    evidenceRefs: Array<{ evidenceId: string; role: string }>;
  };
  runtime: {
    title: string;
    actions: ResolutionActionView[];
    events: ResolutionRuntimeEventView[];
  };
};

export type ResolutionReceiptView = {
  actionId: string;
  status: string;
  externalRequestId: string;
  receiptSource: string;
  payloadHash: string;
  createdAt: string;
};

export type ResolutionCaseQueryView = {
  resolutionCase: ResolutionCaseView;
  sourceException: { id: string; status: string };
  sourceChanged: boolean;
  intakeEvaluationId: string;
  currentEvaluationId: string;
  receipts: ResolutionReceiptView[];
};

export type ResolutionCaseListResponse = {
  contextId: string;
  resolutionCases: Array<{
    id: string;
    exceptionId: string;
    status: string;
    ownerRole: string;
    title: string;
    createdAt: string;
    updatedAt: string;
  }>;
};
