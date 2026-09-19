import type { FulfillmentContext, V2SqliteStore } from "../../domain/v2/index.js";
import { SolutionPackError, type SolutionPack } from "./types.js";
import { solutionPackRegistry } from "./registry.js";

export function resolveInstalledPackForContext(
  store: V2SqliteStore,
  context: FulfillmentContext,
): SolutionPack | undefined {
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
