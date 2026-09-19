import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../api/client.js";
import { useDemoSettings } from "../app/demo-settings.js";
import type { EvidenceBundleView, WorkbenchView } from "../features/manufacturing/types.js";
import { queryKeys } from "./query-keys.js";

export function useWorkbenchView(contextId: string) {
  const { identity } = useDemoSettings();
  return useQuery({
    queryKey: queryKeys.workbench(identity.tenantId, contextId),
    queryFn: ({ signal }) => apiRequest<WorkbenchView>(
      `/api/v2/contexts/${encodeURIComponent(contextId)}/workbench`,
      { identity, signal },
    ),
    enabled: Boolean(contextId),
  });
}

export function useExceptionEvidence(contextId: string, exceptionId: string | undefined) {
  const { identity } = useDemoSettings();
  return useQuery({
    queryKey: queryKeys.exceptionEvidence(identity.tenantId, contextId, exceptionId ?? ""),
    queryFn: ({ signal }) => apiRequest<EvidenceBundleView>(
      `/api/v2/contexts/${encodeURIComponent(contextId)}/exceptions/${encodeURIComponent(exceptionId!)}/bundle`,
      { identity, signal },
    ),
    enabled: Boolean(contextId && exceptionId),
  });
}
