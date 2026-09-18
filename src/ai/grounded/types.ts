import type {
  BusinessEntity,
  ExceptionEvidenceBundle,
  RuleEvaluation,
  SourceDocument,
  SourceSystem,
  V2Exception,
} from "../../domain/v2/index.js";
import type { GroundedExplanationRecord, GroundedExplanationStatus } from "../../domain/v2/grounded-types.js";

export type GroundedFactKind = "expected" | "actual" | "metric" | "source_fact";

export type GroundedFact = {
  kind: GroundedFactKind;
  key: string;
  value: string | number;
  statement: string;
  evidenceIds: string[];
};

export type GroundedCitationStatement = {
  statement: string;
  evidenceIds: string[];
};

export type GroundedExplanationOutput = {
  executiveSummary: string;
  facts: GroundedFact[];
  discrepancy: GroundedCitationStatement;
  uncertainties: GroundedCitationStatement[];
  questionsToVerify: string[];
  prohibitedConclusions: string[];
};

export type GroundingValidation = {
  valid: boolean;
  citationErrors: string[];
  numericErrors: string[];
  unsupportedClaims: string[];
  validatedAt: string;
};

export type GroundedExplanationInput = {
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
  sourceChanged?: boolean;
};

export type GroundedPrompt = {
  system: string;
  user: string;
};

export type GroundedAiRequest = {
  input: GroundedExplanationInput;
  prompt: GroundedPrompt;
};

export interface GroundedAiProvider {
  name: string;
  model: string;
  generate(request: GroundedAiRequest): Promise<GroundedExplanationOutput>;
}

export type GroundedExplanation = Omit<GroundedExplanationRecord, "output" | "validation" | "status"> & {
  status: GroundedExplanationStatus;
  output: GroundedExplanationOutput;
  validation: GroundingValidation;
};

export type GroundedExplanationSummary = Pick<
  GroundedExplanation,
  "id" | "tenantId" | "contextId" | "exceptionId" | "ruleEvaluationId" | "inputSnapshotHash" | "provider" | "model" | "status" | "createdBy" | "createdAt"
> & {
  stale: boolean;
};

export type GroundedExplanationView = GroundedExplanation & {
  stale: boolean;
};

export class GroundedAiError extends Error {
  constructor(public readonly code: string, public readonly status = 422) {
    super(code);
    this.name = "GroundedAiError";
  }
}
