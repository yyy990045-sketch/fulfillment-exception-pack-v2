import type { ActionRecord, ActionType, CaseRecord, CaseStatus } from "../../../types.js";
import type { ExceptionEvidenceRole, V2Exception } from "../rule-types.js";

export type ResolutionEvidenceRef = {
  evidenceId: string;
  role: ExceptionEvidenceRole;
};

export type ResolutionCaseOrigin = {
  kind: "v2_exception";
  contextId: string;
  exceptionId: string;
  exceptionCode: V2Exception["code"];
  matchKey: string;
  ruleId: string;
  ruleVersionId: string;
  sourceRuleEvaluationId: string;
  acceptedBy: string;
  acceptedAt: string;
  acceptanceRationale: string;
  evidenceRefs: ResolutionEvidenceRef[];
};

export type ResolutionReview = {
  decision: "confirm" | "needs_evidence" | "reject";
  rationale: string;
  actor: string;
  at: string;
};

export type ResolutionCase = {
  id: string;
  tenantId: string;
  contextId: string;
  exceptionId: string;
  status: CaseStatus;
  ownerRole: string;
  origin: ResolutionCaseOrigin;
  review?: ResolutionReview;
  proposedBy?: string;
  runtime: CaseRecord;
  createdAt: string;
  updatedAt: string;
};

export type ResolutionActionInput = {
  type: ActionType;
  summary: string;
};

export type ResolutionAction = Pick<ActionRecord, "id" | "type" | "summary" | "status" | "requiresApproval" | "idempotencyKey">;

export type ResolutionReceipt = {
  tenantId: string;
  resolutionCaseId: string;
  actionId: string;
  operationKey: string;
  externalRequestId: string;
  receipt: string;
  receiptSource: "local-ledger";
  status: "succeeded" | "failed";
  payloadHash: string;
  createdAt: string;
};
