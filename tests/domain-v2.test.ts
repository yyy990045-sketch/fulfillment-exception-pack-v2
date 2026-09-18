import { describe, expect, it } from "vitest";
import {
  assertUniqueEntityReferences,
  createBusinessEntity,
  createEntityReference,
  createFulfillmentContext,
  createSourceDocument,
  createSourceSystem,
  type FulfillmentContext,
} from "../src/domain/v2/index.js";

const timestamps = {
  openedAt: "2026-09-18T00:00:00.000Z",
  updatedAt: "2026-09-18T00:00:00.000Z",
};

describe("V2 industrial domain foundation", () => {
  it("models a tenant-scoped fulfillment context without requiring a resolution case", () => {
    const context = createFulfillmentContext({
      id: "ctx-1",
      tenantId: "tenant-a",
      businessKey: "SO-2026-0001",
      contextType: "sales_order",
      status: "active",
      ...timestamps,
      metadata: { source: "fixture" },
    });

    expect(context).toMatchObject({ businessKey: "SO-2026-0001", contextType: "sales_order" });
    expect("caseId" in context).toBe(false);
  });

  it("models a generic business entity and cross-system references", () => {
    const context: FulfillmentContext = createFulfillmentContext({
      id: "ctx-1",
      tenantId: "tenant-a",
      businessKey: "SO-2026-0001",
      contextType: "sales_order",
      status: "active",
      ...timestamps,
      metadata: {},
    });
    const entity = createBusinessEntity({
      id: "entity-sales-order",
      tenantId: "tenant-a",
      contextId: context.id,
      entityType: "sales_order",
      businessKey: "SO-2026-0001",
      attributes: { currency: "CNY" },
      createdAt: timestamps.openedAt,
      updatedAt: timestamps.updatedAt,
    });
    const reference = createEntityReference({
      id: "ref-erp",
      tenantId: "tenant-a",
      entityId: entity.id,
      sourceSystemId: "system-erp",
      externalId: "ERP-SO-001",
      externalType: "sales_order",
      createdAt: timestamps.openedAt,
    });

    expect(entity.entityType).toBe("sales_order");
    expect(reference).toMatchObject({ entityId: entity.id, sourceSystemId: "system-erp", externalId: "ERP-SO-001" });
    expect(() => assertUniqueEntityReferences([
      reference,
      { ...reference, id: "ref-finance", sourceSystemId: "system-finance" },
    ])).not.toThrow();
    expect(() => assertUniqueEntityReferences([
      reference,
      { ...reference, id: "ref-duplicate" },
    ])).toThrow(/DOMAIN_ENTITY_REFERENCE_CONFLICT/);
  });

  it("models source systems and source documents separately from Case JSON", () => {
    const sourceSystem = createSourceSystem({
      id: "system-erp",
      tenantId: "tenant-a",
      name: "ERP",
      systemType: "erp",
      authorityLevel: "system_of_record",
      status: "active",
      metadata: {},
    });
    const document = createSourceDocument({
      id: "doc-1",
      tenantId: "tenant-a",
      sourceSystemId: sourceSystem.id,
      contextId: "ctx-1",
      entityId: "entity-sales-order",
      externalDocumentId: "ERP-SO-001",
      documentType: "sales_order",
      contentHash: "a".repeat(64),
      receivedAt: timestamps.openedAt,
      metadata: {},
    });

    expect(document).toMatchObject({ sourceSystemId: sourceSystem.id, externalDocumentId: "ERP-SO-001", documentType: "sales_order" });
  });

  it("rejects malformed identity fields instead of silently creating invalid domain objects", () => {
    expect(() => createFulfillmentContext({
      id: "",
      tenantId: "tenant-a",
      businessKey: "SO-1",
      contextType: "sales_order",
      status: "active",
      ...timestamps,
      metadata: {},
    })).toThrow(/DOMAIN_ID_REQUIRED/);

    expect(() => createEntityReference({
      id: "ref-1",
      tenantId: "tenant-a",
      entityId: "entity-1",
      sourceSystemId: "system-erp",
      externalId: "",
      externalType: "sales_order",
      createdAt: timestamps.openedAt,
    })).toThrow(/DOMAIN_EXTERNAL_ID_REQUIRED/);
  });
});
