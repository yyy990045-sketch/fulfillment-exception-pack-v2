import { openV2SqliteStore } from "./runtime-store.js";
import { seedSoDemo001 } from "./fixtures/so-demo-001.js";
import type { V2SqliteStore } from "./sqlite-store.js";

export function provisionV2DemoData(store: V2SqliteStore = openV2SqliteStore()) {
  seedSoDemo001(store);
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
