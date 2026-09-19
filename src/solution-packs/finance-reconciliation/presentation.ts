import type { PackPresentation } from "../core/types.js";

export const financePresentation: PackPresentation = {
  contextLabel: "财务对账上下文",
  entityLabels: {
    receivable: "应收",
    invoice: "发票",
    payment: "银行回款",
  },
  exceptionLabels: {
    "FINANCE.INVOICE_RECEIVABLE_AMOUNT_MISMATCH": "发票与应收金额不一致",
    "FINANCE.RECEIVABLE_PAYMENT_BALANCE_OUTSTANDING": "回款尚未覆盖应收",
    "FINANCE.INVOICE_PAYMENT_AMOUNT_MISMATCH": "发票金额与银行到账不一致",
  },
  ruleLabels: {
    "FINANCE.INVOICE_RECEIVABLE_AMOUNT_MISMATCH": "发票与应收金额一致",
  },
  stages: [
    { key: "receivable", label: "应收", entityType: "receivable", factSelectors: [{ key: "amount", field: "amount", label: "金额" }] },
    { key: "invoice", label: "发票", entityType: "invoice", factSelectors: [{ key: "amount", field: "amount", label: "金额" }] },
    { key: "payment", label: "银行回款", entityType: "payment", factSelectors: [{ key: "amount", field: "amount", label: "金额" }] },
  ],
};
