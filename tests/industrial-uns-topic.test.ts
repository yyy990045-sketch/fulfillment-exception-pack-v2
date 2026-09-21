import { describe, expect, it } from "vitest";
import { DEMO_MANUFACTURING_SPACE } from "../src/industrial/hierarchy.js";
import {
  INDUSTRIAL_EVENT_TOPIC_BINDINGS,
  UNS_TOPIC_CONVENTION,
  buildIndustrialUnsTopic,
  canonicalEventTypeForTopicEvent,
  industrialDomainForEntityType,
  isIndustrialUnsTopic,
  parseIndustrialUnsTopic,
  topicBindingForEventType,
} from "../src/industrial/uns-topic.js";
import { IndustrialSemanticError } from "../src/industrial/types.js";

describe("UNS Topic Convention", () => {
  it("约定本身是集中声明的 11 段式子", () => {
    expect(UNS_TOPIC_CONVENTION.segmentCount).toBe(11);
    expect(UNS_TOPIC_CONVENTION.template.split("/")).toHaveLength(11);
    expect(UNS_TOPIC_CONVENTION.segments).toContain("{domain}");
  });

  it("构建的 topic 形状与约定一致，并可用 domain + entityId + eventType 反解", () => {
    const topic = buildIndustrialUnsTopic({
      space: DEMO_MANUFACTURING_SPACE,
      entityType: "production_order",
      entityId: "MO-IND-002",
      eventType: "PRODUCTION_COMPLETED",
    });
    expect(topic).toBe(
      "enterprise/demo-manufacturing/site/factory-shanghai-01/area/assembly-workshop/line/line-a/production/MO-IND-002/production.completed",
    );
    const parsed = parseIndustrialUnsTopic(topic);
    expect(parsed).toMatchObject({
      form: "industrial",
      enterpriseId: "demo-manufacturing",
      siteId: "factory-shanghai-01",
      areaId: "assembly-workshop",
      lineId: "line-a",
      domain: "production",
      entityId: "MO-IND-002",
      eventType: "production.completed",
    });
    expect(parsed.space).toEqual(DEMO_MANUFACTURING_SPACE);
    expect(isIndustrialUnsTopic(topic)).toBe(true);
    expect(isIndustrialUnsTopic("fulfillment/demo/SO/entity/key/EVENT")).toBe(false);
  });

  it("topic 描述工业空间而不是业务履约链：Context key 不出现在 topic 里", () => {
    const topic = buildIndustrialUnsTopic({
      space: DEMO_MANUFACTURING_SPACE,
      entityType: "sales_order",
      entityId: "SO-IND-001",
      eventType: "ORDER_CREATED",
    });
    expect(topic).toContain("/sales/SO-IND-001/order.created");
    expect(parseIndustrialUnsTopic(topic).entityId).toBe("SO-IND-001");
  });

  it("转义：业务主键里的斜杠/空格/井号不会污染 topic 结构", () => {
    const topic = buildIndustrialUnsTopic({
      space: DEMO_MANUFACTURING_SPACE,
      entityType: "shipment",
      entityId: "SH / A #1 +",
      eventType: "SHIPMENT_DISPATCHED",
    });
    expect(topic.split("/")).toHaveLength(11);
    expect(parseIndustrialUnsTopic(topic).entityId).toBe("SH / A #1 +");
  });

  it("拒绝段数不符、domain 非法与空段", () => {
    expect(() => parseIndustrialUnsTopic("enterprise/a/site/b/area/c/line/d/production/e")).toThrow(/INVALID_UNS_TOPIC/);
    expect(() => parseIndustrialUnsTopic("enterprise/a/site/b/area/c/line/d/marketing/e/f")).toThrow(/UNSUPPORTED_INDUSTRIAL_DOMAIN/);
    expect(() => parseIndustrialUnsTopic("enterprise//site/b/area/c/line/d/production/e/f")).toThrow(/INVALID_UNS_TOPIC/);
    expect(() => parseIndustrialUnsTopic("enterprise/a/site/b/area/c/line/d/production/e/")).toThrow(/INVALID_UNS_TOPIC/);
  });

  it("规范事件类型与 topic 事件名可双向查，且覆盖仿真全部事件", () => {
    const required = [
      "QUOTE_CREATED", "ORDER_CREATED",
      "PRODUCTION_STARTED", "PRODUCTION_PROGRESSED", "PRODUCTION_COMPLETED",
      "QUALITY_INSPECTED", "QUALITY_PASSED", "QUALITY_FAILED",
      "SHIPMENT_CREATED", "SHIPMENT_DISPATCHED", "SHIPMENT_SIGNED",
      "INVOICE_CREATED", "RECEIVABLE_CREATED", "PAYMENT_RECEIVED", "COMPLAINT_OPENED",
    ];
    for (const eventType of required) {
      const binding = topicBindingForEventType(eventType);
      expect(binding.topicEventType).toBe(binding.topicEventType.toLowerCase());
      expect(canonicalEventTypeForTopicEvent(binding.domain, binding.topicEventType)).toBe(eventType);
    }
    expect(INDUSTRIAL_EVENT_TOPIC_BINDINGS.length).toBeGreaterThanOrEqual(required.length);
  });

  it("未登记的事件类型按实体域回退，未知实体域则失败", () => {
    expect(topicBindingForEventType("PRODUCTION_SCRAPPED", "production_order")).toMatchObject({
      domain: "production",
      topicEventType: "production.scrapped",
    });
    expect(() => topicBindingForEventType("SOMETHING_NEW")).toThrow(IndustrialSemanticError);
    expect(industrialDomainForEntityType("payment")).toBe("finance");
    expect(industrialDomainForEntityType("quality_event")).toBe("quality");
    expect(() => industrialDomainForEntityType("unknown_entity")).toThrow(/UNSUPPORTED_INDUSTRIAL_ENTITY_TYPE/);
  });
});
