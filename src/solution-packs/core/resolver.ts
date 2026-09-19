import type { FulfillmentContext, V2SqliteStore } from "../../domain/v2/index.js";
import { SolutionPackError, type SolutionPack } from "./types.js";
import { solutionPackRegistry } from "./registry.js";
import { verifyPackContextBinding } from "./bindings.js";

export function resolveInstalledPackForContext(
  store: V2SqliteStore,
  context: FulfillmentContext,
): SolutionPack | undefined {
  const binding = store.getSolutionPackContextBinding(context.tenantId, context.id);
  if (binding) return verifyPackContextBinding(store, context.tenantId, context.id);

  // Compatibility fallback is not ownership. New deployments must create an explicit binding.
  const pack = solutionPackRegistry.resolveByContextType(context.contextType);
  if (pack) {
    const installation = store.getSolutionPackInstallation(context.tenantId, pack.manifest.id);
    if (!installation || installation.status !== "active") return undefined;
    throw new SolutionPackError("PACK_CONTEXT_BINDING_REQUIRED", 409);
  }
  return undefined;
}

export function requireInstalledPackForContext(
  store: V2SqliteStore,
  context: FulfillmentContext,
): SolutionPack {
  const pack = resolveInstalledPackForContext(store, context);
  if (!pack) throw new SolutionPackError("PACK_NOT_INSTALLED", 409);
  return pack;
}
