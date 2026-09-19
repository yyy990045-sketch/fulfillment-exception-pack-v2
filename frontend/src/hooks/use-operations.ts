import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../api/client.js";
import { useDemoSettings } from "../app/demo-settings.js";
import type { ResolutionCaseListResponse } from "../features/manufacturing/analysis-types.js";
import type {
  InternalWorkItemListView,
  OperationalAnalyticsView,
  PackWorkbenchView,
  SolutionPackCatalogView,
  SolutionPackInstalledListView,
} from "../features/operations/types.js";
import { queryKeys } from "./query-keys.js";

export type OperationalAnalyticsQuery = {
  from?: string;
  to?: string;
  timeBasis?: "context_opened" | "exception_occurrence";
  bucket?: "day" | "week" | "month";
  contextType?: string;
  exceptionCode?: string;
  severity?: "low" | "medium" | "high" | "critical";
  resolutionStatus?: "no_case" | "triaged" | "confirmed" | "proposed_draft" | "pending_approval" | "approved" | "executed" | "closed" | "rejected";
};

function queryPath(values: OperationalAnalyticsQuery) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
  }
  const suffix = params.toString();
  return `/api/v2/analytics/operational${suffix ? `?${suffix}` : ""}`;
}

export function useOperationalAnalytics(filters: OperationalAnalyticsQuery) {
  const { identity } = useDemoSettings();
  const signature = JSON.stringify(filters);
  return useQuery({
    queryKey: queryKeys.operationalAnalytics(identity.tenantId, identity.actorId, signature),
    queryFn: ({ signal }) => apiRequest<OperationalAnalyticsView>(queryPath(filters), { identity, signal }),
  });
}

export function useSolutionPackCatalog() {
  const { identity } = useDemoSettings();
  return useQuery({
    queryKey: queryKeys.solutionPackCatalog(identity.tenantId, identity.actorId),
    queryFn: ({ signal }) => apiRequest<SolutionPackCatalogView>("/api/v2/solution-packs", { identity, signal }),
  });
}

export function useInstalledSolutionPacks() {
  const { identity } = useDemoSettings();
  return useQuery({
    queryKey: queryKeys.solutionPacksInstalled(identity.tenantId, identity.actorId),
    queryFn: ({ signal }) => apiRequest<SolutionPackInstalledListView>("/api/v2/solution-packs/installed", { identity, signal }),
  });
}

export function useInternalWorkItems(status = "open") {
  const { identity } = useDemoSettings();
  return useQuery({
    queryKey: queryKeys.internalWorkItems(identity.tenantId, identity.actorId, status),
    queryFn: ({ signal }) => apiRequest<InternalWorkItemListView>(
      `/api/v2/internal-work-items?status=${encodeURIComponent(status)}`,
      { identity, signal },
    ),
  });
}

export function usePackWorkbench(contextId: string | undefined) {
  const { identity } = useDemoSettings();
  return useQuery({
    queryKey: queryKeys.packWorkbench(identity.tenantId, identity.actorId, contextId ?? ""),
    queryFn: ({ signal }) => apiRequest<PackWorkbenchView>(
      `/api/v2/contexts/${encodeURIComponent(contextId ?? "")}/pack-workbench`,
      { identity, signal },
    ),
    enabled: Boolean(contextId),
  });
}

export function useContextResolutionCases(contextId: string | undefined) {
  const { identity } = useDemoSettings();
  return useQuery({
    queryKey: queryKeys.contextResolutionCases(identity.tenantId, identity.actorId, contextId ?? ""),
    queryFn: ({ signal }) => apiRequest<ResolutionCaseListResponse>(
      `/api/v2/contexts/${encodeURIComponent(contextId ?? "")}/resolution-cases`,
      { identity, signal },
    ),
    enabled: Boolean(contextId),
  });
}
