import { openV2SqliteStore } from "./runtime-store.js";
import { seedSoDemo001 } from "./fixtures/so-demo-001.js";
import { DEMO_RULE_DEFINITIONS, DEMO_RULE_VERSIONS } from "./rules/so-demo-001-rules.js";
import { evaluateActiveRules } from "./rule-engine.js";
import type { V2SqliteStore } from "./sqlite-store.js";

export function provisionV2DemoData(store: V2SqliteStore = openV2SqliteStore()) {
  seedSoDemo001(store);
  for (const definition of DEMO_RULE_DEFINITIONS) store.saveRuleDefinition(definition);
  for (const version of DEMO_RULE_VERSIONS) store.saveRuleVersion(version);
  const replay = store.replayContext("demo-industrial", "ctx-so-demo-001");
  const results = evaluateActiveRules(replay, DEMO_RULE_DEFINITIONS, DEMO_RULE_VERSIONS);
  for (const result of results) store.recordRuleExecution(result);
  return {
    contextId: replay.context?.id,
    entities: replay.entities.length,
    entityReferences: replay.entityReferences.length,
    sourceSystems: replay.sourceSystems.length,
    documents: replay.documents.length,
    events: replay.events.length,
    evidence: replay.evidence.length,
    ruleEvaluations: store.listRuleEvaluations("demo-industrial", "ctx-so-demo-001").length,
    exceptions: store.listExceptions("demo-industrial", "ctx-so-demo-001").length,
  };
}
