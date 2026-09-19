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
  const profile = typeof config.ruleProfile === "string" ? config.ruleProfile : undefined;
  return store.transaction(() => {
    const definitions = profile
      ? pack.ruleContributions.definitions.filter((item) => item.metadata.profile === profile)
      : pack.ruleContributions.definitions;
    const definitionIds = new Set(definitions.map((item) => item.id));
    for (const definition of definitions) {
      store.saveRuleDefinition({ ...definition, tenantId, createdAt: now });
    }
    for (const version of pack.ruleContributions.versions.filter((item) => definitionIds.has(item.ruleId))) {
      store.saveRuleVersion({ ...version, tenantId, createdAt: now });
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
