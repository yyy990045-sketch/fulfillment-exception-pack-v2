import type { RuleVersion } from "../../domain/v2/index.js";
import { ruleVersionContentHash } from "../../domain/v2/rule-engine.js";
import type { PackRuleDefinitionTemplate, PackRuleVersionTemplate } from "../core/types.js";

export const FINANCE_RULE_DEFINITIONS: PackRuleDefinitionTemplate[] = [
  {
    id: "finance-rule-invoice-receivable-amount",
    code: "FINANCE.INVOICE_RECEIVABLE_AMOUNT_MISMATCH",
    name: "发票与应收金额不一致",
    description: "发票金额与应收金额不一致时产生异常候选。",
    exceptionType: "FINANCE.INVOICE_RECEIVABLE_AMOUNT_MISMATCH",
    enabled: true,
    metadata: { order: 1, packId: "finance-reconciliation", profile: "finance" },
  },
  {
    id: "finance-rule-receivable-payment-balance",
    code: "FINANCE.RECEIVABLE_PAYMENT_BALANCE_OUTSTANDING",
    name: "回款尚未覆盖应收",
    description: "应收金额大于银行回款金额时产生异常候选。",
    exceptionType: "FINANCE.RECEIVABLE_PAYMENT_BALANCE_OUTSTANDING",
    enabled: true,
    metadata: { order: 2, packId: "finance-reconciliation", profile: "finance" },
  },
  {
    id: "finance-rule-invoice-payment-amount",
    code: "FINANCE.INVOICE_PAYMENT_AMOUNT_MISMATCH",
    name: "发票金额与银行到账不一致",
    description: "发票金额与银行回款金额不一致时产生异常候选。",
    exceptionType: "FINANCE.INVOICE_PAYMENT_AMOUNT_MISMATCH",
    enabled: true,
    metadata: { order: 3, packId: "finance-reconciliation", profile: "finance" },
  },
];

function version(id: string, ruleId: string, config: RuleVersion["config"]): PackRuleVersionTemplate {
  return {
    id,
    ruleId,
    version: "1.0.0",
    status: "active",
    config,
    contentHash: ruleVersionContentHash(config),
  };
}

export const FINANCE_RULE_VERSIONS: PackRuleVersionTemplate[] = [
  version("finance-rule-version-invoice-receivable-amount-v1", "finance-rule-invoice-receivable-amount", {
    expected: { key: "invoiceAmount", entityType: "invoice", field: "amount", valueType: "currency", aggregation: "single_latest" },
    actual: { key: "receivableAmount", entityType: "receivable", field: "amount", valueType: "currency", aggregation: "single_latest" },
    condition: { operator: "neq" },
    metrics: [{ key: "difference", type: "absolute_difference" }],
    evidenceRoles: { invoiceAmount: "expected", receivableAmount: "actual" },
    presentation: { title: "发票与应收金额不一致", summaryTemplate: "发票金额 {expected}，应收金额 {actual}，差异 {difference}。" },
    severity: "high",
  }),
  version("finance-rule-version-receivable-payment-balance-v1", "finance-rule-receivable-payment-balance", {
    expected: { key: "receivableAmount", entityType: "receivable", field: "amount", valueType: "currency", aggregation: "single_latest" },
    actual: { key: "bankPaymentAmount", entityType: "payment", field: "amount", valueType: "currency", aggregation: "single_latest" },
    condition: { operator: "lt" },
    metrics: [{ key: "difference", type: "absolute_difference" }, { key: "outstandingAmount", type: "positive_difference" }],
    evidenceRoles: { receivableAmount: "expected", bankPaymentAmount: "actual" },
    presentation: { title: "回款尚未覆盖应收", summaryTemplate: "应收金额 {expected}，银行回款 {actual}，尚未覆盖 {outstandingAmount}。" },
    severity: "high",
  }),
  version("finance-rule-version-invoice-payment-amount-v1", "finance-rule-invoice-payment-amount", {
    expected: { key: "invoiceAmount", entityType: "invoice", field: "amount", valueType: "currency", aggregation: "single_latest" },
    actual: { key: "bankPaymentAmount", entityType: "payment", field: "amount", valueType: "currency", aggregation: "single_latest" },
    condition: { operator: "neq" },
    metrics: [{ key: "difference", type: "absolute_difference" }],
    evidenceRoles: { invoiceAmount: "expected", bankPaymentAmount: "actual" },
    presentation: { title: "发票金额与银行到账不一致", summaryTemplate: "发票金额 {expected}，银行回款 {actual}，差异 {difference}。" },
    severity: "high",
  }),
];

export const financeRuleContributions = {
  definitions: FINANCE_RULE_DEFINITIONS,
  versions: FINANCE_RULE_VERSIONS,
};
