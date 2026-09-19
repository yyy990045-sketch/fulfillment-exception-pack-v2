import type { ActionType } from "../../types.js";
import type { V2SqliteStore } from "../../domain/v2/index.js";
import type { DecisionHistorySummary } from "./types.js";

const ACTIONS: ActionType[] = ["supplement_evidence", "urge_follow_up", "reject_overclaim", "review_quotation", "create_task"];

function resolutionCategory(status: string, actions: Array<{ status: string }>) {
  if (status === "proposed") return actions.some((action) => action.status === "pending_approval") ? "pending_approval" : "proposed_draft";
  if (["triaged", "confirmed", "approved", "executed", "closed", "rejected"].includes(status)) return status;
  return "no_case";
}

export function buildDecisionHistorySummary(
  store: V2SqliteStore,
  tenantId: string,
  currentExceptionId: string,
  exceptionCode: string,
): DecisionHistorySummary {
  const actionTypeCounts = Object.fromEntries(ACTIONS.map((action) => [action, 0])) as Record<ActionType, number>;
  const resolutionStatusCounts: Record<string, number> = {};
  let sameExceptionCount = 0;
  let sameExceptionWithResolutionCount = 0;
  let closedResolutionCaseCount = 0;
  let rejectedResolutionCaseCount = 0;

  for (const context of store.listContexts(tenantId)) {
    const exceptions = store.listExceptions(tenantId, context.id).filter((item) => item.code === exceptionCode && item.id !== currentExceptionId);
    sameExceptionCount += exceptions.length;
    const cases = store.listResolutionCases(tenantId, context.id);
    for (const exception of exceptions) {
      const resolution = cases.find((item) => item.exceptionId === exception.id);
      if (resolution) sameExceptionWithResolutionCount += 1;
      const category = resolution ? resolutionCategory(resolution.status, resolution.runtime.actions) : "no_case";
      resolutionStatusCounts[category] = (resolutionStatusCounts[category] ?? 0) + 1;
      for (const action of resolution?.runtime.actions ?? []) actionTypeCounts[action.type] += 1;
      if (resolution?.status === "closed") closedResolutionCaseCount += 1;
      if (resolution?.status === "rejected") rejectedResolutionCaseCount += 1;
    }
  }

  return {
    sameExceptionCount,
    sameExceptionWithResolutionCount,
    actionTypeCounts,
    resolutionStatusCounts,
    closedResolutionCaseCount,
    rejectedResolutionCaseCount,
    outcomeMeasured: false,
  };
}
