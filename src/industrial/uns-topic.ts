/**
 * UNS Topic Convention —— **唯一**集中定义处。
 *
 * 稳定 topic 约定（11 段）：
 *
 *   enterprise/{enterpriseId}/site/{siteId}/area/{areaId}/line/{lineId}/{domain}/{entityId}/{eventType}
 *
 * 例：
 *
 *   enterprise/demo-manufacturing/site/factory-shanghai-01/area/assembly-workshop/line/line-a/
 *     production/MO-IND-002/production.completed
 *
 * 设计要点：
 *   1. Topic 描述 **工业空间**，不描述业务履约链。
 *      「SO-IND-002 这一次履约」是 Business Context（在 UNS 信封的 context.businessKey 里），
 *      不是 Topic 的一段；同一条 Line 上可以并存任意多条 Context。
 *   2. Topic 描述 **业务域** 而不是系统名。ERP/MES/QMS/WMS/Finance 都往同一个域里发，
 *      系统身份留在信封的 source.systemKey/source.systemType 与来源账本（Source Ledger）里。
 *   3. Topic 里没有租户段。租户隔离由信封 tenantKey + 连接器安装 + 来源账本保证；
 *      enterprise 已经是本方案的顶层命名空间。
 *   4. 任何业务逻辑都不得字面量拼接 topic —— 一律走本模块。
 */
import { IndustrialSemanticError, type IndustrialDomain, type IndustrialEventTypeBinding, type IndustrialSpace } from "./types.js";

export const UNS_TOPIC_CONVENTION = {
  id: "industrial-uns-topic",
  version: "1.0.0",
  scope: "SIMULATED INDUSTRIAL ENVIRONMENT",
  template: "enterprise/{enterpriseId}/site/{siteId}/area/{areaId}/line/{lineId}/{domain}/{entityId}/{eventType}",
  segments: [
    "enterprise",
    "{enterpriseId}",
    "site",
    "{siteId}",
    "area",
    "{areaId}",
    "line",
    "{lineId}",
    "{domain}",
    "{entityId}",
    "{eventType}",
  ],
  segmentCount: 11,
  /** topic 中 entityId 段的语义：该域业务对象的业务主键（SO/ MO/ QC/ SH/ AR/ PAY/ CP） */
  entityIdSemantics: "business_object_key_of_the_domain",
  domainSegmentValues: ["sales", "production", "quality", "shipment", "finance", "service"] as IndustrialDomain[],
} as const;

/**
 * 规范事件类型 → (domain, topic 事件名)。
 *
 * 之所以需要这张表：领域事件类型是 Core 的方言（`PRODUCTION_COMPLETED`），
 * 而 UNS topic 段用的是工业界更常见的点分小写（`production.completed`）。
 * 二者必须可双向查，不能各写一份。
 */
export const INDUSTRIAL_EVENT_TOPIC_BINDINGS: IndustrialEventTypeBinding[] = [
  { canonicalEventType: "QUOTE_CREATED", domain: "sales", topicEventType: "quote.created" },
  { canonicalEventType: "QUOTE_CHANGED", domain: "sales", topicEventType: "quote.changed" },
  { canonicalEventType: "ORDER_CREATED", domain: "sales", topicEventType: "order.created" },
  { canonicalEventType: "ORDER_CHANGED", domain: "sales", topicEventType: "order.changed" },
  { canonicalEventType: "PRODUCTION_STARTED", domain: "production", topicEventType: "production.started" },
  { canonicalEventType: "PRODUCTION_PROGRESSED", domain: "production", topicEventType: "production.progressed" },
  { canonicalEventType: "PRODUCTION_COMPLETED", domain: "production", topicEventType: "production.completed" },
  { canonicalEventType: "QUALITY_INSPECTED", domain: "quality", topicEventType: "quality.inspected" },
  { canonicalEventType: "QUALITY_PASSED", domain: "quality", topicEventType: "quality.passed" },
  { canonicalEventType: "QUALITY_FAILED", domain: "quality", topicEventType: "quality.failed" },
  { canonicalEventType: "SHIPMENT_CREATED", domain: "shipment", topicEventType: "shipment.created" },
  { canonicalEventType: "SHIPMENT_DISPATCHED", domain: "shipment", topicEventType: "shipment.dispatched" },
  { canonicalEventType: "SHIPMENT_SIGNED", domain: "shipment", topicEventType: "shipment.received" },
  { canonicalEventType: "INVOICE_CREATED", domain: "finance", topicEventType: "invoice.created" },
  { canonicalEventType: "RECEIVABLE_CREATED", domain: "finance", topicEventType: "receivable.created" },
  { canonicalEventType: "PAYMENT_RECEIVED", domain: "finance", topicEventType: "payment.received" },
  { canonicalEventType: "BANK_PAYMENT_RECEIVED", domain: "finance", topicEventType: "payment.received" },
  { canonicalEventType: "COMPLAINT_OPENED", domain: "service", topicEventType: "complaint.created" },
  { canonicalEventType: "COMPLAINT_UPDATED", domain: "service", topicEventType: "complaint.updated" },
];

/** 领域实体类型 → UNS domain 段（作为事件类型未登记时的回退）。 */
export const DOMAIN_FOR_ENTITY_TYPE: Record<string, IndustrialDomain> = {
  quote: "sales",
  contract: "sales",
  sales_order: "sales",
  production_order: "production",
  quality_event: "quality",
  shipment: "shipment",
  invoice: "finance",
  receivable: "finance",
  payment: "finance",
  complaint: "service",
};

export function encodeTopicSegment(value: string) {
  if (!value || !value.trim()) throw new IndustrialSemanticError("INVALID_UNS_TOPIC", "empty segment");
  return encodeURIComponent(value.trim());
}

export function decodeTopicSegment(value: string) {
  if (!value) throw new IndustrialSemanticError("INVALID_UNS_TOPIC", "empty segment");
  try {
    return decodeURIComponent(value);
  } catch {
    throw new IndustrialSemanticError("INVALID_UNS_TOPIC", "invalid encoding");
  }
}

export function topicBindingForEventType(canonicalEventType: string, entityType?: string): IndustrialEventTypeBinding {
  const binding = INDUSTRIAL_EVENT_TOPIC_BINDINGS.find((item) => item.canonicalEventType === canonicalEventType);
  if (binding) return binding;
  const domain = entityType ? DOMAIN_FOR_ENTITY_TYPE[entityType] : undefined;
  if (!domain) throw new IndustrialSemanticError("UNSUPPORTED_INDUSTRIAL_EVENT_TYPE", canonicalEventType);
  return { canonicalEventType, domain, topicEventType: canonicalEventType.toLowerCase().replace(/_/g, ".") };
}

export function industrialDomainForEntityType(entityType: string): IndustrialDomain {
  const domain = DOMAIN_FOR_ENTITY_TYPE[entityType];
  if (!domain) throw new IndustrialSemanticError("UNSUPPORTED_INDUSTRIAL_ENTITY_TYPE", entityType);
  return domain;
}

export function buildIndustrialUnsTopic(input: {
  space: IndustrialSpace;
  entityType: string;
  entityId: string;
  eventType: string;
}) {
  const binding = topicBindingForEventType(input.eventType, input.entityType);
  return [
    "enterprise",
    input.space.enterpriseId,
    "site",
    input.space.siteId,
    "area",
    input.space.areaId,
    "line",
    input.space.lineId,
    binding.domain,
    input.entityId,
    binding.topicEventType,
  ].map(encodeTopicSegment).join("/");
}

export type ParsedIndustrialUnsTopic = {
  form: "industrial";
  enterpriseId: string;
  siteId: string;
  areaId: string;
  lineId: string;
  domain: IndustrialDomain;
  entityId: string;
  eventType: string;
  topicEventType: string;
  space: IndustrialSpace;
};

export function isIndustrialUnsTopic(topic: string) {
  return topic.split("/")[0] === "enterprise";
}

export function parseIndustrialUnsTopic(topic: string): ParsedIndustrialUnsTopic {
  const segments = topic.split("/");
  if (segments.length !== UNS_TOPIC_CONVENTION.segmentCount) {
    throw new IndustrialSemanticError("INVALID_UNS_TOPIC", `${topic} (segments=${segments.length})`);
  }
  const [head, enterpriseId, siteKey, siteId, areaKey, areaId, lineKey, lineId, domain, entityId, eventType] =
    segments.map((segment) => decodeTopicSegment(segment));
  if (head !== "enterprise" || siteKey !== "site" || areaKey !== "area" || lineKey !== "line") {
    throw new IndustrialSemanticError("INVALID_UNS_TOPIC", topic);
  }
  if (!UNS_TOPIC_CONVENTION.domainSegmentValues.includes(domain as IndustrialDomain)) {
    throw new IndustrialSemanticError("UNSUPPORTED_INDUSTRIAL_DOMAIN", String(domain));
  }
  if (!entityId?.trim()) throw new IndustrialSemanticError("INVALID_UNS_TOPIC", "entityId");
  if (!eventType?.trim()) throw new IndustrialSemanticError("INVALID_UNS_TOPIC", "eventType");
  const space: IndustrialSpace = {
    enterpriseId: enterpriseId!,
    siteId: siteId!,
    areaId: areaId!,
    lineId: lineId!,
  };
  return {
    form: "industrial",
    enterpriseId: enterpriseId!,
    siteId: siteId!,
    areaId: areaId!,
    lineId: lineId!,
    domain: domain as IndustrialDomain,
    entityId: entityId!,
    eventType: eventType!,
    topicEventType: eventType!,
    space,
  };
}

/** 反查：UNS topic 事件名 → 规范领域事件类型（用于订阅端把 topic 还原成领域语义）。 */
export function canonicalEventTypeForTopicEvent(domain: IndustrialDomain, topicEventType: string) {
  return INDUSTRIAL_EVENT_TOPIC_BINDINGS
    .find((item) => item.domain === domain && item.topicEventType === topicEventType)?.canonicalEventType ?? null;
}
