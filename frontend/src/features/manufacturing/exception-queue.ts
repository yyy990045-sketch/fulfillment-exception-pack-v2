import type { ExceptionView, ThreadStage } from "./types.js";
import { exceptionStatusLabel, formatMetricValue, metricLabel } from "./utils.js";

export type GovernanceQueueStage = ExceptionView["governanceStage"];

export type ExceptionQueueFilters = {
  query: string;
  severity: string;
  status: string;
  stageKey: string;
  governanceStage: string;
  unresolvedFirst: boolean;
};

const severityOrder: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const primaryMetricOrder = [
  "difference",
  "shortfall",
  "outstandingAmount",
  "failedQty",
  "openNonconformingQty",
  "verifiedReceiptDifference",
];

export function governanceStageLabel(stage: GovernanceQueueStage) {
  return {
    not_started: "未进入治理",
    review: "待复核",
    proposal: "待拟定方案",
    proposal_draft: "方案草案",
    pending_approval: "等待审批",
    approved: "已批准",
    executed: "已执行",
    closed: "已结案",
    rejected: "已终止",
  }[stage];
}

export function primaryExceptionDifference(exception: ExceptionView) {
  const entries = Object.entries(exception.metrics ?? {});
  const entry = primaryMetricOrder
    .map((key) => entries.find(([candidate]) => candidate === key))
    .find(Boolean) ?? entries[0];
  return entry ? `${metricLabel(entry[0])} ${formatMetricValue(entry[1])}` : "等待业务核对";
}

function exceptionUpdatedAt(exception: ExceptionView) {
  return exception.lastDetectedAt || exception.createdAt;
}

function matchesQuery(exception: ExceptionView, query: string) {
  if (!query) return true;
  const haystack = [
    exception.label,
    exception.title,
    exception.summary,
    ...Object.entries(exception.metrics ?? {}).flatMap(([key, value]) => [
      metricLabel(key),
      exceptionStatusLabel(exception.status),
      String(value),
    ]),
  ].join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export function filterAndSortExceptions(
  exceptions: ExceptionView[],
  filters: ExceptionQueueFilters,
) {
  return exceptions
    .map((exception, index) => {
      return { exception, governanceStage: exception.governanceStage, index };
    })
    .filter(({ exception, governanceStage }) => {
      if (!matchesQuery(exception, filters.query.trim())) return false;
      if (filters.severity && exception.severity !== filters.severity) return false;
      if (filters.status && exception.status !== filters.status) return false;
      if (filters.stageKey && !exception.stageKeys.includes(filters.stageKey)) return false;
      if (filters.governanceStage && governanceStage !== filters.governanceStage) return false;
      return true;
    })
    .sort((left, right) => {
      const severity = (severityOrder[right.exception.severity] ?? 0) - (severityOrder[left.exception.severity] ?? 0);
      if (severity) return severity;
      if (filters.unresolvedFirst) {
        const leftResolved = ["closed", "rejected"].includes(left.governanceStage);
        const rightResolved = ["closed", "rejected"].includes(right.governanceStage);
        if (leftResolved !== rightResolved) return leftResolved ? 1 : -1;
      }
      const updated = exceptionUpdatedAt(right.exception).localeCompare(exceptionUpdatedAt(left.exception));
      return updated || left.index - right.index;
    })
    .map(({ exception, governanceStage }) => ({ exception, governanceStage }));
}

export function exceptionQueueOptions(
  exceptions: ExceptionView[],
  stages: ThreadStage[],
) {
  const severities = [...new Set(exceptions.map((item) => item.severity))];
  const statuses = [...new Set(exceptions.map((item) => item.status))];
  const stageKeys = [...new Set(exceptions.flatMap((item) => item.stageKeys))];
  const governanceStages = [...new Set(exceptions.map((item) => item.governanceStage))];
  return {
    severities,
    statuses,
    stages: stageKeys.flatMap((key) => {
      const stage = stages.find((item) => item.key === key);
      return stage ? [{ value: key, label: stage.label }] : [];
    }),
    governanceStages: governanceStages.map((value) => ({ value, label: governanceStageLabel(value) })),
  };
}
