import { describe, expect, it } from "vitest";
import {
  INDUSTRIAL_MAPPING_ID,
  INDUSTRIAL_MAPPING_MANIFEST,
  INDUSTRIAL_MAPPING_VERSION,
  REQUIRED_MAPPING_TARGETS,
  assertMappingCoverage,
  industrialMappingContentHash,
  mapSourceFields,
  mappingCoverageReport,
  resolveCanonicalFieldMapping,
  resolveMappingEntry,
  resolveMappingEntryForEvent,
} from "../src/industrial/mapping-manifest.js";
import { IndustrialSemanticError } from "../src/industrial/types.js";

describe("Industrial Mapping Manifest", () => {
  it("至少覆盖 Order / Production / Quality / Shipment / Payment 五个业务对象", () => {
    const report = mappingCoverageReport(INDUSTRIAL_MAPPING_MANIFEST);
    expect(report.complete).toBe(true);
    expect(report.missingTargets).toEqual([]);
    expect(report.requiredTargetCount).toBe(REQUIRED_MAPPING_TARGETS.length);
    expect(report.coveredTargetCount).toBe(REQUIRED_MAPPING_TARGETS.length);
    for (const entityType of ["sales_order", "production_order", "quality_event", "shipment", "receivable", "payment"]) {
      expect(INDUSTRIAL_MAPPING_MANIFEST.entries.filter((item) => item.semantic.entityTypeCanonical === entityType).length)
        .toBeGreaterThan(0);
    }
  });

  it("条目形状把来源字段 → 语义 → 目标三段说清楚", () => {
    const entry = resolveMappingEntry(INDUSTRIAL_MAPPING_MANIFEST, "mes", "completed_qty");
    expect(entry).not.toBeNull();
    expect(entry!.semantic).toMatchObject({
      entityType: "ProductionOrder",
      entityTypeCanonical: "production_order",
      field: "completedQuantity",
      dataType: "number",
      unit: "pcs",
    });
    expect(entry!.target.domain).toBe("production");
    expect(entry!.target.canonicalField).toBe("completedQty");
    expect(entry!.target.unsPath).toBe(
      "enterprise/{enterpriseId}/site/{siteId}/area/{areaId}/line/{lineId}/production/{entityId}/production.completed",
    );
    expect(entry!.provenance.mappingVersion).toBe(`industrial-mapping/v${INDUSTRIAL_MAPPING_VERSION}`);
  });

  it("正向映射：原始字段 → 规范事实，valueType 由声明的 dataType 决定（金额是 currency 不是 number）", () => {
    const { facts, fieldMapping } = mapSourceFields({
      manifest: INDUSTRIAL_MAPPING_MANIFEST,
      sourceSystem: "finance",
      entityTypeCanonical: "receivable",
      topicEventType: "receivable.created",
      fields: { ar_amount: 100000 },
    });
    expect(facts.amount).toEqual({ value: 100000, valueType: "currency" });
    expect(fieldMapping).toEqual([{ sourceField: "ar_amount", canonicalField: "amount", semanticField: "receivableAmount", unit: "CNY" }]);
  });

  it("反向映射：规范事实 → 来源字段 + 语义字段（provenance 用），且区分同一字段的不同事件路径", () => {
    const progressed = resolveCanonicalFieldMapping({
      manifest: INDUSTRIAL_MAPPING_MANIFEST,
      sourceSystem: "mes",
      entityTypeCanonical: "production_order",
      topicEventType: "production.progressed",
      facts: { completedQty: 74 },
    });
    expect(progressed.fieldMapping[0]).toMatchObject({ sourceField: "report_qty", semanticField: "reportedQuantity" });

    const completed = resolveCanonicalFieldMapping({
      manifest: INDUSTRIAL_MAPPING_MANIFEST,
      sourceSystem: "mes",
      entityTypeCanonical: "production_order",
      topicEventType: "production.completed",
      facts: { completedQty: 96 },
    });
    expect(completed.fieldMapping[0]).toMatchObject({ sourceField: "completed_qty", semanticField: "completedQuantity" });

    expect(resolveMappingEntryForEvent(INDUSTRIAL_MAPPING_MANIFEST, {
      entityTypeCanonical: "production_order", canonicalField: "completedQty", topicEventType: "production.progressed",
    })!.sourceField).toBe("report_qty");
  });

  it("fail-closed：未声明的来源字段 / 未声明的规范字段 / 来源系统不匹配都直接失败", () => {
    expect(() => mapSourceFields({
      manifest: INDUSTRIAL_MAPPING_MANIFEST,
      sourceSystem: "mes",
      entityTypeCanonical: "production_order",
      topicEventType: "production.completed",
      fields: { secret_new_column: 1 },
    })).toThrow(/UNMAPPED_SOURCE_FIELD/);

    expect(() => resolveCanonicalFieldMapping({
      manifest: INDUSTRIAL_MAPPING_MANIFEST,
      sourceSystem: "mes",
      entityTypeCanonical: "production_order",
      topicEventType: "production.completed",
      facts: { notDeclared: 1 },
    })).toThrow(/UNMAPPED_CANONICAL_FIELD/);

    expect(() => resolveCanonicalFieldMapping({
      manifest: INDUSTRIAL_MAPPING_MANIFEST,
      sourceSystem: "wms",
      entityTypeCanonical: "production_order",
      topicEventType: "production.completed",
      facts: { completedQty: 96 },
    })).toThrow(/UNMAPPED_CANONICAL_FIELD|MAPPING_SOURCE_SYSTEM_MISMATCH/);

    expect(() => mapSourceFields({
      manifest: INDUSTRIAL_MAPPING_MANIFEST,
      sourceSystem: "mes",
      entityTypeCanonical: "sales_order",
      topicEventType: "production.completed",
      fields: { completed_qty: 96 },
    })).toThrow(/MAPPING_ENTITY_TYPE_MISMATCH/);

    expect(() => mapSourceFields({
      manifest: INDUSTRIAL_MAPPING_MANIFEST,
      sourceSystem: "mes",
      entityTypeCanonical: "production_order",
      topicEventType: "production.started",
      fields: { completed_qty: 96 },
    })).toThrow(/MAPPING_EVENT_PATH_MISMATCH/);

    expect(() => mapSourceFields({
      manifest: INDUSTRIAL_MAPPING_MANIFEST,
      sourceSystem: "qms",
      entityTypeCanonical: "quality_event",
      topicEventType: "quality.passed",
      fields: { passed_qty: "94" },
    })).toThrow(/MAPPING_VALUE_TYPE_MISMATCH/);
  });

  it("manifest 带稳定内容指纹（变更可 diff、可失效缓存）", () => {
    expect(INDUSTRIAL_MAPPING_MANIFEST.id).toBe(INDUSTRIAL_MAPPING_ID);
    expect(INDUSTRIAL_MAPPING_MANIFEST.version).toBe(INDUSTRIAL_MAPPING_VERSION);
    expect(INDUSTRIAL_MAPPING_MANIFEST.contentHash).toHaveLength(64);
    expect(industrialMappingContentHash(INDUSTRIAL_MAPPING_MANIFEST.entries)).toBe(INDUSTRIAL_MAPPING_MANIFEST.contentHash);
    const tampered = {
      ...INDUSTRIAL_MAPPING_MANIFEST,
      entries: INDUSTRIAL_MAPPING_MANIFEST.entries.filter(
        (item) => !(item.semantic.entityTypeCanonical === "shipment" && item.target.canonicalField === "qty"),
      ),
    };
    expect(() => assertMappingCoverage(tampered)).toThrow(IndustrialSemanticError);
    expect(mappingCoverageReport(tampered).missingTargets).toEqual(["shipment.qty"]);
    expect(industrialMappingContentHash(tampered.entries)).not.toBe(INDUSTRIAL_MAPPING_MANIFEST.contentHash);
  });
});
