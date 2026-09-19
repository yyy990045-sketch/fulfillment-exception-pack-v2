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
