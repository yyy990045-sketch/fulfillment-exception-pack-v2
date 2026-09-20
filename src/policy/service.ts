import { createHash } from "node:crypto";
import type { ActionType } from "../types.js";
import type { V2SqliteStore } from "../domain/v2/index.js";
import type { PolicyCandidateSource, PolicyEvaluationRecord } from "../domain/v2/policy-types.js";
import { getPolicyActionMetadata, isWritableActionType } from "./action-catalog.js";
import { provisionDefaultDecisionPolicies } from "./definitions.js";
import { evaluatePolicyDefinitions } from "./evaluator.js";
import { policySnapshotHash } from "./snapshot.js";
import { PolicyError, type PolicyCandidateInput, type PolicyContextFacts, type PolicyEvaluationDecision, type PolicyEvaluationView } from "./types.js";

function evaluationId(input: { tenantId: string; exceptionId: string; snapshotHash: string; source?: string }) {
  return `pol-${createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 24)}`;
}

function currentFacts(store: V2SqliteStore, tenantId: string, contextId: string, exceptionId: string, actionType: PolicyEvaluationView["candidateActionType"], candidateSource: PolicyCandidateSource) {
  const exception = store.listExceptions(tenantId, contextId).find((item) => item.id === exceptionId);
  if (!exception) throw new PolicyError("POLICY_EXCEPTION_NOT_FOUND", 404);
  const evaluation = store.listRuleEvaluations(tenantId, contextId).find((item) => item.id === exception.latestRuleEvaluationId);
  const bundle = store.getExceptionEvidenceBundle(tenantId, exceptionId);
  if (!evaluation || !bundle) throw new PolicyError("POLICY_CONTEXT_INCOMPLETE", 422);
  const facts: PolicyContextFacts = {
    exceptionCode: exception.code,
    severity: exception.severity,
    actionType,
    evidenceCount: bundle.evidence.length,
    sourceSystemCount: bundle.sourceSystems.length,
    hasClaimEvidence: bundle.evidence.some((item) => item.role === "claim"),
    allEvidenceSupported: bundle.evidence.every((item) => item.support === "supported"),
    candidateSource,
  };
  return { exception, evaluation, bundle, facts };
}

function policyActionMetadata(actionType: ActionType) {
  if (!isWritableActionType(actionType)) throw new PolicyError("POLICY_ACTION_INVALID", 422);
  const metadata = getPolicyActionMetadata(actionType);
  if (!metadata) throw new PolicyError("POLICY_ACTION_INVALID", 422);
  return metadata;
}

function recommendationCandidate(
  store: V2SqliteStore,
  tenantId: string,
  contextId: string,
  exceptionId: string,
  recommendationId: string,
  optionId: string,
) {
  const record = store.getDecisionRecommendation(tenantId, recommendationId);
  if (!record || record.contextId !== contextId || record.exceptionId !== exceptionId) throw new PolicyError("POLICY_RECOMMENDATION_NOT_FOUND", 404);
  if (record.status !== "generated") throw new PolicyError("POLICY_RECOMMENDATION_NOT_GENERATED", 422);
  const output = record.output as { options?: Array<{ id: string; actionType: string }> } | undefined;
  const option = output?.options?.find((item) => item.id === optionId);
  if (!option) throw new PolicyError("POLICY_RECOMMENDATION_OPTION_NOT_FOUND", 422);
  return { record, option };
}

function toView(store: V2SqliteStore, record: PolicyEvaluationRecord): PolicyEvaluationView {
  const decision = record.decision as PolicyEvaluationDecision;
  let stale = true;
  try {
    const current = currentFacts(store, record.tenantId, record.contextId, record.exceptionId, record.candidateActionType, record.candidateSource);
    const currentDefinitions = store.listPolicyDefinitions(record.tenantId, true);
    const currentMetadata = policyActionMetadata(record.candidateActionType);
    const currentHash = policySnapshotHash({
      exceptionId: current.exception.id,
      latestRuleEvaluationId: current.exception.latestRuleEvaluationId,
      actionMetadata: currentMetadata,
      facts: current.facts,
      policyDefinitions: currentDefinitions,
    });
    stale = record.policySnapshotHash !== currentHash;
  } catch { /* keep stale when policy context cannot be rebuilt */ }
  return { ...record, decision, stale };
}

export function evaluateDecisionPolicy(
  store: V2SqliteStore,
  tenantId: string,
  contextId: string,
  exceptionId: string,
  candidate: PolicyCandidateInput,
  actor: string,
): PolicyEvaluationView {
  if (!actor.trim()) throw new PolicyError("actor_required", 401);
  provisionDefaultDecisionPolicies(store, tenantId);
  const sourceRecommendation = "recommendationId" in candidate && candidate.recommendationId
    ? recommendationCandidate(store, tenantId, contextId, exceptionId, candidate.recommendationId, candidate.optionId)
    : undefined;
  const actionType: ActionType = sourceRecommendation
    ? sourceRecommendation.option.actionType as ActionType
    : candidate.actionType!;
  const candidateSource: PolicyCandidateSource = sourceRecommendation ? "ai_recommendation" : "human";
  const current = currentFacts(store, tenantId, contextId, exceptionId, actionType, candidateSource);
  if (sourceRecommendation) {
    if (current.exception.latestRuleEvaluationId !== sourceRecommendation.record.ruleEvaluationId) {
      throw new PolicyError("POLICY_RECOMMENDATION_STALE", 422);
    }
    if (sourceRecommendation.option.actionType !== actionType) throw new PolicyError("POLICY_ACTION_MISMATCH", 422);
  }
  const actionMetadata = policyActionMetadata(actionType);
  const definitions = store.listPolicyDefinitions(tenantId, true);
  const snapshotHash = policySnapshotHash({
    exceptionId: current.exception.id,
    latestRuleEvaluationId: current.exception.latestRuleEvaluationId,
    actionMetadata,
    facts: current.facts,
    policyDefinitions: definitions,
  });
  const existing = store.getPolicyEvaluationBySnapshot(
    tenantId,
    exceptionId,
    actionType,
    candidateSource,
    snapshotHash,
    sourceRecommendation?.record.id,
    sourceRecommendation?.option.id,
  );
  if (existing) return toView(store, existing);
  const decision = evaluatePolicyDefinitions(definitions, current.facts, actionMetadata, snapshotHash);
  const record: PolicyEvaluationRecord = {
    tenantId,
    id: evaluationId({
      tenantId,
      exceptionId,
      snapshotHash,
      source: sourceRecommendation ? `${sourceRecommendation.record.id}:${sourceRecommendation.option.id}` : "human",
    }),
    contextId,
    exceptionId,
    candidateActionType: actionType,
    candidateSource,
    ...(sourceRecommendation ? {
      sourceRecommendationId: sourceRecommendation.record.id,
      sourceOptionId: sourceRecommendation.option.id,
    } : {}),
    policySnapshotHash: snapshotHash,
    decision,
    evaluatedBy: actor,
    evaluatedAt: new Date().toISOString(),
  };
  return toView(store, store.savePolicyEvaluation(record));
}

export function listPolicyEvaluations(store: V2SqliteStore, tenantId: string, contextId: string, exceptionId: string) {
  return store.listPolicyEvaluations(tenantId, contextId, exceptionId).map((record) => toView(store, record));
}

export function getPolicyEvaluation(
  store: V2SqliteStore,
  tenantId: string,
  contextId: string,
  exceptionId: string,
  evaluationId: string,
): PolicyEvaluationView | undefined {
  const record = store.getPolicyEvaluation(tenantId, evaluationId);
  if (!record || record.contextId !== contextId || record.exceptionId !== exceptionId) return undefined;
  return toView(store, record);
}
