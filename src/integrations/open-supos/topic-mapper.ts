import type { BusinessEntityType } from "../../domain/v2/index.js";
import { FULFILLMENT_EVENT_TYPES, type FulfillmentEvent } from "../../domain/v2/index.js";
import { OpenSupOSIntegrationError, type OpenSupOSUnsEnvelope, type OpenSupOSTopicParts } from "./types.js";

export function encodeTopicSegment(value: string) {
  if (!value.trim()) throw new OpenSupOSIntegrationError("INVALID_UNS_TOPIC", "empty segment");
  return encodeURIComponent(value.trim());
}

export function decodeTopicSegment(value: string) {
  if (!value) throw new OpenSupOSIntegrationError("INVALID_UNS_TOPIC", "empty segment");
  try { return decodeURIComponent(value); }
  catch { throw new OpenSupOSIntegrationError("INVALID_UNS_TOPIC", "invalid encoding"); }
}

export function buildUnsTopic(envelope: OpenSupOSUnsEnvelope) {
  return [
    "fulfillment",
    envelope.tenantKey,
    envelope.context.businessKey,
    envelope.entity.entityType,
    envelope.entity.businessKey,
    envelope.event.eventType,
  ].map(encodeTopicSegment).join("/");
}

export function parseUnsTopic(topic: string): OpenSupOSTopicParts {
  const segments = topic.split("/");
  if (segments.length !== 6 || segments[0] !== "fulfillment") throw new OpenSupOSIntegrationError("INVALID_UNS_TOPIC", topic);
  const [, tenantKey, contextBusinessKey, entityType, entityBusinessKey, eventType] = segments.map(decodeTopicSegment);
  if (!ENTITY_TYPES.includes(entityType as BusinessEntityType)) throw new OpenSupOSIntegrationError("UNSUPPORTED_ENTITY_TYPE", entityType);
  if (!FULFILLMENT_EVENT_TYPES.includes(eventType as FulfillmentEvent["eventType"])) throw new OpenSupOSIntegrationError("UNSUPPORTED_EVENT_TYPE", eventType);
  return {
    tenantKey: tenantKey!,
    contextBusinessKey: contextBusinessKey!,
    entityType: entityType as BusinessEntityType,
    entityBusinessKey: entityBusinessKey!,
    eventType: eventType as FulfillmentEvent["eventType"],
  };
}

const ENTITY_TYPES: BusinessEntityType[] = ["quote", "contract", "sales_order", "production_order", "quality_event", "shipment", "receivable", "payment", "complaint"];
