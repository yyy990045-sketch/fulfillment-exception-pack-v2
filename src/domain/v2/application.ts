import { evaluateActiveRules } from "./rule-engine.js";
import type { V2SqliteStore } from "./sqlite-store.js";
import {
  acceptExceptionCase,
  approveResolution,
  closeResolution,
  executeResolution,
  proposeResolution,
  reviewResolutionCase,
  submitResolution,
} from "./resolution/runtime.js";
import type { ResolutionActionInput, ResolutionReview } from "./resolution/types.js";
import { registerBuiltInSolutionPacks, resolveInstalledPackForContext, solutionPackRegistry } from "../../solution-packs/index.js";

export function evaluateContextRules(store: V2SqliteStore, tenantId: string, contextId: string) {
  const context = store.getContext(tenantId, contextId);
  if (!context) return undefined;
  registerBuiltInSolutionPacks();
  const pack = resolveInstalledPackForContext(store, context);
  const registeredPack = solutionPackRegistry.resolveByContextType(context.contextType);
  const ruleProfile = typeof context.metadata.ruleProfile === "string"
    ? context.metadata.ruleProfile
    : pack?.manifest.id === "manufacturing-fulfillment"
      ? "manufacturing"
      : pack?.manifest.id;
  const allowedRuleIds = pack
    ? new Set(pack.ruleContributions.definitions
      .filter((item) => !ruleProfile || item.metadata.profile === ruleProfile)
      .map((item) => item.id))
    : undefined;
  const definitions = !pack
    ? []
    : store.listEnabledRuleDefinitions(tenantId).filter((item) => !allowedRuleIds || allowedRuleIds.has(item.id));
  const versions = !pack
    ? []
    : store.listActiveRuleVersions(tenantId).filter((item) => !allowedRuleIds || allowedRuleIds.has(item.ruleId));
  const replay = store.replayContext(tenantId, contextId);
  const results = evaluateActiveRules(replay, definitions, versions);
  for (const result of results) store.recordRuleExecution(result);
  return {
    contextId,
    evaluations: store.listRuleEvaluations(tenantId, contextId),
    exceptions: store.listExceptions(tenantId, contextId),
    results,
  };
}

export function acceptExceptionForResolution(
  store: V2SqliteStore,
  tenantId: string,
  contextId: string,
  exceptionId: string,
  input: { ownerRole: string; rationale: string; actor: string; actorId?: string },
) {
  const existing = store.getResolutionCaseByException(tenantId, exceptionId);
  if (existing) return existing;
  const exception = store.listExceptions(tenantId, contextId).find((item) => item.id === exceptionId);
  if (!exception || exception.status !== "detected") throw new Error("resolution_exception_not_detected");
  const bundle = store.getExceptionEvidenceBundle(tenantId, exceptionId);
  if (!bundle) throw new Error("resolution_exception_bundle_required");
  return store.saveResolutionCase(acceptExceptionCase({ exception, bundle, ...input }));
}

export function reviewResolution(
  store: V2SqliteStore,
  tenantId: string,
  caseId: string,
  input: { decision: ResolutionReview["decision"]; rationale: string; actor: string; actorId?: string },
) {
  const current = store.getResolutionCase(tenantId, caseId);
  if (!current) return undefined;
  return store.saveResolutionCase(reviewResolutionCase(current, input));
}

export function proposeResolutionCase(
  store: V2SqliteStore,
  tenantId: string,
  caseId: string,
  input: { actions: ResolutionActionInput[]; actor: string; actorId?: string },
) {
  const current = store.getResolutionCase(tenantId, caseId);
  if (!current) return undefined;
  if (current.status === "proposed") return current;
  return store.saveResolutionCase(proposeResolution(current, input));
}

export function submitResolutionCase(store: V2SqliteStore, tenantId: string, caseId: string, actor: string, actorId?: string) {
  const current = store.getResolutionCase(tenantId, caseId);
  if (!current) return undefined;
  return store.saveResolutionCase(submitResolution(current, actor, undefined, actorId));
}

export function approveResolutionCase(store: V2SqliteStore, tenantId: string, caseId: string, actor: string, actorRoles: string[], actorId?: string) {
  const current = store.getResolutionCase(tenantId, caseId);
  if (!current) return undefined;
  return store.saveResolutionCase(approveResolution(current, actor, actorRoles, undefined, actorId));
}

export function executeResolutionCase(
  store: V2SqliteStore,
  tenantId: string,
  caseId: string,
  actor: string,
  actorRoles: string[],
  idempotencyKey?: string,
  actorId?: string,
) {
  const current = store.getResolutionCase(tenantId, caseId);
  if (!current) return undefined;
  const operationKey = idempotencyKey || `${tenantId}:${caseId}:execute`;
  return store.saveResolutionCase(executeResolution(current, actor, actorRoles, operationKey, (action, operation, payloadHash) => {
    const receipt = store.recordResolutionReceipt({
      tenantId,
      resolutionCaseId: caseId,
      actionId: action.id,
      operationKey: operation,
      payloadHash,
    });
    return {
      receipt: receipt.receipt,
      externalRequestId: receipt.externalRequestId,
      receiptSource: receipt.receiptSource,
      receiptAt: receipt.createdAt,
    };
  }, undefined, actorId));
}

export function closeResolutionCase(store: V2SqliteStore, tenantId: string, caseId: string, actor: string, actorRoles: string[], actorId?: string) {
  const current = store.getResolutionCase(tenantId, caseId);
  if (!current) return undefined;
  return store.saveResolutionCase(closeResolution(current, actor, actorRoles, undefined, actorId));
}

export function queryResolutionCase(store: V2SqliteStore, tenantId: string, caseId: string) {
  const resolutionCase = store.getResolutionCase(tenantId, caseId);
  if (!resolutionCase) return undefined;
  const sourceException = store.listExceptions(tenantId, resolutionCase.contextId)
    .find((item) => item.id === resolutionCase.exceptionId);
  if (!sourceException) return undefined;
  return {
    resolutionCase,
    sourceException,
    sourceChanged: sourceException.latestRuleEvaluationId !== resolutionCase.origin.sourceRuleEvaluationId,
    intakeEvaluationId: resolutionCase.origin.sourceRuleEvaluationId,
    currentEvaluationId: sourceException.latestRuleEvaluationId,
    evidenceBundle: store.getExceptionEvidenceBundle(tenantId, sourceException.id),
    receipts: store.listResolutionReceipts(tenantId, caseId),
  };
}
