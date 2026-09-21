/**
 * 制造业仿真场景定义（声明式，无副作用）。
 *
 * 每个场景只声明「这家工厂这次发生了什么」，不声明「应该产生什么异常」之外的东西，
 * 也不包含任何时间/随机/IO —— 时间线在 emitter.ts，取值在模拟系统字段里。
 *
 * 全部场景都是 **SIMULATED INDUSTRIAL ENVIRONMENT**：
 * 事件顺序、多系统来源、UNS topic、mapping、connector、ledger、evidence、rule 都是真的，
 * 只有「工厂」是仿真出来的。
 */

export type SimulationScenarioId =
  | "normal"
  | "production-shortfall"
  | "quality-failure"
  | "shipment-shortfall"
  | "payment-shortfall";

export const SIMULATION_SCENARIO_IDS: SimulationScenarioId[] = [
  "normal",
  "production-shortfall",
  "quality-failure",
  "shipment-shortfall",
  "payment-shortfall",
];

export type ScenarioParameters = {
  /** ERP 销售订单数量 */
  orderQty: number;
  /** MES 工单累计完工数量 */
  productionCompleted: number;
  /** MES 报工过程（累计值，最后一项必须等于 productionCompleted） */
  productionReports: number[];
  /** QMS 送检数量 */
  qualityInspected: number;
  /** QMS 合格数量 */
  qualityPassed: number;
  /** QMS 不合格数量 */
  qualityFailed: number;
  /** WMS 实发数量 */
  shipmentQty: number;
  /** 财务开票金额 */
  invoiceAmount: number;
  /** 财务应收金额 */
  receivableAmount: number;
  /** 财务到账金额 */
  paymentAmount: number;
  /** 服务系统记录的客户主张收到数量 */
  claimedReceivedQty: number;
};

export type SimulationScenario = {
  id: SimulationScenarioId;
  label: string;
  /** 现场解说用的一句话：这家工厂这次发生了什么 */
  narrative: string;
  businessKey: string;
  parameters: ScenarioParameters;
  expectation: {
    evaluations: number;
    exceptionCodes: string[];
    /** 说明为什么会命中这些（而不是「因为断言这么写」） */
    rationale: string;
  };
};

function scenario(input: {
  id: SimulationScenarioId;
  label: string;
  narrative: string;
  index: number;
  parameters: ScenarioParameters;
  exceptionCodes: string[];
  rationale: string;
}): SimulationScenario {
  return {
    id: input.id,
    label: input.label,
    narrative: input.narrative,
    businessKey: `SO-IND-${String(input.index).padStart(3, "0")}`,
    parameters: input.parameters,
    expectation: {
      evaluations: 7,
      exceptionCodes: input.exceptionCodes,
      rationale: input.rationale,
    },
  };
}

/**
 * 场景值设计说明（为什么恰好是这些异常）：
 *
 *   规则共 7 条（制造业 profile）：
 *     R1 FULFILLMENT.QUOTE_ORDER_QUANTITY_MISMATCH           报价 vs 订单
 *     R2 FULFILLMENT.SHIPMENT_QUANTITY_SHORTFALL             订单 vs 发货
 *     R3 FULFILLMENT.PAYMENT_BALANCE_OUTSTANDING             应收 vs 回款
 *     R4 FULFILLMENT.CUSTOMER_RECEIPT_CLAIM_MISMATCH         发货 vs 客户主张
 *     R5 ORDER_PRODUCTION_COMPLETION_SHORTFALL               订单 vs 生产完工
 *     R6 QUALITY_NONCONFORMING_QUANTITY_DETECTED             送检 vs 合格
 *     R7 QUALITY_SHIPMENT_QUANTITY_MISMATCH                  合格 vs 发货
 *
 * 每个场景都把「不相关维度」保持自洽，从而让命中的异常集合是可解释、可逐个归因的。
 */
export const SIMULATION_SCENARIOS: SimulationScenario[] = [
  scenario({
    id: "normal",
    index: 1,
    label: "正常履约：订单/生产/质检/发货/回款全部一致",
    narrative: "A 线按单生产 100 件，100 件送检全部合格，100 件发货并被客户签收，全额回款。",
    parameters: {
      orderQty: 100,
      productionCompleted: 100,
      productionReports: [40, 82, 100],
      qualityInspected: 100,
      qualityPassed: 100,
      qualityFailed: 0,
      shipmentQty: 100,
      invoiceAmount: 100000,
      receivableAmount: 100000,
      paymentAmount: 100000,
      claimedReceivedQty: 100,
    },
    exceptionCodes: [],
    rationale: "7 条规则全部执行且全部不命中：没有任何一段履约数字出现缺口。",
  }),
  scenario({
    id: "production-shortfall",
    index: 2,
    label: "生产短少：工单完工 96 < 订单 100",
    narrative: "A 线工单完工 96 件（比订单少 4 件）；缺口由成品库存 4 件补足，因此出货检验、发货与回款仍然完整。",
    parameters: {
      orderQty: 100,
      productionCompleted: 96,
      productionReports: [38, 74, 96],
      qualityInspected: 100,
      qualityPassed: 100,
      qualityFailed: 0,
      shipmentQty: 100,
      invoiceAmount: 100000,
      receivableAmount: 100000,
      paymentAmount: 100000,
      claimedReceivedQty: 100,
    },
    exceptionCodes: ["ORDER_PRODUCTION_COMPLETION_SHORTFALL"],
    rationale:
      "只有 R5 命中（完工 96 < 订单 100）。出货检验覆盖的是整批发货批次（工单 96 + 库存结转 4 = 100），"
      + "所以 R6/R7 不命中；发货与回款完整，所以 R2/R3/R4 不命中 —— 恰好 1 个异常，且缺口被准确定位在 MES。",
  }),
  scenario({
    id: "quality-failure",
    index: 3,
    label: "质量不合格：质检 100 件中 6 件不合格",
    narrative: "工单完工 100 件，终检判定 6 件不合格只能报废；可发货量降到 94 件，实际发货 94 件，按 94 件开票收款。",
    parameters: {
      orderQty: 100,
      productionCompleted: 100,
      productionReports: [42, 88, 100],
      qualityInspected: 100,
      qualityPassed: 94,
      qualityFailed: 6,
      shipmentQty: 94,
      invoiceAmount: 94000,
      receivableAmount: 94000,
      paymentAmount: 94000,
      claimedReceivedQty: 94,
    },
    exceptionCodes: ["QUALITY_NONCONFORMING_QUANTITY_DETECTED", "SHIPMENT_QUANTITY_SHORTFALL"],
    rationale:
      "R6 命中（送检 100 > 合格 94），根因在 QMS。因为可发货量被质量结果约束，WMS 只能发 94 件，"
      + "于是 R2 也命中（订单 100 > 发货 94）—— 这是一条真实的跨系统因果链 QMS→WMS，不是重复计数。"
      + "R7 不命中（合格 94 = 发货 94），R3 不命中（按 94 件开票并全额回款）。",
  }),
  scenario({
    id: "shipment-shortfall",
    index: 4,
    label: "发货短少：订单 100，实际发货 96，生产与质检均正常",
    narrative: "工单完工 100 件，但本次只放行 96 件进入出货检验并全部合格，4 件留在成品待处理区；实际发货 96 件。",
    parameters: {
      orderQty: 100,
      productionCompleted: 100,
      productionReports: [40, 82, 100],
      qualityInspected: 96,
      qualityPassed: 96,
      qualityFailed: 0,
      shipmentQty: 96,
      invoiceAmount: 96000,
      receivableAmount: 96000,
      paymentAmount: 96000,
      claimedReceivedQty: 96,
    },
    exceptionCodes: ["SHIPMENT_QUANTITY_SHORTFALL"],
    rationale:
      "只有 R2 命中（订单 100 > 发货 96），缺口被定位在 WMS。"
      + "R5 不命中（完工 100 = 订单 100），R6/R7 不命中（送检 96 = 合格 96 = 发货 96），R3 不命中（按 96 件开票并全额回款）。",
  }),
  scenario({
    id: "payment-shortfall",
    index: 5,
    label: "回款短少：应收回款缺口 20000",
    narrative: "订单 100 件全部生产、检验、发货并签收，全额开票并挂应收 100000；财务只收到 80000。",
    parameters: {
      orderQty: 100,
      productionCompleted: 100,
      productionReports: [45, 90, 100],
      qualityInspected: 100,
      qualityPassed: 100,
      qualityFailed: 0,
      shipmentQty: 100,
      invoiceAmount: 100000,
      receivableAmount: 100000,
      paymentAmount: 80000,
      claimedReceivedQty: 100,
    },
    exceptionCodes: ["PAYMENT_BALANCE_OUTSTANDING"],
    rationale:
      "只有 R3 命中（应收 100000 > 回款 80000），缺口被定位在财务系统。"
      + "实物履约链（生产/质检/发货/签收）完全自洽，所以其它 6 条规则都不命中。",
  }),
];

export function resolveScenario(id: string): SimulationScenario {
  const found = SIMULATION_SCENARIOS.find((item) => item.id === id);
  if (!found) throw new Error(`UNKNOWN_SIMULATION_SCENARIO:${id}`);
  return found;
}

export const DEFAULT_DEMO_SCENARIO: SimulationScenarioId = "production-shortfall";
/** 比赛现场默认种子固定，保证不可复现的随机永不出现。 */
export const DEFAULT_SIMULATION_SEED = "demo-seed-0001";
