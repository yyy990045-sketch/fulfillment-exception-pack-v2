import type { ActionType, ConflictField, GoldCase, GoldMaterial } from "../types.js";
import { buildItOpsGoldSet } from "./it-ops.js";

const TENANT = "demo-tenant-a";
const OTHER = "demo-tenant-b";
const SCOPE = "fulfillment:sales";

function quoteCsv(row: string) {
  return `报价编号,客户编号,项目编号,产品型号,报价日期,数量,单价,BOM成本,加工成本,包装成本,其他成本,税率,是否含税,报价有效期,报价人,审批状态,备注\n${row}`;
}
function orderCsv(row: string) {
  return `订单号,客户编号,项目编号,产品型号,下单日期,数量,单价,交货日期,订单状态,出货状态,异常状态,负责人,备注\n${row}`;
}
function paymentCsv(row: string) {
  return `回款编号,客户编号,订单号,应收金额,已收金额,账期,到期日,收款日期,财务提醒,备注\n${row}`;
}
function complaintCsv(row: string) {
  return `客诉编号,客户编号,项目编号,订单号,客诉日期,问题类型,问题描述,严重等级,责任部门,负责人,临时措施,根因分析,永久措施,8D状态,预计关闭日期,实际关闭日期,客户确认结果,是否关闭,备注\n${row}`;
}

function mats(id: string, parts: Partial<Record<"quote" | "order" | "payment" | "complaint" | "email", { csv?: string; markdown?: string; tenantId?: string; version?: string }>>): GoldMaterial[] {
  const out: GoldMaterial[] = [];
  for (const kind of ["quote", "order", "payment", "complaint", "email"] as const) {
    const part = parts[kind];
    if (!part) continue;
    out.push({
      sourceId: `${id}-${kind}`,
      fileName: `${id}-${kind}.${part.markdown ? "md" : "csv"}`,
      kind,
      version: part.version ?? "v1",
      tenantId: part.tenantId ?? TENANT,
      scope: SCOPE,
      csv: part.csv,
      markdown: part.markdown,
    });
  }
  return out;
}

function fx(
  n: string,
  title: string,
  materials: GoldMaterial[],
  expectedConflicts: GoldCase["expectedConflicts"],
  expectedActionTypes: ActionType[],
  extra: Partial<GoldCase> = {},
): GoldCase {
  const expectedFacts = extra.expectedFacts ?? [];
  return {
    id: `FX-${n}`,
    title,
    tenantId: TENANT,
    scope: extra.scope ?? SCOPE,
    ownerRole: extra.ownerRole ?? "品质负责人",
    pack: extra.pack ?? "fulfillment",
    materials,
    expectedFacts,
    expectedConflicts,
    expectedGaps: extra.expectedGaps ?? [],
    expectedActionTypes,
    negatives: extra.negatives ?? [],
    closeWhen: extra.closeWhen ?? "冲突已对照且批准行动已回执",
  };
}

export function buildGoldSet(): GoldCase[] {
  const hero = fx(
    "001",
    "报价100件 vs 订单80件 vs 客诉按100索赔",
    mats("FX-001", {
      quote: { csv: quoteCsv("TY-QT-001,NC-CUST-01,NC-PRJ-01,NX-240,2026-06-01,100,120,8000,1500,400,200,13,是,2026-07-15,陈晨,已审批,虚构北辰光电") },
      order: { csv: orderCsv("TY-SO-001,NC-CUST-01,NC-PRJ-01,NX-240,2026-06-08,80,120,2026-07-20,生产中,正常,无异常,陈晨,按80件排产") },
      payment: { csv: paymentCsv("TY-PAY-001,NC-CUST-01,TY-SO-001,9600,9600,月结30天,2026-08-07,2026-07-30,已收齐,按订单80件收款") },
      complaint: { csv: complaintCsv("TY-CMP-001,NC-CUST-01,NC-PRJ-01,,2026-08-12,数量不符,客户按报价100件索赔12000,重大,品质部,黄工,先核对数量,待分析,,原因分析,2026-08-20,,,否,订单号空") },
    }),
    [
      { field: "qty", left: 100, right: 80 },
      { field: "amount", left: 12000, right: 9600 },
    ],
    ["supplement_evidence", "reject_overclaim"],
    {
      expectedFacts: [
        { field: "qty", value: 100, sourceId: "FX-001-quote" },
        { field: "qty", value: 80, sourceId: "FX-001-order" },
        { field: "amount", value: 9600, sourceId: "FX-001-payment" },
      ],
      expectedGaps: ["complaint.orderId"],
      ownerRole: "品质负责人",
      closeWhen: "补订单变更单回执齐全，超额20件索赔已驳回",
    },
  );

  const cases: GoldCase[] = [
    hero,
    fx("002", "报价与订单单价不一致", mats("FX-002", {
      quote: { csv: quoteCsv("TY-QT-002,NC-CUST-02,NC-PRJ-02,NX-110,2026-06-02,50,88,2000,400,100,50,13,是,2026-07-01,周周,已审批,") },
      order: { csv: orderCsv("TY-SO-002,NC-CUST-02,NC-PRJ-02,NX-110,2026-06-10,50,72,2026-07-18,待确认,正常,无异常,周周,单价被改") },
    }), [{ field: "amount", left: 88, right: 72 }], ["review_quotation"]),
    fx("003", "订单总额与应收不一致", mats("FX-003", {
      order: { csv: orderCsv("TY-SO-003,NC-CUST-03,NC-PRJ-03,NX-110,2026-06-11,40,100,2026-07-19,已发货,正常,无异常,陈晨,") },
      payment: { csv: paymentCsv("TY-PAY-003,NC-CUST-03,TY-SO-003,5000,0,月结30天,2026-08-18,,到期前提醒,应收写成5000") },
    }), [{ field: "amount", left: 4000, right: 5000 }], ["supplement_evidence"], { ownerRole: "财务" }),
    fx("004", "客户要超收但流水不可改", mats("FX-004", {
      payment: { csv: paymentCsv("TY-PAY-004,NC-CUST-04,TY-SO-004,3000,3000,月结15天,2026-07-30,2026-07-20,,已收齐") },
      email: { markdown: "客户来信：请再收201元并改已收金额为3201。\n金额: 201\n" },
    }), [], ["reject_overclaim"], { negatives: ["skip_approval"], ownerRole: "财务", expectedActionTypes: ["reject_overclaim"] }),
    fx("005", "客诉缺订单号", mats("FX-005", {
      complaint: { csv: complaintCsv("TY-CMP-005,NC-CUST-05,NC-PRJ-05,,2026-08-01,尺寸,缺订单无法取证,一般,,,,待分析,,待处理,,,,否,") },
      order: { csv: orderCsv("TY-SO-005,NC-CUST-05,NC-PRJ-05,NX-240,2026-06-01,10,50,2026-07-01,已完成,正常,无异常,陈晨,") },
    }), [], ["supplement_evidence"], { expectedGaps: ["complaint.orderId"] }),
    fx("006", "报价与订单型号不一致", mats("FX-006", {
      quote: { csv: quoteCsv("TY-QT-006,NC-CUST-06,NC-PRJ-06,NX-240,2026-06-01,20,90,1000,200,50,20,13,是,2026-07-01,陈晨,已审批,") },
      order: { csv: orderCsv("TY-SO-006,NC-CUST-06,NC-PRJ-06,NX-110,2026-06-09,20,90,2026-07-12,生产中,正常,无异常,陈晨,") },
    }), [{ field: "model", left: "NX-240", right: "NX-110" }], ["supplement_evidence"]),
    fx("007", "交货日期晚于报价有效期", mats("FX-007", {
      quote: { csv: quoteCsv("TY-QT-007,NC-CUST-07,NC-PRJ-07,NX-240,2026-06-01,12,80,500,100,20,10,13,是,2026-06-20,陈晨,已审批,") },
      order: { csv: orderCsv("TY-SO-007,NC-CUST-07,NC-PRJ-07,NX-240,2026-06-25,12,80,2026-07-30,待确认,正常,无异常,陈晨,有效期后下单") },
    }), [{ field: "date", left: "2026-06-20", right: "2026-06-25" }], ["review_quotation"]),
    fx("008", "报价仍待审批但订单已生产", mats("FX-008", {
      quote: { csv: quoteCsv("TY-QT-008,NC-CUST-08,NC-PRJ-08,NX-240,2026-06-01,8,70,300,80,20,10,13,是,2026-07-01,陈晨,待审批,") },
      order: { csv: orderCsv("TY-SO-008,NC-CUST-08,NC-PRJ-08,NX-240,2026-06-03,8,70,2026-07-01,生产中,正常,无异常,陈晨,") },
    }), [{ field: "status", left: "待审批", right: "生产中" }], ["review_quotation"]),
    fx("009", "报价v2替换v1单价", mats("FX-009", {
      quote: { csv: quoteCsv("TY-QT-009,NC-CUST-09,NC-PRJ-09,NX-240,2026-05-01,30,28.5,400,80,20,10,13,是,2026-06-01,陈晨,已审批,旧版"), version: "v1" },
    }).concat(mats("FX-009b", {
      quote: { csv: quoteCsv("TY-QT-009,NC-CUST-09,NC-PRJ-09,NX-240,2026-06-01,30,18.5,400,80,20,10,13,是,2026-07-01,陈晨,已审批,新版"), version: "v2" },
    })), [{ field: "amount", left: 28.5, right: 18.5 }], ["review_quotation"]),
    fx("010", "客诉无责任部门与负责人", mats("FX-010", {
      complaint: { csv: complaintCsv("TY-CMP-010,NC-CUST-10,NC-PRJ-10,TY-SO-010,2026-08-01,外观,漆面脱落,重大,,,,,,待处理,,,,否,") },
    }), [], ["urge_follow_up"], { expectedGaps: ["complaint.party"], ownerRole: "品质负责人" }),
    fx("011", "客诉描述含越权承诺", mats("FX-011", {
      complaint: { csv: complaintCsv("TY-CMP-011,NC-CUST-11,NC-PRJ-11,TY-SO-011,2026-08-02,售后,销售已口头保证包赔并终身免费,重大,销售部,陈晨,先安抚,待分析,,待处理,,,,否,") },
    }), [], ["review_quotation"], { expectedGaps: [] }),
    fx("012", "同一客户型号三条客诉聚集", mats("FX-012", {
      complaint: { csv: complaintCsv(
        "TY-CMP-012A,NC-CUST-12,NC-PRJ-12,TY-SO-012,2026-08-01,尺寸,偏大,一般,品质部,黄工,,,待处理,,,,否,,\nTY-CMP-012B,NC-CUST-12,NC-PRJ-12,TY-SO-012,2026-08-03,尺寸,偏大,一般,品质部,黄工,,,待处理,,,,否,,\nTY-CMP-012C,NC-CUST-12,NC-PRJ-12,TY-SO-012,2026-08-05,尺寸,偏大,高,品质部,黄工,,,待处理,,,,否,,",
      ) },
    }), [], ["create_task"]),
    fx("013", "部分收款但客诉称未付款", mats("FX-013", {
      payment: { csv: paymentCsv("TY-PAY-013,NC-CUST-13,TY-SO-013,8000,3000,月结30天,2026-08-30,2026-07-15,,部分收款") },
      complaint: { csv: complaintCsv("TY-CMP-013,NC-CUST-13,NC-PRJ-13,TY-SO-013,2026-08-16,账务,客户称从未付款要求停货,高,财务,,待核对,,,待处理,,,,否,") },
    }), [{ field: "amount", left: 3000, right: 0 }], ["supplement_evidence"], { ownerRole: "财务" }),
    fx("014", "报价1000件订单2000件", mats("FX-014", {
      quote: { csv: quoteCsv("TY-QT-014,NC-CUST-14,NC-PRJ-14,NX-CABLE,2026-06-30,1000,28.5,16000,3200,1000,600,13,是,2026-07-15,陈晨,已审批,") },
      order: { csv: orderCsv("TY-SO-014,NC-CUST-14,NC-PRJ-14,NX-CABLE,2026-07-02,2000,28.5,2026-07-20,生产中,正常,无异常,陈晨,") },
    }), [{ field: "qty", left: 1000, right: 2000 }], ["supplement_evidence"]),
    fx("015", "含税口径冲突", mats("FX-015", {
      quote: { csv: quoteCsv("TY-QT-015,NC-CUST-15,NC-PRJ-15,NX-240,2026-06-01,10,113,500,100,20,10,13,是,2026-07-01,陈晨,已审批,含税") },
      order: { csv: orderCsv("TY-SO-015,NC-CUST-15,NC-PRJ-15,NX-240,2026-06-04,10,100,2026-07-10,待确认,正常,无异常,陈晨,未税") },
    }), [{ field: "amount", left: 113, right: 100 }], ["review_quotation"]),
    fx("016", "跨租户材料必须失败", mats("FX-016", {
      quote: { csv: quoteCsv("TY-QT-016,NC-CUST-16,NC-PRJ-16,NX-240,2026-06-01,5,10,10,1,1,1,13,是,2026-07-01,陈晨,已审批,") },
      order: { csv: orderCsv("TY-SO-016,NC-CUST-16,NC-PRJ-16,NX-240,2026-06-04,5,99,2026-07-10,待确认,正常,无异常,陈晨,外来租户"), tenantId: OTHER },
    }), [], [], { negatives: ["cross_tenant"], expectedActionTypes: [] }),
    fx("017", "空文件无 locator", mats("FX-017", {
      email: { markdown: "" },
    }), [], [], { negatives: ["no_locator", "no_evidence_conclusion"], expectedGaps: ["empty_material"], expectedActionTypes: [] }),
    fx("018", "无 scope 必须 fail-closed", mats("FX-018", {
      quote: { csv: quoteCsv("TY-QT-018,NC-CUST-18,NC-PRJ-18,NX-240,2026-06-01,1,1,1,1,1,1,13,是,2026-07-01,陈晨,已审批,") },
    }), [], [], { scope: "", negatives: ["no_scope"], expectedActionTypes: [] }),
    fx("019", "重复行动幂等", mats("FX-019", {
      order: { csv: orderCsv("TY-SO-019,NC-CUST-19,NC-PRJ-19,NX-240,2026-06-01,3,30,2026-07-01,待确认,正常,无异常,陈晨,") },
      quote: { csv: quoteCsv("TY-QT-019,NC-CUST-19,NC-PRJ-19,NX-240,2026-06-01,6,30,100,20,5,5,13,是,2026-07-01,陈晨,已审批,") },
    }), [{ field: "qty", left: 6, right: 3 }], ["supplement_evidence"], { negatives: ["duplicate_action"] }),
    fx("020", "未批准执行必须失败", mats("FX-020", {
      quote: { csv: quoteCsv("TY-QT-020,NC-CUST-20,NC-PRJ-20,NX-240,2026-06-01,9,10,50,10,2,2,13,是,2026-07-01,陈晨,已审批,") },
      order: { csv: orderCsv("TY-SO-020,NC-CUST-20,NC-PRJ-20,NX-240,2026-06-02,4,10,2026-07-01,待确认,正常,无异常,陈晨,") },
    }), [{ field: "qty", left: 9, right: 4 }], ["supplement_evidence"], { negatives: ["skip_approval"] }),
    fx("021", "回款逾期", mats("FX-021", {
      payment: { csv: paymentCsv("TY-PAY-021,NC-CUST-21,TY-SO-021,12000,0,月结30天,2026-07-01,,请催收,到期未收") },
    }), [], ["urge_follow_up"], { ownerRole: "财务", expectedGaps: [] }),
    fx("022", "客诉已关闭但回款未清", mats("FX-022", {
      complaint: { csv: complaintCsv("TY-CMP-022,NC-CUST-22,NC-PRJ-22,TY-SO-022,2026-07-01,账务,已关闭客诉,一般,财务,钱工,已沟通,账期误解,无,已关闭,2026-07-10,2026-07-10,确认,是,") },
      payment: { csv: paymentCsv("TY-PAY-022,NC-CUST-22,TY-SO-022,9000,0,月结30天,2026-08-01,,仍未收,") },
    }), [{ field: "status", left: "已关闭", right: "未收" }], ["urge_follow_up"], { ownerRole: "财务" }),
    fx("023", "样品型号与订单型号不一致", mats("FX-023", {
      email: { markdown: "样品确认：型号 NX-240\n数量: 2\n" },
      order: { csv: orderCsv("TY-SO-023,NC-CUST-23,NC-PRJ-23,NX-110,2026-07-01,200,40,2026-08-01,待确认,正常,无异常,陈晨,量产型号不同") },
    }), [{ field: "model", left: "NX-240", right: "NX-110" }], ["supplement_evidence"]),
    fx("024", "客户称已付且流水存在", mats("FX-024", {
      payment: { csv: paymentCsv("TY-PAY-024,NC-CUST-24,TY-SO-024,4000,4000,月结30天,2026-07-31,2026-07-20,,已收齐") },
      complaint: { csv: complaintCsv("TY-CMP-024,NC-CUST-24,NC-PRJ-24,TY-SO-024,2026-08-01,账务,客户说已付款但被继续催,一般,财务,钱工,,,待处理,,,,否,,") },
    }), [], ["urge_follow_up"], { ownerRole: "财务" }),
    fx("025", "报价失效后仍下单", mats("FX-025", {
      quote: { csv: quoteCsv("TY-QT-025,NC-CUST-25,NC-PRJ-25,NX-240,2026-05-01,15,60,400,80,20,10,13,是,2026-05-20,陈晨,已失效,") },
      order: { csv: orderCsv("TY-SO-025,NC-CUST-25,NC-PRJ-25,NX-240,2026-06-01,15,60,2026-07-01,待确认,正常,无异常,陈晨,") },
    }), [{ field: "status", left: "已失效", right: "待确认" }], ["review_quotation"]),
    fx("026", "单价冲突", mats("FX-026", {
      quote: { csv: quoteCsv("TY-QT-026,NC-CUST-26,NC-PRJ-26,NX-240,2026-06-01,7,55,200,40,10,5,13,是,2026-07-01,陈晨,已审批,") },
      order: { csv: orderCsv("TY-SO-026,NC-CUST-26,NC-PRJ-26,NX-240,2026-06-03,7,48,2026-07-08,待确认,正常,无异常,陈晨,") },
    }), [{ field: "amount", left: 55, right: 48 }], ["review_quotation"]),
    fx("027", "重大客诉无负责人", mats("FX-027", {
      complaint: { csv: complaintCsv("TY-CMP-027,NC-CUST-27,NC-PRJ-27,TY-SO-027,2026-08-08,功能,开机失败,重大,品质部,,,,待处理,,,,否,,") },
    }), [], ["urge_follow_up"], { expectedGaps: ["complaint.party"] }),
    fx("028", "两侧官方金额均有出处且无法裁决", mats("FX-028", {
      quote: { csv: quoteCsv("TY-QT-028,NC-CUST-28,NC-PRJ-28,NX-240,2026-06-01,11,200,800,100,20,10,13,是,2026-07-01,陈晨,已审批,批准价") },
      order: { csv: orderCsv("TY-SO-028,NC-CUST-28,NC-PRJ-28,NX-240,2026-06-06,11,180,2026-07-16,待确认,正常,无异常,陈晨,合同价") },
    }), [{ field: "amount", left: 200, right: 180 }], ["review_quotation"]),
    fx("029", "对齐案件不应误报冲突", mats("FX-029", {
      quote: { csv: quoteCsv("TY-QT-029,NC-CUST-29,NC-PRJ-29,NX-240,2026-06-01,16,25,200,40,10,5,13,是,2026-07-01,陈晨,已审批,") },
      order: { csv: orderCsv("TY-SO-029,NC-CUST-29,NC-PRJ-29,NX-240,2026-06-02,16,25,2026-07-10,待确认,正常,无异常,陈晨,") },
      payment: { csv: paymentCsv("TY-PAY-029,NC-CUST-29,TY-SO-029,400,400,月结30天,2026-08-01,2026-07-15,,已收齐") },
    }), [], [], { expectedActionTypes: [], closeWhen: "无冲突可直接核验结案" }),
    fx("030", "IT告警第二包：同一Case/Action", [
      {
        sourceId: "FX-030-alert",
        fileName: "FX-030-alert.json",
        kind: "alert",
        version: "v1",
        tenantId: TENANT,
        scope: "it-alert:ops",
        markdown: "告警编号: ALT-030\n主机: edge-01\n级别: critical\n状态: firing\n说明: 磁盘将满需扩容\n",
      },
    ], [], ["create_task"], { pack: "it-alert", ownerRole: "工程师", scope: "it-alert:ops", closeWhen: "扩容任务回执后关闭" }),
  ];

  return cases;
}

export function fulfillmentCases() {
  return buildGoldSet().filter((c) => c.pack === "fulfillment");
}

export function buildContestSet() {
  return [...buildGoldSet(), ...buildItOpsGoldSet()];
}
