import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../api/client.js";
import { useDemoSettings } from "../app/demo-settings.js";
import type {
  DecisionRecommendationListResponse,
  DecisionRecommendationView,
  ExplanationListResponse,
  ExplanationResponse,
  RootCauseAnalysisListResponse,
  RootCauseAnalysisView,
} from "../features/manufacturing/analysis-types.js";
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

export function useGroundedExplanation(contextId: string, exceptionId: string | undefined) {
  const { identity } = useDemoSettings();
  const base = `/api/v2/contexts/${encodeURIComponent(contextId)}/exceptions/${encodeURIComponent(exceptionId ?? "")}`;
  const list = useQuery({
    queryKey: queryKeys.explanationList(identity.tenantId, contextId, exceptionId ?? ""),
    queryFn: ({ signal }) => apiRequest<ExplanationListResponse>(`${base}/explanations`, { identity, signal }),
    enabled: Boolean(contextId && exceptionId),
  });
  const latest = list.data?.explanations.at(-1);
  const detail = useQuery({
    queryKey: queryKeys.explanation(identity.tenantId, contextId, exceptionId ?? "", latest?.id ?? ""),
    queryFn: ({ signal }) => apiRequest<ExplanationResponse>(
      `${base}/explanations/${encodeURIComponent(latest!.id)}`,
      { identity, signal },
    ),
    enabled: Boolean(contextId && exceptionId && latest?.id),
  });
  return { list, latest, detail };
}

export function useRootCauseAnalysis(contextId: string, exceptionId: string | undefined) {
  const { identity } = useDemoSettings();
  const base = `/api/v2/contexts/${encodeURIComponent(contextId)}/exceptions/${encodeURIComponent(exceptionId ?? "")}`;
  const list = useQuery({
    queryKey: queryKeys.rootCauseList(identity.tenantId, contextId, exceptionId ?? ""),
    queryFn: ({ signal }) => apiRequest<RootCauseAnalysisListResponse>(`${base}/root-cause-analyses`, { identity, signal }),
    enabled: Boolean(contextId && exceptionId),
  });
  const latest = list.data?.analyses.at(-1);
  const detail = useQuery({
    queryKey: queryKeys.rootCause(identity.tenantId, contextId, exceptionId ?? "", latest?.id ?? ""),
    queryFn: ({ signal }) => apiRequest<RootCauseAnalysisView>(
      `${base}/root-cause-analyses/${encodeURIComponent(latest!.id)}`,
      { identity, signal },
    ),
    enabled: Boolean(contextId && exceptionId && latest?.id),
  });
  return { list, latest, detail };
}

export function useDecisionRecommendation(contextId: string, exceptionId: string | undefined) {
  const { identity } = useDemoSettings();
  const base = `/api/v2/contexts/${encodeURIComponent(contextId)}/exceptions/${encodeURIComponent(exceptionId ?? "")}`;
  const list = useQuery({
    queryKey: queryKeys.decisionList(identity.tenantId, contextId, exceptionId ?? ""),
    queryFn: ({ signal }) => apiRequest<DecisionRecommendationListResponse>(`${base}/decision-recommendations`, { identity, signal }),
    enabled: Boolean(contextId && exceptionId),
  });
  const latest = list.data?.recommendations.at(-1);
  const detail = useQuery({
    queryKey: queryKeys.decision(identity.tenantId, contextId, exceptionId ?? "", latest?.id ?? ""),
    queryFn: ({ signal }) => apiRequest<DecisionRecommendationView>(
      `${base}/decision-recommendations/${encodeURIComponent(latest!.id)}`,
      { identity, signal },
    ),
    enabled: Boolean(contextId && exceptionId && latest?.id),
  });
  return { list, latest, detail };
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
