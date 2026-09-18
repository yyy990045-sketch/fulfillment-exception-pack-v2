import { openV2SqliteStore } from "./runtime-store.js";
import { seedSoDemo001 } from "./fixtures/so-demo-001.js";
import { seedSoMfg001 } from "./fixtures/so-mfg-001.js";
import { DEMO_RULE_DEFINITIONS, DEMO_RULE_VERSIONS } from "./rules/so-demo-001-rules.js";
import { MANUFACTURING_RULE_DEFINITIONS, MANUFACTURING_RULE_VERSIONS } from "./rules/so-mfg-001-rules.js";
import type { V2SqliteStore } from "./sqlite-store.js";

export function provisionV2DemoData(store: V2SqliteStore = openV2SqliteStore()) {
  seedSoDemo001(store);
  for (const definition of DEMO_RULE_DEFINITIONS) store.saveRuleDefinition(definition);
  for (const version of DEMO_RULE_VERSIONS) {
    store.saveRuleVersion(version);
    store.retireRuleVersionsExcept(version.tenantId, version.ruleId, version.id);
  }
  const replay = store.replayContext("demo-industrial", "ctx-so-demo-001");
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
  seedSoMfg001(store);
  for (const definition of MANUFACTURING_RULE_DEFINITIONS) store.saveRuleDefinition(definition);
  for (const version of MANUFACTURING_RULE_VERSIONS) {
    store.saveRuleVersion(version);
    store.retireRuleVersionsExcept(version.tenantId, version.ruleId, version.id);
  }
  const replay = store.replayContext("demo-manufacturing", "ctx-so-mfg-001");
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
