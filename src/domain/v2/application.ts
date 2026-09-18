import { evaluateActiveRules } from "./rule-engine.js";
import type { V2SqliteStore } from "./sqlite-store.js";

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
