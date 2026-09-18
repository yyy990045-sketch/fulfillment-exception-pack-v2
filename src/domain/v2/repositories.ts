import type {
  BusinessEntity,
  EntityReference,
  FulfillmentContext,
  FulfillmentEvent,
  SourceDocument,
  SourceSystem,
} from "./types.js";
import type { V2SqliteStore } from "./sqlite-store.js";

export interface FulfillmentContextRepository {
  get(tenantId: string, contextId: string): FulfillmentContext | undefined;
  save(context: FulfillmentContext): FulfillmentContext;
}

export interface BusinessEntityRepository {
  get(tenantId: string, entityId: string): BusinessEntity | undefined;
  list(tenantId: string, contextId: string): BusinessEntity[];
  save(entity: BusinessEntity): BusinessEntity;
}

export interface EntityReferenceRepository {
  list(tenantId: string, contextId: string): EntityReference[];
  save(reference: EntityReference): EntityReference;
}

export interface SourceSystemRepository {
  get(tenantId: string, sourceSystemId: string): SourceSystem | undefined;
  listInvolved(tenantId: string, contextId: string): SourceSystem[];
  save(sourceSystem: SourceSystem): SourceSystem;
}

export interface SourceDocumentRepository {
  get(tenantId: string, documentId: string): SourceDocument | undefined;
  list(tenantId: string, contextId: string): SourceDocument[];
  save(document: SourceDocument): SourceDocument;
}

export interface FulfillmentEventRepository {
  get(tenantId: string, eventId: string): FulfillmentEvent | undefined;
  list(tenantId: string, contextId: string): FulfillmentEvent[];
  append(event: FulfillmentEvent): FulfillmentEvent;
}

export function createV2Repositories(store: V2SqliteStore) {
  return {
    contexts: {
      get: (tenantId: string, contextId: string) => store.getContext(tenantId, contextId),
      save: (context: FulfillmentContext) => store.saveContext(context),
    } satisfies FulfillmentContextRepository,
    entities: {
      get: (tenantId: string, entityId: string) => store.getBusinessEntity(tenantId, entityId),
      list: (tenantId: string, contextId: string) => store.listEntities(tenantId, contextId),
      save: (entity: BusinessEntity) => store.saveBusinessEntity(entity),
    } satisfies BusinessEntityRepository,
    entityReferences: {
      list: (tenantId: string, contextId: string) => store.listEntityReferences(tenantId, contextId),
      save: (reference: EntityReference) => store.saveEntityReference(reference),
    } satisfies EntityReferenceRepository,
    sourceSystems: {
      get: (tenantId: string, sourceSystemId: string) => store.getSourceSystem(tenantId, sourceSystemId),
      listInvolved: (tenantId: string, contextId: string) => store.listInvolvedSourceSystems(tenantId, contextId),
      save: (sourceSystem: SourceSystem) => store.saveSourceSystem(sourceSystem),
    } satisfies SourceSystemRepository,
    sourceDocuments: {
      get: (tenantId: string, documentId: string) => store.getSourceDocument(tenantId, documentId),
      list: (tenantId: string, contextId: string) => store.listDocuments(tenantId, contextId),
      save: (document: SourceDocument) => store.saveSourceDocument(document),
    } satisfies SourceDocumentRepository,
    events: {
      get: (tenantId: string, eventId: string) => store.getEvent(tenantId, eventId),
      list: (tenantId: string, contextId: string) => store.listEvents(tenantId, contextId),
      append: (event: FulfillmentEvent) => store.appendEvent(event),
    } satisfies FulfillmentEventRepository,
  };
}
