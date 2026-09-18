import type { V2SqliteStore } from "../../domain/v2/index.js";
import type { DomainWritePlan } from "./types.js";

export function applyDomainWritePlan(store: V2SqliteStore, plan: DomainWritePlan) {
  return store.transaction(() => {
    store.saveContext(plan.context);
    store.saveSourceSystem(plan.sourceSystem);
    store.saveBusinessEntity(plan.businessEntity);
    store.saveEntityReference(plan.entityReference);
    store.saveSourceDocument(plan.sourceDocument);
    store.appendEvent(plan.event);
    for (const evidence of plan.evidence) store.saveEvidence(evidence);
  });
}
