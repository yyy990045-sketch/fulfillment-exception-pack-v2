import type {
  BusinessEntity,
  ExceptionEvidenceBundle,
  RuleEvaluation,
  SourceDocument,
  SourceSystem,
  V2Exception,
} from "../../domain/v2/index.js";
import type {
  RootCauseAnalysisRecord,
  RootCauseAnalysisStatus,
  RootCauseHypothesisReview,
} from "../../domain/v2/root-cause-types.js";

export type RootCauseHypothesis = {
  id: string;
  statement: string;
  epistemicStatus: "hypothesis";
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
  missingEvidence: string[];
  verificationSteps: string[];
};

export type RootCauseOutput = {
  summary: string;
  hypotheses: RootCauseHypothesis[];
  uncertainties: string[];
  humanVerificationRequired: true;
  prohibitedConclusions: string[];
};

export type RootCauseValidation = {
  valid: boolean;
  citationErrors: string[];
  numericErrors: string[];
  unsupportedClaims: string[];
  schemaErrors: string[];
  validatedAt: string;
};

export type RootCauseInput = {
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
    latestRuleEvaluationId: string;
    matchKey: string;
  };
  rule: {
    id: string;
    code: string;
    version: string;
  };
  evaluation: {
    id: RuleEvaluation["id"];
    status: RuleEvaluation["status"];
    observations: RuleEvaluation["observations"];
    metrics: RuleEvaluation["metrics"];
  };
  evidence: ExceptionEvidenceBundle["evidence"];
  sourceDocuments: SourceDocument[];
  sourceSystems: SourceSystem[];
  contextFacts: BusinessEntity[];
};

export type RootCausePrompt = {
  system: string;
  user: string;
};

export type RootCauseRequest = {
  input: RootCauseInput;
  prompt: RootCausePrompt;
};

export interface RootCauseProvider {
  name: string;
  model: string;
  generate(request: RootCauseRequest): Promise<RootCauseOutput>;
}

export type RootCauseAnalysis = Omit<RootCauseAnalysisRecord, "output" | "validation"> & {
  output: RootCauseOutput;
  validation: RootCauseValidation;
};

export type RootCauseAnalysisSummary = Pick<
  RootCauseAnalysis,
  "id" | "tenantId" | "contextId" | "exceptionId" | "ruleEvaluationId" | "inputSnapshotHash" | "provider" | "model" | "status" | "createdBy" | "createdAt"
> & {
  stale: boolean;
};

export type RootCauseAnalysisView = RootCauseAnalysis & {
  stale: boolean;
};

export type RootCauseHypothesisReviewView = RootCauseHypothesisReview;

export class RootCauseAiError extends Error {
  constructor(public readonly code: string, public readonly status = 422) {
    super(code);
    this.name = "RootCauseAiError";
  }
}
