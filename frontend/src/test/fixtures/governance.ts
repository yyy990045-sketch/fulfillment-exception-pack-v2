import type {
  OutcomeEvaluationListResponse,
  PolicyEvaluationListResponse,
  ResolutionCaseQueryView,
  ResolutionReceiptView,
} from "../../features/manufacturing/analysis-types.js";

const createdAt = "2026-09-19T00:00:00.000Z";

export function policyListFixture(mode: "human_only" | "approval_required" | "auto_eligible" = "approval_required"): PolicyEvaluationListResponse {
  return {
    contextId: "ctx-fixture",
    exceptionId: "exception-claim",
    evaluations: [{
      tenantId: "demo-manufacturing",
      id: "policy-fixture",
      contextId: "ctx-fixture",
      exceptionId: "exception-claim",
      candidateActionType: "supplement_evidence",
      candidateSource: "ai_recommendation",
      sourceRecommendationId: "decision-fixture",
      sourceOptionId: "option-evidence",
      policySnapshotHash: "d".repeat(64),
      decision: {
        mode,
        matchedPolicyIds: ["manufacturing-governance"],
        reasons: ["客户-facing 沟通与证据补充需要人工确认。"],
        requiredRoles: ["总经理"],
        actionMetadata: {
          actionType: "supplement_evidence",
          effectClass: "internal_evidence_request",
          customerFacing: false,
          financialMovement: false,
          legalEffect: false,
          reversible: true,
        },
        facts: {
          exceptionCode: "CUSTOMER_RECEIPT_CLAIM_MISMATCH",
          severity: "high",
          actionType: "supplement_evidence",
          evidenceCount: 2,
          sourceSystemCount: 2,
          hasClaimEvidence: true,
          allEvidenceSupported: true,
          candidateSource: "ai_recommendation",
        },
        policySnapshotHash: "d".repeat(64),
        automationAvailable: false,
        executionPerformed: false,
      },
      evaluatedBy: "品质负责人",
      evaluatedAt: createdAt,
      stale: false,
    }],
  };
}

export function resolutionReceiptFixture(): ResolutionReceiptView {
  return {
    actionId: "action-fixture",
    status: "succeeded",
    externalRequestId: "receipt-fixture",
    receiptSource: "local-ledger",
    payloadHash: "e".repeat(64),
    createdAt,
  };
}

export function resolutionQueryFixture(
  status: "triaged" | "confirmed" | "proposed" | "approved" | "executed" | "closed" | "rejected",
  options: { submitted?: boolean; receipts?: ResolutionReceiptView[] } = {},
): ResolutionCaseQueryView {
  const actionStatus = status === "proposed" && options.submitted ? "pending_approval" : status === "confirmed" ? "draft" : status === "approved" || status === "executed" || status === "closed" ? "authorized" : "draft";
  return {
    resolutionCase: {
      id: "resolution-fixture",
      tenantId: "demo-manufacturing",
      contextId: "ctx-fixture",
      exceptionId: "exception-claim",
      status,
      ownerRole: "品质负责人",
      createdAt,
      updatedAt: createdAt,
      ...(status === "proposed" || status === "approved" || status === "executed" || status === "closed" ? { proposedBy: "工程师" } : {}),
      ...(status !== "triaged" ? {
        review: {
          decision: "confirm",
          rationale: "确认进入治理流程。",
          actor: "品质负责人",
          at: createdAt,
        },
      } : {}),
      origin: {
        acceptedBy: "品质负责人",
        acceptedAt: createdAt,
        acceptanceRationale: "进入人工核验。",
        sourceRuleEvaluationId: "evaluation-fixture",
        evidenceRefs: [{ evidenceId: "evidence-claim", role: "claim" }],
      },
      runtime: {
        title: "客户签收主张差异治理",
        actions: [{
          id: "action-fixture",
          type: "supplement_evidence",
          summary: "收集客户签收单与物流签收记录。",
          status: actionStatus,
        }],
        events: [{ at: createdAt, actor: "品质负责人", from: "new", to: status, reason: "governance" }],
      },
    },
    sourceException: { id: "exception-claim", status: "detected" },
    sourceChanged: false,
    intakeEvaluationId: "evaluation-fixture",
    currentEvaluationId: "evaluation-fixture",
    receipts: options.receipts ?? [],
  };
}

export const outcomeListFixture: OutcomeEvaluationListResponse = {
  contextId: "ctx-fixture",
  exceptionId: "exception-claim",
  evaluations: [{
    tenantId: "demo-manufacturing",
    id: "outcome-fixture",
    contextId: "ctx-fixture",
    exceptionId: "exception-claim",
    definitionId: "customer-claim-outcome",
    definitionVersion: "v1",
    ruleEvaluationId: "evaluation-fixture",
    resolutionCaseId: "resolution-fixture",
    evidenceIds: ["evidence-post-action"],
    baseline: { metricKey: "difference", value: 2, source: "exception_metrics" },
    current: { field: "verifiedReceiptDifference", value: 0, evidenceIds: ["evidence-post-action"] },
    status: "target_met",
    definitionSnapshotHash: "f".repeat(64),
    evaluatedBy: "tester",
    evaluatedAt: createdAt,
    targetValue: 0,
    comparison: "eq",
    betterDirection: "toward_target",
    measuredAt: createdAt,
    truthfulness: { evidenceBacked: true, causalAttribution: false },
    syntheticEvidence: true,
    stale: false,
  }],
};
