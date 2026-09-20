import type {
  OperationalAnalyticsView,
  PackWorkbenchView,
  SolutionPackInstalledListView,
} from "../../features/operations/types.js";

const createdAt = "2026-09-19T00:00:00.000Z";

export const operationalAnalyticsFixture: OperationalAnalyticsView = {
  window: {
    from: null,
    to: null,
    bucket: "month",
    timeBasis: "context_opened",
    trendTimeBasis: "exception_occurrence",
  },
  summary: {
    contextCount: 2,
    ruleEvaluationCount: 10,
    matchedRuleEvaluationCount: 5,
    notMatchedRuleEvaluationCount: 5,
    detectedExceptionCount: 7,
    exceptionsWithResolutionCase: 3,
    exceptionsWithoutResolutionCase: 4,
    resolutionCaseCount: 3,
    closedResolutionCaseCount: 1,
    rejectedResolutionCaseCount: 0,
    receiptCount: 1,
    actionCount: 2,
    verifiedActionCount: 1,
    governanceCoverageRate: 3 / 7,
    resolutionClosureRate: 1 / 3,
  },
  exceptionTrend: [
    { bucket: "2026-08-01", label: "2026年08月", from: "2026-08-01T00:00:00.000Z", to: "2026-08-31T23:59:59.999Z", exceptionCount: 3, contextsWithException: 1 },
    { bucket: "2026-09-01", label: "2026年09月", from: "2026-09-01T00:00:00.000Z", to: "2026-09-30T23:59:59.999Z", exceptionCount: 4, contextsWithException: 2 },
  ],
  exceptionBreakdown: [
    { code: "CUSTOMER_RECEIPT_CLAIM_MISMATCH", label: "客户签收主张差异", count: 2, severityBreakdown: { high: 2 }, contextsInvolved: ["ctx-mfg"], resolutionCaseCount: 1, closedResolutionCaseCount: 0 },
    { code: "PAYMENT_BALANCE_OUTSTANDING", label: "回款未结清", count: 1, severityBreakdown: { medium: 1 }, contextsInvolved: ["ctx-mfg", "ctx-fin"], resolutionCaseCount: 1, closedResolutionCaseCount: 1 },
  ],
  severityBreakdown: [
    { severity: "critical", count: 0 },
    { severity: "high", count: 3 },
    { severity: "medium", count: 3 },
    { severity: "low", count: 1 },
  ],
  resolutionFunnel: {
    no_case: 4,
    triaged: 0,
    confirmed: 0,
    proposed_draft: 1,
    pending_approval: 0,
    approved: 1,
    executed: 0,
    closed: 1,
    rejected: 0,
  },
  rulePerformance: [
    { ruleId: "rule-1", code: "RULE-1", label: "客户主张一致性", evaluations: 2, matched: 1, notMatched: 1, triggerRate: 0.5 },
  ],
  actionBreakdown: [
    { type: "supplement_evidence", total: 1, draft: 0, pending_approval: 0, authorized: 0, succeeded: 0, verified: 1, failed: 0 },
    { type: "reject_overclaim", total: 1, draft: 1, pending_approval: 0, authorized: 0, succeeded: 0, verified: 0, failed: 0 },
  ],
  sourceSystemInvolvement: [
    { sourceSystemId: "wms", name: "WMS", systemType: "wms", involvedExceptionCount: 2 },
    { sourceSystemId: "finance", name: "Finance", systemType: "finance", involvedExceptionCount: 1 },
  ],
  contexts: [
    {
      contextId: "ctx-mfg",
      businessKey: "SO-MFG-001",
      contextType: "sales_order",
      status: "active",
      openedAt: createdAt,
      ruleEvaluationCount: 7,
      exceptionCount: 4,
      exceptionCodes: ["CUSTOMER_RECEIPT_CLAIM_MISMATCH", "PAYMENT_BALANCE_OUTSTANDING"],
      resolutionCaseCount: 2,
      resolutionStatuses: ["pending_approval", "closed"],
      resolutionOwnerRoles: ["品质负责人"],
      highestSeverity: "high",
      latestChangeAt: createdAt,
      outcomeMeasurementCount: 1,
      outcomeStatuses: ["target_met"],
      sourceSystemIds: ["wms", "finance"],
    },
    {
      contextId: "ctx-fin",
      businessKey: "FIN-REC-001",
      contextType: "finance_reconciliation",
      status: "active",
      openedAt: createdAt,
      ruleEvaluationCount: 3,
      exceptionCount: 3,
      exceptionCodes: ["PAYMENT_BALANCE_OUTSTANDING"],
      resolutionCaseCount: 1,
      resolutionStatuses: ["confirmed"],
      resolutionOwnerRoles: ["财务"],
      highestSeverity: "medium",
      latestChangeAt: createdAt,
      outcomeMeasurementCount: 0,
      outcomeStatuses: [],
      sourceSystemIds: ["finance"],
    },
  ],
  outcomes: {
    summary: {
      measuredOutcomeCount: 1,
      targetMetCount: 1,
      improvedCount: 0,
      unchangedCount: 0,
      worsenedCount: 0,
      insufficientEvidenceCount: 0,
      outcomeMeasurementCoverage: 0.5,
      observedTargetMetRate: 1,
    },
    statusDistribution: [{ status: "target_met", count: 1 }],
    coverage: { measured: 1, notMeasured: 1 },
    observedOutcomeAssociation: {
      automation: { measured: 0, targetMet: 0, improved: 0, unchanged: 0, worsened: 0, insufficientEvidence: 0 },
      resolution: { measured: 1, targetMet: 1, improved: 0, unchanged: 0, worsened: 0, insufficientEvidence: 0 },
      unlinked: { measured: 0, targetMet: 0, improved: 0, unchanged: 0, worsened: 0, insufficientEvidence: 0 },
    },
    actionAssociations: [],
    resolutionAssociation: { closedWithMeasuredOutcome: 0, closedWithoutMeasuredOutcome: 1 },
    syntheticEvidence: true,
    truthfulness: { causalAttribution: false, actionEffectivenessMeasured: false, roiMeasured: false, realCustomerOutcomeData: false },
  },
  metricDefinitions: {
    governanceCoverageRate: "进入治理的异常 / 全部异常",
    resolutionClosureRate: "已结案 Resolution / 全部 Resolution",
    ruleTriggerRate: "命中评估 / 全部评估",
    exceptionOccurrenceAt: "Evidence observedAt",
    sourceSystemInvolvement: "涉及同一异常的来源系统",
    outcomeMeasurementCoverage: "有后续测量的异常 / 全部异常",
    observedTargetMetRate: "目标达成 / 有足够证据的结果测量",
  },
  truthfulness: {
    derivedFromDomainFacts: true,
    realBusinessOutcomeMeasured: false,
    financialImpactMeasured: false,
    ruleAccuracyMeasured: false,
    aiDecisionQualityMeasured: false,
    realExternalExecutionMeasured: false,
  },
};

const manufacturingManifest = {
  id: "manufacturing-fulfillment",
  version: "1.0.0",
  name: "Manufacturing Fulfillment",
  description: "制造业订单履约异常与治理方案。",
  contextTypes: ["sales_order"],
  capabilities: { rules: true, outcomes: true, presentation: true, decisionEligibility: true, demo: true },
  workbenchPath: "/manufacturing",
  compatibility: { coreApiVersion: "1" },
};

const financeManifest = {
  id: "finance-reconciliation",
  version: "1.0.0",
  name: "Finance Reconciliation",
  description: "应收、发票与银行回款对账方案。",
  contextTypes: ["finance_reconciliation"],
  capabilities: { rules: true, outcomes: true, presentation: true, decisionEligibility: true, demo: true },
  workbenchPath: "/workspace?context=ctx-fin",
  compatibility: { coreApiVersion: "1" },
};

export const installedPacksFixture: SolutionPackInstalledListView = {
  installations: [
    {
      installation: { tenantId: "demo-manufacturing", packId: manufacturingManifest.id, packVersion: "1.0.0", status: "active", manifestHash: "a".repeat(64), config: {}, installedBy: "admin", installedAt: createdAt, updatedAt: createdAt },
      manifest: manufacturingManifest,
      supportedActions: [
        { type: "supplement_evidence", label: "补充证据" },
        { type: "urge_follow_up", label: "跟进催办" },
        { type: "reject_overclaim", label: "驳回超额主张" },
        { type: "route_quotation_to_review", label: "送入报价复核" },
        { type: "approve_or_change_quotation_terms", label: "批准或变更报价条款" },
        { type: "create_task", label: "创建任务" },
      ],
      boundContexts: [{ contextId: "ctx-mfg", businessKey: "SO-MFG-001", contextType: "sales_order", status: "active", updatedAt: createdAt, exceptionCount: 4, resolutionCaseCount: 2, workbenchPath: "/manufacturing/ctx-mfg" }],
    },
    {
      installation: { tenantId: "demo-manufacturing", packId: financeManifest.id, packVersion: "1.0.0", status: "active", manifestHash: "b".repeat(64), config: {}, installedBy: "admin", installedAt: createdAt, updatedAt: createdAt },
      manifest: financeManifest,
      supportedActions: [
        { type: "supplement_evidence", label: "补充证据" },
        { type: "urge_follow_up", label: "跟进催办" },
        { type: "route_quotation_to_review", label: "送入报价复核" },
        { type: "create_task", label: "创建任务" },
      ],
      boundContexts: [{ contextId: "ctx-fin", businessKey: "FIN-REC-001", contextType: "finance_reconciliation", status: "active", updatedAt: createdAt, exceptionCount: 3, resolutionCaseCount: 1, workbenchPath: "/workspace/ctx-fin" }],
    },
  ],
};

export function packWorkbenchFixture(input: { id: string; businessKey: string; contextType: string; packId: string }): PackWorkbenchView {
  const finance = input.packId === "finance-reconciliation";
  return {
    pack: {
      id: input.packId,
      version: "1.0.0",
      name: finance ? "Finance Reconciliation" : "Manufacturing Fulfillment",
      contextLabel: finance ? "财务对账上下文" : "制造履约",
      workbenchPath: finance ? "/workspace" : "/manufacturing",
      supportedActions: finance
        ? [{ type: "supplement_evidence", label: "补充证据" }, { type: "create_task", label: "创建任务" }]
        : [{ type: "supplement_evidence", label: "补充证据" }, { type: "reject_overclaim", label: "驳回超额主张" }],
    },
    context: {
      id: input.id,
      tenantId: "demo-manufacturing",
      businessKey: input.businessKey,
      contextType: input.contextType,
      status: "active",
      openedAt: createdAt,
      updatedAt: createdAt,
    },
    stats: { entities: 3, evidence: 4, ruleEvaluations: 3, matchedRules: 2, notMatchedRules: 1, exceptions: 1 },
    thread: [
      { key: "invoice", label: "发票", entityId: "entity-invoice", businessKey: "INV-001", facts: [{ key: "amount", label: "金额", field: "amount", value: 100000, valueType: "currency", evidenceId: "evidence-fin-1" }], state: "normal" },
      { key: "payment", label: "银行回款", entityId: "entity-payment", businessKey: "BANK-001", facts: [{ key: "amount", label: "回款", field: "amount", value: 80000, valueType: "currency", evidenceId: "evidence-fin-2" }], state: "exception" },
    ],
    rules: [{ id: "rule-fin-1", code: "FIN.BALANCE_OUTSTANDING", label: "应收余额已结清", status: "matched", matched: true, metrics: {} }],
    exceptions: [{ id: "exception-fin", code: "PAYMENT_BALANCE_OUTSTANDING", label: "回款未结清", title: "发票与银行回款存在余额", summary: "后续回款尚未覆盖应收。", severity: "medium", metrics: { outstandingAmount: 20000 }, evidenceCount: 2 }],
    outcomes: [],
    truthfulness: { syntheticDemoData: true, packBound: true, causalAttribution: false },
  };
}
