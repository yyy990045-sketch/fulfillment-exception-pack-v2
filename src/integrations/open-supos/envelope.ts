import {
  FULFILLMENT_EVENT_TYPES,
  type BusinessEntityType,
  type EvidenceLocator,
  type EvidenceValueType,
  type SourceSystemType,
} from "../../domain/v2/index.js";
import { OpenSupOSIntegrationError, type OpenSupOSFact, type OpenSupOSUnsEnvelope } from "./types.js";

const SOURCE_TYPES: SourceSystemType[] = ["erp", "mes", "qms", "wms", "crm", "finance", "manual", "file", "demo"];
const ENTITY_TYPES: BusinessEntityType[] = ["quote", "contract", "sales_order", "production_order", "quality_event", "shipment", "receivable", "payment", "complaint"];
const VALUE_TYPES: EvidenceValueType[] = ["string", "number", "boolean", "date", "datetime", "currency", "json", "null"];

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OpenSupOSIntegrationError("INVALID_UNS_ENVELOPE", path);
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string) {
  if (typeof value !== "string" || !value.trim()) throw new OpenSupOSIntegrationError("INVALID_UNS_ENVELOPE", path);
  return value.trim();
}

function timestamp(value: unknown, path: string) {
  const parsed = string(value, path);
  if (Number.isNaN(Date.parse(parsed))) throw new OpenSupOSIntegrationError("INVALID_UNS_ENVELOPE", path);
  return parsed;
}

function parseFact(value: unknown, path: string): OpenSupOSFact {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const type = typeof value;
    if (type === "number" || type === "string" || type === "boolean" || value === null) return { value: value as OpenSupOSFact["value"], valueType: type === "string" ? "string" : type === "boolean" ? "boolean" : type === "number" ? "number" : "null" };
    throw new OpenSupOSIntegrationError("INVALID_UNS_ENVELOPE", path);
  }
  const candidate = record(value, path);
  if (!("value" in candidate)) return { value: candidate, valueType: "json" };
  if (candidate.valueType !== undefined && !VALUE_TYPES.includes(candidate.valueType as EvidenceValueType)) {
    throw new OpenSupOSIntegrationError("INVALID_UNS_ENVELOPE", `${path}.valueType`);
  }
  return { value: candidate.value as OpenSupOSFact["value"], ...(candidate.valueType ? { valueType: candidate.valueType as EvidenceValueType } : {}) };
}

export function parseOpenSupOSUnsEnvelope(input: unknown): OpenSupOSUnsEnvelope {
  let raw = input;
  if (typeof input === "string") {
    try { raw = JSON.parse(input); }
    catch { throw new OpenSupOSIntegrationError("INVALID_UNS_ENVELOPE", "json"); }
  }
  const envelope = record(raw, "envelope");
  const schemaVersion = string(envelope.schemaVersion, "schemaVersion");
  if (schemaVersion !== "1.0") throw new OpenSupOSIntegrationError("DOMAIN_UNS_SCHEMA_VERSION_UNSUPPORTED", schemaVersion);

  const context = record(envelope.context, "context");
  const source = record(envelope.source, "source");
  const entity = record(envelope.entity, "entity");
  const event = record(envelope.event, "event");
  const lineage = record(envelope.lineage ?? {}, "lineage");
  const metadata = record(envelope.metadata ?? {}, "metadata");
  const systemType = string(source.systemType, "source.systemType") as SourceSystemType;
  const entityType = string(entity.entityType, "entity.entityType") as BusinessEntityType;
  const eventType = string(event.eventType, "event.eventType") as OpenSupOSUnsEnvelope["event"]["eventType"];
  if (!SOURCE_TYPES.includes(systemType)) throw new OpenSupOSIntegrationError("UNSUPPORTED_SOURCE_SYSTEM_TYPE", systemType);
  if (!ENTITY_TYPES.includes(entityType)) throw new OpenSupOSIntegrationError("UNSUPPORTED_ENTITY_TYPE", entityType);
  if (!FULFILLMENT_EVENT_TYPES.includes(eventType)) throw new OpenSupOSIntegrationError("UNSUPPORTED_EVENT_TYPE", eventType);

  const facts = record(envelope.facts, "facts");
  const parsedFacts = Object.fromEntries(Object.entries(facts).map(([key, value]) => {
    if (!key.trim()) throw new OpenSupOSIntegrationError("INVALID_UNS_ENVELOPE", "facts key");
    return [key, parseFact(value, `facts.${key}`)];
  }));
  const contextType = string(context.contextType, "context.contextType");
  if (!["sales_order", "project", "contract"].includes(contextType)) throw new OpenSupOSIntegrationError("INVALID_UNS_ENVELOPE", "context.contextType");
  const confidence = lineage.confidence === undefined ? undefined : Number(lineage.confidence);
  if (confidence !== undefined && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) throw new OpenSupOSIntegrationError("INVALID_UNS_ENVELOPE", "lineage.confidence");

  return {
    schemaVersion: "1.0",
    messageId: string(envelope.messageId, "messageId"),
    tenantKey: string(envelope.tenantKey, "tenantKey"),
    context: { businessKey: string(context.businessKey, "context.businessKey"), contextType: contextType as "sales_order" | "project" | "contract" },
    source: {
      systemKey: string(source.systemKey, "source.systemKey"),
      systemType,
      externalDocumentId: string(source.externalDocumentId, "source.externalDocumentId"),
      documentType: string(source.documentType, "source.documentType"),
      sourceVersion: string(source.sourceVersion, "source.sourceVersion"),
    },
    entity: { entityType, businessKey: string(entity.businessKey, "entity.businessKey") },
    event: { eventType, occurredAt: timestamp(event.occurredAt, "event.occurredAt") },
    facts: parsedFacts,
    lineage: {
      ...(lineage.locator ? { locator: record(lineage.locator, "lineage.locator") as EvidenceLocator } : {}),
      ...(lineage.quote !== undefined ? { quote: string(lineage.quote, "lineage.quote") } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
    },
    metadata,
  };
}
