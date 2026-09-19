import type { FulfillmentContext, V2SqliteStore } from "../../domain/v2/index.js";
import { getPolicyActionMetadata } from "../../policy/action-catalog.js";
import { solutionPackRegistry } from "./registry.js";
import { SolutionPackError, type SolutionPack } from "./types.js";

function packsWithEvaluationEvidence(
  store: V2SqliteStore,
  context: FulfillmentContext,
) {
  const ruleIds = new Set(store.listRuleEvaluations(context.tenantId, context.id).map((item) => item.ruleId));
  if (!ruleIds.size) return [];
  return solutionPackRegistry.list().filter((pack) => {
    if (!pack.ruleContributions.definitions.some((definition) => ruleIds.has(definition.id))) return false;
    const installation = store.getSolutionPackInstallation(context.tenantId, pack.manifest.id);
    return installation?.status === "active";
  });
}

export function verifyPackContextBinding(
  store: V2SqliteStore,
  tenantId: string,
  contextId: string,
) {
  const binding = store.getSolutionPackContextBinding(tenantId, contextId);
  if (!binding) throw new SolutionPackError("PACK_CONTEXT_BINDING_REQUIRED", 409);
  const context = store.getContext(tenantId, contextId);
  if (!context) throw new SolutionPackError("PACK_CONTEXT_NOT_FOUND", 404);
  const pack = solutionPackRegistry.get(binding.packId);
  if (!pack) throw new SolutionPackError("PACK_CONTEXT_BINDING_PACK_NOT_FOUND", 409);
  const installation = store.getSolutionPackInstallation(tenantId, binding.packId);
  if (!installation || installation.status !== "active") throw new SolutionPackError("PACK_NOT_INSTALLED", 409);
  if (installation.packVersion !== binding.packVersion || pack.manifest.version !== binding.packVersion) {
    throw new SolutionPackError("PACK_CONTEXT_BINDING_VERSION_MISMATCH", 409);
  }
  if (!pack.manifest.contextTypes.includes(context.contextType)) {
    throw new SolutionPackError("PACK_CONTEXT_BINDING_TYPE_MISMATCH", 409);
  }
  const conflictingPack = packsWithEvaluationEvidence(store, context)
    .find((candidate) => candidate.manifest.id !== binding.packId);
  if (conflictingPack) throw new SolutionPackError("PACK_CONTEXT_BINDING_EVALUATION_CONFLICT", 409);
  return pack;
}

export function bindPackContext(
  store: V2SqliteStore,
  pack: SolutionPack,
  tenantId: string,
  contextId: string,
  actor: string,
  source: "pack_provision" | "manual" = "pack_provision",
) {
  const installation = store.getSolutionPackInstallation(tenantId, pack.manifest.id);
  if (!installation || installation.status !== "active") throw new SolutionPackError("PACK_NOT_INSTALLED", 409);
  const context = store.getContext(tenantId, contextId);
  if (!context) throw new SolutionPackError("PACK_CONTEXT_NOT_FOUND", 404);
  if (context.tenantId !== tenantId) throw new SolutionPackError("PACK_CONTEXT_TENANT_MISMATCH", 403);
  if (!pack.manifest.contextTypes.includes(context.contextType)) {
    throw new SolutionPackError("PACK_CONTEXT_TYPE_MISMATCH", 409);
  }
  const existing = store.getSolutionPackContextBinding(tenantId, contextId);
  if (existing && existing.packId !== pack.manifest.id) {
    throw new SolutionPackError("PACK_CONTEXT_ALREADY_BOUND", 409);
  }
  store.saveSolutionPackContextBinding({
    tenantId,
    packId: pack.manifest.id,
    packVersion: installation.packVersion,
    contextId,
    boundAt: new Date().toISOString(),
    boundBy: actor,
    source,
  });
  return verifyPackContextBinding(store, tenantId, contextId);
}

export function backfillPackContextBindings(
  store: V2SqliteStore,
  tenantId: string,
  actor = "migration",
) {
  let created = 0;
  for (const context of store.listContexts(tenantId)) {
    if (store.getSolutionPackContextBinding(tenantId, context.id)) continue;
    const candidates = packsWithEvaluationEvidence(store, context);
    if (candidates.length > 1) throw new SolutionPackError("PACK_CONTEXT_BINDING_AMBIGUOUS", 409);
    if (candidates.length !== 1) continue;
    const pack = candidates[0]!;
    const installation = store.getSolutionPackInstallation(tenantId, pack.manifest.id)!;
    store.saveSolutionPackContextBinding({
      tenantId,
      packId: pack.manifest.id,
      packVersion: installation.packVersion,
      contextId: context.id,
      boundAt: new Date().toISOString(),
      boundBy: actor,
      source: "migration_backfill",
    });
    created += 1;
  }
  return created;
}

export function listBoundContextsForPack(
  store: V2SqliteStore,
  tenantId: string,
  packId: string,
): FulfillmentContext[] {
  return store.listSolutionPackContextBindings(tenantId, packId).flatMap((binding) => {
    verifyPackContextBinding(store, tenantId, binding.contextId);
    const context = store.getContext(tenantId, binding.contextId);
    if (!context) throw new SolutionPackError("PACK_CONTEXT_NOT_FOUND", 404);
    return [context];
  });
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
