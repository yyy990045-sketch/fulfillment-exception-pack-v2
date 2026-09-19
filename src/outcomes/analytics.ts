import type { V2SqliteStore } from "../domain/v2/index.js";
import { getOutcomeEvaluation } from "./service.js";

const STATUSES = ["target_met", "improved", "unchanged", "worsened", "insufficient_evidence"] as const;

export function buildOutcomeAnalytics(store: V2SqliteStore, tenantId: string, filters: { exceptionCode?: string } = {}) {
  const contexts = store.listContexts(tenantId);
  const exceptions = contexts.flatMap((context) => store.listExceptions(tenantId, context.id));
  const filteredExceptions = filters.exceptionCode ? exceptions.filter((item) => item.code === filters.exceptionCode) : exceptions;
  const evaluations = filteredExceptions.flatMap((exception) =>
    store.listOutcomeEvaluations(tenantId, exception.contextId, exception.id).map((record) => getOutcomeEvaluation(store, tenantId, record.contextId, record.exceptionId, record.id)!),
  );
  const statusCounts = Object.fromEntries(STATUSES.map((status) => [status, evaluations.filter((item) => item.status === status).length])) as Record<typeof STATUSES[number], number>;
  const sufficient = evaluations.filter((item) => item.status !== "insufficient_evidence");
  const measuredExceptionIds = new Set(evaluations.map((item) => item.exceptionId));
  const cases = contexts.flatMap((context) => store.listResolutionCases(tenantId, context.id)).filter((item) => filteredExceptions.some((exception) => exception.id === item.exceptionId));
  const caseWithOutcome = (caseId: string) => evaluations.some((item) => item.resolutionCaseId === caseId);
  const automationRuns = filteredExceptions.flatMap((exception) => store.listAutomationRuns(tenantId, exception.contextId, exception.id));
  const actionAssociations = [...new Set(automationRuns.map((item) => item.candidateActionType))].map((actionType) => {
    const associated = evaluations.filter((item) => item.automationRunId && automationRuns.find((run) => run.id === item.automationRunId)?.candidateActionType === actionType);
    return {
      actionType,
      measured: associated.length,
      targetMet: associated.filter((item) => item.status === "target_met").length,
      improved: associated.filter((item) => item.status === "improved").length,
      unchanged: associated.filter((item) => item.status === "unchanged").length,
      worsened: associated.filter((item) => item.status === "worsened").length,
    };
  });
  const associationSummary = (type: "automation" | "resolution" | "unlinked") => {
    const items = evaluations.filter((item) =>
      type === "automation" ? Boolean(item.automationRunId)
        : type === "resolution" ? Boolean(item.resolutionCaseId)
          : !item.automationRunId && !item.resolutionCaseId,
    );
    return {
      measured: items.length,
      targetMet: items.filter((item) => item.status === "target_met").length,
      improved: items.filter((item) => item.status === "improved").length,
      unchanged: items.filter((item) => item.status === "unchanged").length,
      worsened: items.filter((item) => item.status === "worsened").length,
      insufficientEvidence: items.filter((item) => item.status === "insufficient_evidence").length,
    };
  };
  return {
    summary: {
      measuredOutcomeCount: evaluations.length,
      targetMetCount: statusCounts.target_met,
      improvedCount: statusCounts.improved,
      unchangedCount: statusCounts.unchanged,
      worsenedCount: statusCounts.worsened,
      insufficientEvidenceCount: statusCounts.insufficient_evidence,
      outcomeMeasurementCoverage: filteredExceptions.length ? measuredExceptionIds.size / filteredExceptions.length : null,
      observedTargetMetRate: sufficient.length ? statusCounts.target_met / sufficient.length : null,
    },
    statusDistribution: STATUSES.map((status) => ({ status, count: statusCounts[status] })),
    coverage: {
      measured: measuredExceptionIds.size,
      notMeasured: Math.max(0, filteredExceptions.length - measuredExceptionIds.size),
    },
    observedOutcomeAssociation: {
      automation: associationSummary("automation"),
      resolution: associationSummary("resolution"),
      unlinked: associationSummary("unlinked"),
    },
    actionAssociations,
    resolutionAssociation: {
      closedWithMeasuredOutcome: cases.filter((item) => item.status === "closed" && caseWithOutcome(item.id)).length,
      closedWithoutMeasuredOutcome: cases.filter((item) => item.status === "closed" && !caseWithOutcome(item.id)).length,
    },
    syntheticEvidence: evaluations.some((item) => item.syntheticEvidence),
    truthfulness: {
      causalAttribution: false,
      actionEffectivenessMeasured: false,
      roiMeasured: false,
      realCustomerOutcomeData: false,
    },
  };
}

export function buildOutcomeLearningSummary(store: V2SqliteStore, tenantId: string, exceptionCode: string) {
  const analytics = buildOutcomeAnalytics(store, tenantId, { exceptionCode });
  return {
    sameExceptionMeasuredCount: analytics.summary.measuredOutcomeCount,
    statusCounts: Object.fromEntries(analytics.statusDistribution.map((item) => [item.status, item.count])),
    actionAssociations: analytics.actionAssociations,
    outcomeMeasured: analytics.summary.measuredOutcomeCount > 0,
  };
}
