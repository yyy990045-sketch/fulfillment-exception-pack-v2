import type { RuleDefinition, RuleVersion } from "../rule-types.js";
import { ruleVersionContentHash } from "../rule-engine.js";
import {
  buildBaseFulfillmentRuleDefinitions,
  buildBaseFulfillmentRuleVersions,
} from "./so-demo-001-rules.js";

const tenantId = "demo-manufacturing";
const createdAt = "2026-09-18T00:00:00.000Z";

export const MANUFACTURING_RULE_DEFINITIONS: RuleDefinition[] = [
  ...buildBaseFulfillmentRuleDefinitions(tenantId),
  {
    id: "rule-order-production-completion-shortfall",
    tenantId,
    code: "MANUFACTURING.ORDER_PRODUCTION_COMPLETION_SHORTFALL",
    name: "生产完成数量低于订单数量",
    description: "生产完成数量低于订单数量时产生异常候选。",
    exceptionType: "ORDER_PRODUCTION_COMPLETION_SHORTFALL",
    enabled: true,
    createdAt,
    metadata: { order: 5 },
  },
  {
    id: "rule-quality-nonconforming-quantity",
    tenantId,
    code: "MANUFACTURING.QUALITY_NONCONFORMING_QUANTITY_DETECTED",
    name: "质检存在未通过数量",
    description: "质检数量大于合格数量时产生异常候选。",
    exceptionType: "QUALITY_NONCONFORMING_QUANTITY_DETECTED",
    enabled: true,
    createdAt,
    metadata: { order: 6 },
  },
  {
    id: "rule-quality-shipment-quantity-mismatch",
    tenantId,
    code: "MANUFACTURING.QUALITY_SHIPMENT_QUANTITY_MISMATCH",
    name: "质检合格数量与发货数量不一致",
    description: "质检合格数量与发货数量不一致时产生异常候选。",
    exceptionType: "QUALITY_SHIPMENT_QUANTITY_MISMATCH",
    enabled: true,
    createdAt,
    metadata: { order: 7 },
  },
];

function version(id: string, ruleId: string, config: RuleVersion["config"]): RuleVersion {
  return {
    id,
    tenantId,
    ruleId,
    version: "1.0.0",
    status: "active",
    config,
    contentHash: ruleVersionContentHash(config),
    createdAt,
  };
}

export const MANUFACTURING_RULE_VERSIONS: RuleVersion[] = [
  ...buildBaseFulfillmentRuleVersions(tenantId),
  version("rule-version-order-production-completion-shortfall-v1", "rule-order-production-completion-shortfall", {
    expected: { key: "orderQty", entityType: "sales_order", field: "qty", valueType: "number", aggregation: "single_latest" },
    actual: { key: "productionCompletedQty", entityType: "production_order", field: "completedQty", valueType: "number", aggregation: "sum_latest_per_entity" },
    condition: { operator: "lt" },
    metrics: [
      { key: "difference", type: "absolute_difference" },
      { key: "shortfall", type: "positive_difference" },
      { key: "shortfallRatio", type: "difference_ratio" },
    ],
    evidenceRoles: { orderQty: "expected", productionCompletedQty: "actual" },
    presentation: {
      title: "生产完成数量低于订单数量",
      summaryTemplate: "订单数量 {expected}，累计生产完成数量 {actual}，差异 {difference}。",
    },
    severity: "medium",
  }),
  version("rule-version-quality-nonconforming-quantity-v1", "rule-quality-nonconforming-quantity", {
    expected: { key: "qualityInspectedQty", entityType: "quality_event", field: "inspectedQty", valueType: "number", aggregation: "single_latest" },
    actual: { key: "qualityPassedQty", entityType: "quality_event", field: "passedQty", valueType: "number", aggregation: "single_latest" },
    condition: { operator: "lt" },
    metrics: [
      { key: "difference", type: "absolute_difference" },
      { key: "nonconformingQty", type: "positive_difference" },
      { key: "passRatio", type: "ratio" },
    ],
    evidenceRoles: { qualityInspectedQty: "expected", qualityPassedQty: "actual" },
    presentation: {
      title: "质检存在未通过数量",
      summaryTemplate: "质检数量 {expected} 件，合格 {actual} 件，存在 {nonconformingQty} 件未通过数量。",
    },
    severity: "medium",
  }),
  version("rule-version-quality-shipment-quantity-mismatch-v1", "rule-quality-shipment-quantity-mismatch", {
    expected: { key: "qualityPassedQty", entityType: "quality_event", field: "passedQty", valueType: "number", aggregation: "single_latest" },
    actual: { key: "shipmentQty", entityType: "shipment", field: "qty", valueType: "number", aggregation: "sum_latest_per_entity" },
    condition: { operator: "neq" },
    metrics: [{ key: "difference", type: "absolute_difference" }],
    evidenceRoles: { qualityPassedQty: "expected", shipmentQty: "actual" },
    presentation: {
      title: "质检合格数量与发货数量不一致",
      summaryTemplate: "质检合格数量 {expected}，累计发货数量 {actual}，差异 {difference}。",
    },
    severity: "medium",
  }),
];
