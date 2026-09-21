import type { BusinessEntityType } from "../../domain/v2/index.js";
import type { FulfillmentEvent } from "../../domain/v2/index.js";
import { IndustrialSemanticError } from "../../industrial/types.js";
import { parseIndustrialSpace } from "../../industrial/hierarchy.js";
import {
  buildIndustrialUnsTopic,
  decodeTopicSegment as decodeIndustrialSegment,
  encodeTopicSegment as encodeIndustrialSegment,
  isIndustrialUnsTopic,
  parseIndustrialUnsTopic,
  type ParsedIndustrialUnsTopic,
} from "../../industrial/uns-topic.js";
import { OpenSupOSIntegrationError, type OpenSupOSUnsEnvelope, type OpenSupOSTopicParts } from "./types.js";

/**
 * open supOS UNS topic 的两个式子：
 *
 *   legacy（本 pack 早期形式，6 段，仍被既有 fixture / 既有契约测试使用）
 *     fulfillment/{tenantKey}/{contextBusinessKey}/{entityType}/{entityBusinessKey}/{eventType}
 *
 *   industrial（正式 UNS Topic Convention，11 段，集中定义在 src/industrial/uns-topic.ts）
 *     enterprise/{enterpriseId}/site/{siteId}/area/{areaId}/line/{lineId}/{domain}/{entityId}/{eventType}
 *
 * 选择规则是数据驱动的、不是开关：信封 metadata 里带了工业空间绑定（unsSpace）就走 industrial，
 * 否则走 legacy。这样既不改写历史数据，也不给业务逻辑留一个「手工选式子」的口子。
 */
export function encodeTopicSegment(value: string) {
  try {
    return encodeIndustrialSegment(value);
  } catch (error) {
    if (error instanceof IndustrialSemanticError) throw new OpenSupOSIntegrationError(error.code, error.message);
    throw error;
  }
}

export function decodeTopicSegment(value: string) {
  try {
    return decodeIndustrialSegment(value);
  } catch (error) {
    if (error instanceof IndustrialSemanticError) throw new OpenSupOSIntegrationError(error.code, error.message);
    throw error;
  }
}

export function hasIndustrialSpaceBinding(envelope: OpenSupOSUnsEnvelope) {
  return parseIndustrialSpace(envelope.metadata?.unsSpace) !== null;
}

export function buildUnsTopic(envelope: OpenSupOSUnsEnvelope) {
  const space = parseIndustrialSpace(envelope.metadata?.unsSpace);
  if (!space) {
    return [
      "fulfillment",
      envelope.tenantKey,
      envelope.context.businessKey,
      envelope.entity.entityType,
      envelope.entity.businessKey,
      envelope.event.eventType,
    ].map(encodeTopicSegment).join("/");
  }
  try {
    return buildIndustrialUnsTopic({
      space,
      entityType: envelope.entity.entityType,
      entityId: envelope.entity.businessKey,
      eventType: envelope.event.eventType,
    });
  } catch (error) {
    if (error instanceof IndustrialSemanticError) throw new OpenSupOSIntegrationError(error.code, error.message);
    throw error;
  }
}

/**
 * 解析结果对调用方保持结构统一：
 *   legacy 式子带 tenantKey / contextBusinessKey；
 *   industrial 式子**刻意不带**（UNS 描述工业空间，业务 Context 与之分离），因此为 `null`。
 * 这样消费方永远能问「这个 topic 声明了业务上下文吗」，而不是靠 try/catch 猜式子。
 */
export type ParsedUnsTopic =
  | OpenSupOSTopicParts
  | (ParsedIndustrialUnsTopic & { tenantKey: null; contextBusinessKey: null });

export function parseUnsTopic(topic: string): ParsedUnsTopic {
  if (isIndustrialUnsTopic(topic)) {
    try {
      return { ...parseIndustrialUnsTopic(topic), tenantKey: null, contextBusinessKey: null };
    } catch (error) {
      if (error instanceof IndustrialSemanticError) throw new OpenSupOSIntegrationError(error.code, error.message);
      throw error;
    }
  }
  const segments = topic.split("/");
  if (segments.length !== 6 || segments[0] !== "fulfillment") throw new OpenSupOSIntegrationError("INVALID_UNS_TOPIC", topic);
  const [, tenantKey, contextBusinessKey, entityType, entityBusinessKey, eventType] = segments.map(decodeTopicSegment);
  if (!entityType?.trim()) throw new OpenSupOSIntegrationError("UNSUPPORTED_ENTITY_TYPE", entityType);
  if (!eventType?.trim()) throw new OpenSupOSIntegrationError("UNSUPPORTED_EVENT_TYPE", eventType);
  return {
    form: "legacy",
    tenantKey: tenantKey!,
    contextBusinessKey: contextBusinessKey!,
    entityType: entityType as BusinessEntityType,
    entityBusinessKey: entityBusinessKey!,
    eventType: eventType as FulfillmentEvent["eventType"],
  };
}

/** 订阅侧：UNS topic → 领域语义（industrial 式子还要还原工业空间与业务域）。 */
export function describeUnsTopic(topic: string) {
  const parsed = parseUnsTopic(topic);
  if (parsed.form === "industrial") {
    return {
      form: parsed.form,
      entityBusinessKey: parsed.entityId,
      eventType: parsed.eventType,
      domain: parsed.domain,
      space: parsed.space,
    };
  }
  return {
    form: parsed.form,
    entityBusinessKey: parsed.entityBusinessKey,
    eventType: parsed.eventType,
    domain: null,
    space: null,
  };
}
