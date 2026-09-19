import type { FulfillmentContext, V2SqliteStore } from "../../domain/v2/index.js";
import { getPolicyActionMetadata } from "../../policy/action-catalog.js";
import { solutionPackRegistry } from "./registry.js";
import type { SolutionPack } from "./types.js";

export function listBoundContextsForPack(
  store: V2SqliteStore,
  tenantId: string,
  packId: string,
): FulfillmentContext[] {
  const pack = solutionPackRegistry.get(packId);
  if (!pack) return [];
  const contributedRuleIds = new Set(pack.ruleContributions.definitions.map((definition) => definition.id));
  return store.listContexts(tenantId).filter((context) => store.listRuleEvaluations(tenantId, context.id)
    .some((evaluation) => contributedRuleIds.has(evaluation.ruleId)));
}

function contextPath(packId: string, context: FulfillmentContext) {
  const pack = solutionPackRegistry.get(packId);
  if (pack?.manifest.workbenchPath?.startsWith("/manufacturing")) {
    return `/manufacturing/${encodeURIComponent(context.id)}`;
  }
  return `/workspace/${encodeURIComponent(context.id)}`;
}

export function presentBoundContexts(
  store: V2SqliteStore,
  tenantId: string,
  packId: string,
) {
  return listBoundContextsForPack(store, tenantId, packId).map((context) => ({
    contextId: context.id,
    businessKey: context.businessKey,
    contextType: context.contextType,
    status: context.status,
    updatedAt: context.updatedAt,
    exceptionCount: store.listExceptions(tenantId, context.id).length,
    resolutionCaseCount: store.listResolutionCases(tenantId, context.id).length,
    workbenchPath: contextPath(packId, context),
  }));
}

export function presentSupportedActions(pack: Pick<SolutionPack, "supportedActionTypes">) {
  return pack.supportedActionTypes.map((actionType) => {
    const metadata = getPolicyActionMetadata(actionType);
    return { type: metadata.actionType, label: metadata.label };
  });
}
