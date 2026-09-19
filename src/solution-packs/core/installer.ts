import type { V2SqliteStore } from "../../domain/v2/index.js";
import { outcomeDefinitionContentHash } from "../../outcomes/definitions.js";
import { assertCompatibleManifest, solutionPackManifestHash } from "./manifest.js";
import { SolutionPackError, type SolutionPack } from "./types.js";

export function installSolutionPack(
  store: V2SqliteStore,
  pack: SolutionPack,
  tenantId: string,
  actor: string,
  config: Record<string, unknown> = {},
) {
  if (!actor.trim()) throw new SolutionPackError("actor_required", 401);
  assertCompatibleManifest(pack.manifest);
  const now = new Date().toISOString();
  const manifestHash = solutionPackManifestHash(pack.manifest);
  return store.transaction(() => {
    for (const definition of pack.ruleContributions.definitions) {
      if (definition.tenantId !== tenantId) continue;
      store.saveRuleDefinition(definition);
    }
    for (const version of pack.ruleContributions.versions) {
      if (version.tenantId !== tenantId) continue;
      store.saveRuleVersion(version);
    }
    for (const definition of pack.outcomeDefinitions) {
      store.saveOutcomeDefinition({
        tenantId,
        ...definition,
        contentHash: outcomeDefinitionContentHash(definition),
        createdAt: now,
      });
    }
    return store.saveSolutionPackInstallation({
      tenantId,
      packId: pack.manifest.id,
      packVersion: pack.manifest.version,
      status: "active",
      manifestHash,
      config,
      installedBy: actor,
      installedAt: now,
      updatedAt: now,
    });
  });
}
