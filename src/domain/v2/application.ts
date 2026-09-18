import { evaluateActiveRules } from "./rule-engine.js";
import type { V2SqliteStore } from "./sqlite-store.js";
import { acceptExceptionCase, proposeResolution, reviewResolutionCase, submitResolution } from "./resolution/runtime.js";
import type { ResolutionActionInput, ResolutionReview } from "./resolution/types.js";

export function evaluateContextRules(store: V2SqliteStore, tenantId: string, contextId: string) {
  const context = store.getContext(tenantId, contextId);
  if (!context) return undefined;
  const definitions = store.listEnabledRuleDefinitions(tenantId);
  const versions = store.listActiveRuleVersions(tenantId);
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
  input: { ownerRole: string; rationale: string; actor: string },
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
  input: { decision: ResolutionReview["decision"]; rationale: string; actor: string },
) {
  const current = store.getResolutionCase(tenantId, caseId);
  if (!current) return undefined;
  return store.saveResolutionCase(reviewResolutionCase(current, input));
}

export function proposeResolutionCase(
  store: V2SqliteStore,
  tenantId: string,
  caseId: string,
  input: { actions: ResolutionActionInput[]; actor: string },
) {
  const current = store.getResolutionCase(tenantId, caseId);
  if (!current) return undefined;
  if (current.status === "proposed") return current;
  return store.saveResolutionCase(proposeResolution(current, input));
}

export function submitResolutionCase(store: V2SqliteStore, tenantId: string, caseId: string, actor: string) {
  const current = store.getResolutionCase(tenantId, caseId);
  if (!current) return undefined;
  return store.saveResolutionCase(submitResolution(current, actor));
}
