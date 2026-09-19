import type { V2SqliteStore } from "../../domain/v2/index.js";
import { seedSoMfg001 } from "../../domain/v2/fixtures/so-mfg-001.js";

export function provisionManufacturingPackDemo(store: V2SqliteStore) {
  seedSoMfg001(store);
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
