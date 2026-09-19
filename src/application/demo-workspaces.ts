import type { V2SqliteStore } from "../domain/v2/index.js";
import { presentBoundContexts, solutionPackRegistry } from "../solution-packs/index.js";

export const DEMO_ORGANIZATIONS = [
  { tenantId: "demo-manufacturing", organization: "示例制造企业" },
  { tenantId: "demo-finance", organization: "示例财务企业" },
] as const;

export function demoOrganizationName(tenantId: string) {
  return DEMO_ORGANIZATIONS.find((item) => item.tenantId === tenantId)?.organization ?? tenantId;
}

export function buildDemoWorkspaceProjection(store: V2SqliteStore) {
  const organizations = DEMO_ORGANIZATIONS.map((definition) => {
    const packs = store.listSolutionPackInstallations(definition.tenantId, "active").flatMap((installation) => {
      const pack = solutionPackRegistry.get(installation.packId);
      if (!pack) return [];
      const contexts = presentBoundContexts(store, definition.tenantId, installation.packId);
      return [{
        packId: installation.packId,
        version: installation.packVersion,
        name: pack.manifest.name,
        contexts,
      }];
    });
    const contexts = packs.flatMap((pack) => pack.contexts);
    return {
      organization: definition.organization,
      tenantId: definition.tenantId,
      packs,
      contexts,
      defaultPath: contexts[0]?.workbenchPath ?? "/operations",
    };
  });
  return { organizations };
}
