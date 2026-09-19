import { openV2SqliteStore } from "./runtime-store.js";
import { seedSoDemo001 } from "./fixtures/so-demo-001.js";
import { seedSoMfg001 } from "./fixtures/so-mfg-001.js";
import { bindPackContext, manufacturingFulfillmentPack, registerBuiltInSolutionPacks } from "../../solution-packs/index.js";
import type { V2SqliteStore } from "./sqlite-store.js";

export function provisionV2DemoData(store: V2SqliteStore = openV2SqliteStore()) {
  seedSoDemo001(store);
  registerBuiltInSolutionPacks();
  manufacturingFulfillmentPack.install(store, "demo-industrial", "demo-system", { ruleProfile: "industrial" });
  for (const version of manufacturingFulfillmentPack.ruleContributions.versions) {
    const definition = manufacturingFulfillmentPack.ruleContributions.definitions.find((item) => item.id === version.ruleId);
    if (definition?.metadata.profile !== "industrial") continue;
    store.retireRuleVersionsExcept("demo-industrial", version.ruleId, version.id);
  }
  const replay = store.replayContext("demo-industrial", "ctx-so-demo-001");
  bindPackContext(store, manufacturingFulfillmentPack, "demo-industrial", "ctx-so-demo-001", "demo-system");
  return {
    contextId: replay.context?.id,
    entities: replay.entities.length,
    entityReferences: replay.entityReferences.length,
    sourceSystems: replay.sourceSystems.length,
    documents: replay.documents.length,
    events: replay.events.length,
    evidence: replay.evidence.length,
  };
}

export function provisionV2ManufacturingDemoData(store: V2SqliteStore = openV2SqliteStore()) {
  registerBuiltInSolutionPacks();
  manufacturingFulfillmentPack.install(store, "demo-manufacturing", "demo-system", { ruleProfile: "manufacturing" });
  for (const version of manufacturingFulfillmentPack.ruleContributions.versions) {
    const definition = manufacturingFulfillmentPack.ruleContributions.definitions.find((item) => item.id === version.ruleId);
    if (definition?.metadata.profile !== "manufacturing") continue;
    store.retireRuleVersionsExcept("demo-manufacturing", version.ruleId, version.id);
  }
  const result = manufacturingFulfillmentPack.provisionDemo?.(store, "demo-manufacturing", "demo-system");
  const replay = store.replayContext("demo-manufacturing", "ctx-so-mfg-001");
  return {
    contextId: replay.context?.id,
    entities: replay.entities.length,
    entityReferences: replay.entityReferences.length,
    sourceSystems: replay.sourceSystems.length,
    documents: replay.documents.length,
    events: replay.events.length,
    evidence: replay.evidence.length,
    packInstallation: result,
  };
}
