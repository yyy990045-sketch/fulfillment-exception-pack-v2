import type { ActionType } from "../types.js";
import type { PolicyCandidateSource, PolicyDefinitionRecord, PolicyEvaluationRecord, PolicyMode } from "../domain/v2/policy-types.js";
import type { FulfillmentExceptionCode, V2Exception } from "../domain/v2/index.js";

export type PolicyEffectClass =
  | "internal_task"
  | "internal_evidence_request"
  | "external_communication"
  | "internal_review"
  | "customer_decision";

export type PolicyActionMetadata = {
  actionType: ActionType;
  effectClass: PolicyEffectClass;
  customerFacing: boolean;
  financialMovement: boolean;
  legalEffect: boolean;
  reversible: boolean;
};

export type PolicyCondition =
  | { op: "actionTypeIn"; values: ActionType[] }
  | { op: "exceptionCodeIn"; values: FulfillmentExceptionCode[] }
  | { op: "severityIn"; values: V2Exception["severity"][] }
  | { op: "candidateSourceIn"; values: PolicyCandidateSource[] }
  | { op: "hasClaimEvidence"; value: boolean }
  | { op: "customerFacing"; value: boolean }
  | { op: "financialMovement"; value: boolean }
  | { op: "legalEffect"; value: boolean };

export type PolicyDecisionDefinition = {
  mode: PolicyMode;
  reason: string;
};

export type PolicyContextFacts = {
  exceptionCode: FulfillmentExceptionCode;
  severity: V2Exception["severity"];
  actionType: ActionType;
  evidenceCount: number;
  sourceSystemCount: number;
  hasClaimEvidence: boolean;
  allEvidenceSupported: boolean;
  candidateSource: PolicyCandidateSource;
};

export type PolicyEvaluationDecision = {
  mode: PolicyMode;
  matchedPolicyIds: string[];
  reasons: string[];
  requiredRoles: string[];
  actionMetadata: PolicyActionMetadata;
  facts: PolicyContextFacts;
  policySnapshotHash: string;
  automationAvailable: false;
  executionPerformed: false;
};

export type PolicyCandidateInput =
  | { actionType: ActionType; recommendationId?: never; optionId?: never }
  | { recommendationId: string; optionId: string; actionType?: never };

export type PolicyEvaluationView = PolicyEvaluationRecord & {
  decision: PolicyEvaluationDecision;
  stale: boolean;
};

export type PolicyDefinitionInput = Pick<PolicyDefinitionRecord, "id" | "version" | "name" | "priority" | "enabled" | "conditions" | "decision">;

export class PolicyError extends Error {
  constructor(public readonly code: string, public readonly status = 422) {
    super(code);
    this.name = "PolicyError";
  }
}
