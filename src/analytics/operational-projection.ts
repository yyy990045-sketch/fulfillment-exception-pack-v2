import type { ActionType, CaseStatus } from "../types.js";
import type {
  FulfillmentContext,
  V2Exception,
  V2SqliteStore,
} from "../domain/v2/index.js";
import { v2ExceptionLabel } from "../application/v2-workbench-labels.js";
import { OPERATIONAL_METRIC_DEFINITIONS, OPERATIONAL_RESOLUTION_STATUSES, OPERATIONAL_SEVERITIES, OPERATIONAL_TRUTHFULNESS } from "./operational-definitions.js";
import { bucketKey, bucketKeysBetween, normalizeBucket, parseAnalyticsDate } from "./time-buckets.js";
import {
  OperationalAnalyticsError,
  type OperationalAnalyticsFilters,
  type OperationalExceptionRow,
  type OperationalResolutionStatus,
  type OperationalSeverity,
} from "./operational-types.js";

const ACTION_TYPES: ActionType[] = ["supplement_evidence", "urge_follow_up", "reject_overclaim", "review_quotation", "create_task"];
const ACTION_STATUSES = ["draft", "pending_approval", "authorized", "succeeded", "verified", "failed"] as const;

function resolutionCategory(status: CaseStatus, actions: Array<{ status: string }>): OperationalResolutionStatus {
  if (status === "proposed") {
    if (actions.some((action) => action.status === "pending_approval")) return "pending_approval";
    return "proposed_draft";
  }
  if (status === "triaged" || status === "confirmed" || status === "approved" || status === "executed" || status === "closed" || status === "rejected") {
    return status;
  }
  return "no_case";
}

function exceptionOccurrenceAt(store: V2SqliteStore, tenantId: string, exception: V2Exception) {
  const bundle = store.getExceptionEvidenceBundle(tenantId, exception.id);
  const observed = (bundle?.evidence || []).map((item) => item.observedAt).sort().at(-1);
  return observed || exception.createdAt;
}

function inRange(value: string, from?: number, to?: number) {
  const timestamp = Date.parse(value);
  return (from === undefined || timestamp >= from) && (to === undefined || timestamp <= to);
}

function emptyBreakdown() {
  return Object.fromEntries(OPERATIONAL_SEVERITIES.map((severity) => [severity, 0]));
}

export function buildOperationalAnalytics(
  store: V2SqliteStore,
  tenantId: string,
  filters: OperationalAnalyticsFilters = {},
) {
  const bucket = normalizeBucket(filters.bucket);
  const from = parseAnalyticsDate(filters.from, "from");
  const to = parseAnalyticsDate(filters.to, "to");
  if (from !== undefined && to !== undefined && from > to) throw new OperationalAnalyticsError("ANALYTICS_INVALID_DATE_RANGE");
  if (filters.severity && !OPERATIONAL_SEVERITIES.includes(filters.severity)) throw new OperationalAnalyticsError("ANALYTICS_INVALID_FILTER");
  if (filters.resolutionStatus && !OPERATIONAL_RESOLUTION_STATUSES.includes(filters.resolutionStatus)) throw new OperationalAnalyticsError("ANALYTICS_INVALID_FILTER");

  const allContexts = store.listContexts(tenantId);
  const contexts = allContexts.filter((context) =>
    inRange(context.openedAt, from, to) &&
    (!filters.contextType || context.contextType === filters.contextType),
  );
  const definitions = store.listEnabledRuleDefinitions(tenantId);
  const allExceptionRows: OperationalExceptionRow[] = [];
  const sourceSystemById = new Map<string, { name: string; systemType: string }>();
  const contextRows: Array<{
    context: FulfillmentContext;
    ruleEvaluationCount: number;
    exceptionCount: number;
    exceptionCodes: string[];
    resolutionCaseCount: number;
    resolutionStatuses: OperationalResolutionStatus[];
    sourceSystemIds: string[];
    cases: ReturnType<V2SqliteStore["listResolutionCases"]>;
    exceptions: V2Exception[];
    evaluations: ReturnType<V2SqliteStore["listRuleEvaluations"]>;
  }> = [];

  for (const context of contexts) {
    const evaluations = store.listRuleEvaluations(tenantId, context.id);
    const exceptions = store.listExceptions(tenantId, context.id);
    const cases = store.listResolutionCases(tenantId, context.id);
    const caseByException = new Map(cases.map((item) => [item.exceptionId, item]));
    const exceptionRows = exceptions
      .filter((exception) => !filters.exceptionCode || exception.code === filters.exceptionCode)
      .filter((exception) => !filters.severity || exception.severity === filters.severity)
      .filter((exception) => {
        if (!filters.resolutionStatus) return true;
        const resolution = caseByException.get(exception.id);
        return resolutionCategory(resolution?.status ?? "new", resolution?.runtime.actions ?? []) === filters.resolutionStatus;
      })
      .map((exception): OperationalExceptionRow => {
        const resolution = caseByException.get(exception.id);
        const status = resolution ? resolutionCategory(resolution.status, resolution.runtime.actions) : "no_case";
        const bundle = store.getExceptionEvidenceBundle(tenantId, exception.id);
        for (const sourceSystem of bundle?.sourceSystems ?? []) {
          sourceSystemById.set(sourceSystem.id, { name: sourceSystem.name, systemType: sourceSystem.systemType });
        }
        return {
          contextId: context.id,
          contextBusinessKey: context.businessKey,
          exceptionId: exception.id,
          code: exception.code,
          label: v2ExceptionLabel(exception.code),
          severity: exception.severity as OperationalSeverity,
          occurrenceAt: exceptionOccurrenceAt(store, tenantId, exception),
          resolutionStatus: status,
          sourceSystemIds: bundle?.sourceSystems.map((item) => item.id) ?? [],
        };
      });
    allExceptionRows.push(...exceptionRows);
    contextRows.push({
      context,
      ruleEvaluationCount: evaluations.length,
      exceptionCount: exceptionRows.length,
      exceptionCodes: [...new Set(exceptionRows.map((item) => item.code))],
      resolutionCaseCount: cases.length,
      resolutionStatuses: [...new Set(cases.map((item) => resolutionCategory(item.status, item.runtime.actions)))],
      sourceSystemIds: [...new Set(store.listDocuments(tenantId, context.id).map((item) => item.sourceSystemId))],
      cases,
      exceptions,
      evaluations,
    });
  }

  const filteredExceptionIds = new Set(allExceptionRows.map((item) => item.exceptionId));
  const caseRows = contextRows.flatMap((row) => row.cases.filter((item) => filteredExceptionIds.has(item.exceptionId)));
  const receipts = caseRows.flatMap((item) => store.listResolutionReceipts(tenantId, item.id));
  const actions = caseRows.flatMap((item) => item.runtime.actions);
  const exceptionCount = allExceptionRows.length;
  const exceptionsWithResolutionCase = allExceptionRows.filter((item) => item.resolutionStatus !== "no_case").length;
  const closedResolutionCaseCount = caseRows.filter((item) => item.status === "closed").length;

  const rulePerformance = definitions
    .map((definition) => {
      const evaluations = contextRows.flatMap((row) => row.evaluations).filter((item) => item.ruleId === definition.id);
      const matched = evaluations.filter((item) => item.status === "matched").length;
      const notMatched = evaluations.filter((item) => item.status === "not_matched").length;
      return {
        ruleId: definition.id,
        code: definition.code,
        label: definition.name,
        evaluations: evaluations.length,
        matched,
        notMatched,
        triggerRate: evaluations.length ? matched / evaluations.length : null,
      };
    })
    .sort((left, right) => left.code.localeCompare(right.code));

  const exceptionBreakdown = [...new Map(allExceptionRows.map((item) => [item.code, item])).keys()]
    .map((code) => {
      const rows = allExceptionRows.filter((item) => item.code === code);
      return {
        code,
        label: rows[0]?.label ?? code,
        count: rows.length,
        severityBreakdown: OPERATIONAL_SEVERITIES.reduce((result, severity) => {
          result[severity] = rows.filter((item) => item.severity === severity).length;
          return result;
        }, emptyBreakdown() as Record<OperationalSeverity, number>),
        contextsInvolved: [...new Set(rows.map((item) => item.contextId))],
        resolutionCaseCount: rows.filter((item) => item.resolutionStatus !== "no_case").length,
        closedResolutionCaseCount: rows.filter((item) => item.resolutionStatus === "closed").length,
      };
    })
    .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));

  const resolutionFunnel = Object.fromEntries(
    OPERATIONAL_RESOLUTION_STATUSES.map((status) => [status, allExceptionRows.filter((item) => item.resolutionStatus === status).length]),
  ) as Record<OperationalResolutionStatus, number>;

  const actionBreakdown = ACTION_TYPES.map((type) => ({
    type,
    total: actions.filter((action) => action.type === type).length,
    ...Object.fromEntries(ACTION_STATUSES.map((status) => [status, actions.filter((action) => action.type === type && action.status === status).length])),
  }));

  const sourceSystemInvolvement = [...new Set(allExceptionRows.flatMap((item) => item.sourceSystemIds))]
    .map((sourceSystemId) => {
      return {
        sourceSystemId,
        name: sourceSystemById.get(sourceSystemId)?.name ?? sourceSystemId,
        systemType: sourceSystemById.get(sourceSystemId)?.systemType ?? "demo",
        involvedExceptionCount: allExceptionRows.filter((item) => item.sourceSystemIds.includes(sourceSystemId)).length,
      };
    })
    .sort((left, right) => right.involvedExceptionCount - left.involvedExceptionCount || left.sourceSystemId.localeCompare(right.sourceSystemId));

  const occurrenceTimestamps = allExceptionRows.map((item) => Date.parse(item.occurrenceAt));
  const trendFrom = from ?? (occurrenceTimestamps.length ? Math.min(...occurrenceTimestamps) : undefined);
  const trendTo = to ?? (occurrenceTimestamps.length ? Math.max(...occurrenceTimestamps) : undefined);
  const trendKeys = trendFrom !== undefined && trendTo !== undefined ? bucketKeysBetween(trendFrom, trendTo, bucket) : [];
  const exceptionTrend = trendKeys.map((key) => {
    const rows = allExceptionRows.filter((item) => bucketKey(item.occurrenceAt, bucket) === key);
    return { bucket: key, exceptionCount: rows.length, contextsWithException: new Set(rows.map((item) => item.contextId)).size };
  });

  const summary = {
    contextCount: contextRows.length,
    ruleEvaluationCount: contextRows.reduce((sum, row) => sum + row.ruleEvaluationCount, 0),
    matchedRuleEvaluationCount: contextRows.flatMap((row) => row.evaluations).filter((item) => item.status === "matched").length,
    notMatchedRuleEvaluationCount: contextRows.flatMap((row) => row.evaluations).filter((item) => item.status === "not_matched").length,
    detectedExceptionCount: exceptionCount,
    exceptionsWithResolutionCase,
    exceptionsWithoutResolutionCase: exceptionCount - exceptionsWithResolutionCase,
    resolutionCaseCount: caseRows.length,
    closedResolutionCaseCount,
    rejectedResolutionCaseCount: caseRows.filter((item) => item.status === "rejected").length,
    receiptCount: receipts.length,
    actionCount: actions.length,
    verifiedActionCount: actions.filter((action) => action.status === "verified").length,
    governanceCoverageRate: exceptionCount ? exceptionsWithResolutionCase / exceptionCount : null,
    resolutionClosureRate: caseRows.length ? closedResolutionCaseCount / caseRows.length : null,
  };

  return {
    window: {
      from: filters.from ?? null,
      to: filters.to ?? null,
      bucket,
      timeBasis: "context.openedAt" as const,
      trendTimeBasis: "exceptionOccurrenceAt" as const,
    },
    summary,
    exceptionTrend,
    exceptionBreakdown,
    severityBreakdown: OPERATIONAL_SEVERITIES.map((severity) => ({
      severity,
      count: allExceptionRows.filter((item) => item.severity === severity).length,
    })),
    resolutionFunnel,
    rulePerformance,
    actionBreakdown,
    sourceSystemInvolvement,
    contexts: contextRows.map((row) => ({
      contextId: row.context.id,
      businessKey: row.context.businessKey,
      contextType: row.context.contextType,
      status: row.context.status,
      openedAt: row.context.openedAt,
      ruleEvaluationCount: row.ruleEvaluationCount,
      exceptionCount: row.exceptionCount,
      exceptionCodes: row.exceptionCodes,
      resolutionCaseCount: row.resolutionCaseCount,
      resolutionStatuses: row.resolutionStatuses,
      sourceSystemIds: row.sourceSystemIds,
    })),
    metricDefinitions: OPERATIONAL_METRIC_DEFINITIONS,
    truthfulness: OPERATIONAL_TRUTHFULNESS,
  };
}
