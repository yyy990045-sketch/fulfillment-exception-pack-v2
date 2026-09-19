import type { FulfillmentContext, V2SqliteStore } from "../../domain/v2/index.js";
import { SolutionPackError, type SolutionPack } from "./types.js";
import { solutionPackRegistry } from "./registry.js";

function packsWithEvaluationEvidence(
  store: V2SqliteStore,
  context: FulfillmentContext,
) {
  const ruleIds = new Set(store.listRuleEvaluations(context.tenantId, context.id).map((item) => item.ruleId));
  if (!ruleIds.size) return [];
  return solutionPackRegistry.list().filter((pack) => {
    if (!ruleIds.size || !pack.ruleContributions.definitions.some((definition) => ruleIds.has(definition.id))) return false;
    const installation = store.getSolutionPackInstallation(context.tenantId, pack.manifest.id);
    return installation?.status === "active";
  });
}

export function resolveInstalledPackForContext(
  store: V2SqliteStore,
  context: FulfillmentContext,
): SolutionPack | undefined {
  const evidenceBound = packsWithEvaluationEvidence(store, context);
  if (evidenceBound.length > 1) throw new SolutionPackError("PACK_CONTEXT_BINDING_AMBIGUOUS", 409);
  if (evidenceBound.length === 1) return evidenceBound[0];

  const pack = solutionPackRegistry.resolveByContextType(context.contextType);
  if (!pack) return undefined;
  const installation = store.getSolutionPackInstallation(context.tenantId, pack.manifest.id);
  if (!installation || installation.status !== "active") return undefined;
  return pack;
}

export function requireInstalledPackForContext(
  store: V2SqliteStore,
  context: FulfillmentContext,
): SolutionPack {
  const pack = resolveInstalledPackForContext(store, context);
  if (!pack) throw new SolutionPackError("PACK_NOT_INSTALLED", 409);
  return pack;
}
