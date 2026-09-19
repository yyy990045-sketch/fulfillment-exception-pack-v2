import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { apiRequest } from "../api/client.js";
import { useDemoSettings } from "../app/demo-settings.js";
import type {
  DecisionRecommendationListResponse,
  DecisionRecommendationView,
  CurrentActorContextResponseView,
  ExplanationListResponse,
  ExplanationResponse,
  RootCauseAnalysisListResponse,
  RootCauseAnalysisView,
  OutcomeEvaluationListResponse,
  PolicyEvaluationListResponse,
  PolicyEvaluationView,
  ResolutionCaseListResponse,
  ResolutionCapabilitiesResponseView,
  ResolutionCaseQueryView,
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

export function useAccountContext() {
  const { identity } = useDemoSettings();
  return useQuery({
    queryKey: queryKeys.accountContext(identity.tenantId, identity.actorId),
    queryFn: ({ signal }) => apiRequest<CurrentActorContextResponseView>(
      "/api/v2/auth/context",
      { identity, signal },
    ),
  });
}

export function useResolutionCapabilities(contextId: string, exceptionId: string | undefined) {
  const { identity } = useDemoSettings();
  return useQuery({
    queryKey: queryKeys.resolutionCapabilities(identity.tenantId, identity.actorId, contextId, exceptionId ?? ""),
    queryFn: ({ signal }) => apiRequest<ResolutionCapabilitiesResponseView>(
      `/api/v2/contexts/${encodeURIComponent(contextId)}/exceptions/${encodeURIComponent(exceptionId ?? "")}/resolution-capabilities`,
      { identity, signal },
    ),
    enabled: Boolean(contextId && exceptionId),
  });
}

export function usePolicyEvaluations(contextId: string, exceptionId: string | undefined) {
  const { identity } = useDemoSettings();
  return useQuery({
    queryKey: queryKeys.policyEvaluations(identity.tenantId, contextId, exceptionId ?? ""),
    queryFn: ({ signal }) => apiRequest<PolicyEvaluationListResponse>(
      `/api/v2/contexts/${encodeURIComponent(contextId)}/exceptions/${encodeURIComponent(exceptionId ?? "")}/policy-evaluations`,
      { identity, signal },
    ),
    enabled: Boolean(contextId && exceptionId),
  });
}

export function useResolutionProcess(contextId: string, exceptionId: string | undefined) {
  const { identity } = useDemoSettings();
  const list = useQuery({
    queryKey: queryKeys.resolutionList(identity.tenantId, contextId),
    queryFn: ({ signal }) => apiRequest<ResolutionCaseListResponse>(
      `/api/v2/contexts/${encodeURIComponent(contextId)}/resolution-cases`,
      { identity, signal },
    ),
    enabled: Boolean(contextId),
  });
  const summary = list.data?.resolutionCases?.find((item) => item.exceptionId === exceptionId);
  const detail = useQuery({
    queryKey: queryKeys.resolutionCase(identity.tenantId, summary?.id ?? ""),
    queryFn: ({ signal }) => apiRequest<ResolutionCaseQueryView>(
      `/api/v2/resolution-cases/${encodeURIComponent(summary!.id)}`,
      { identity, signal },
    ),
    enabled: Boolean(summary?.id),
  });
  return { list, summary, detail };
}

export function useOutcomeEvaluations(contextId: string, exceptionId: string | undefined) {
  const { identity } = useDemoSettings();
  return useQuery({
    queryKey: queryKeys.outcomeEvaluations(identity.tenantId, contextId, exceptionId ?? ""),
    queryFn: ({ signal }) => apiRequest<OutcomeEvaluationListResponse>(
      `/api/v2/contexts/${encodeURIComponent(contextId)}/exceptions/${encodeURIComponent(exceptionId ?? "")}/outcome-evaluations`,
      { identity, signal },
    ),
    enabled: Boolean(contextId && exceptionId),
  });
}

async function invalidateGovernanceQueries(
  queryClient: QueryClient,
  tenantId: string,
  actorId: string,
  contextId: string,
  exceptionId: string,
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.workbench(tenantId, contextId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.policyEvaluations(tenantId, contextId, exceptionId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.resolutionList(tenantId, contextId) }),
    queryClient.invalidateQueries({ queryKey: ["resolution-case", tenantId] }),
    queryClient.invalidateQueries({ queryKey: queryKeys.resolutionCapabilities(tenantId, actorId, contextId, exceptionId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.outcomeEvaluations(tenantId, contextId, exceptionId) }),
  ]);
}

function useGuardedMutation<TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
  onSuccess: () => Promise<void>,
) {
  const mutation = useMutation({ mutationFn, onSuccess });
  const inFlight = useRef(false);
  const run = useCallback(async (input: TInput) => {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    try {
      return await mutation.mutateAsync(input);
    } finally {
      inFlight.current = false;
    }
  }, [mutation]);
  return { mutation, run };
}

export function useGovernanceMutations(contextId: string, exceptionId: string) {
  const { identity } = useDemoSettings();
  const queryClient = useQueryClient();
  const invalidate = () => invalidateGovernanceQueries(queryClient, identity.tenantId, identity.actorId, contextId, exceptionId);
  const base = `/api/v2/contexts/${encodeURIComponent(contextId)}/exceptions/${encodeURIComponent(exceptionId)}`;

  const policy = useGuardedMutation(
    (input: { recommendationId: string; optionId: string }) => apiRequest<PolicyEvaluationView>(
      `${base}/policy-evaluations`,
      { identity, method: "POST", body: input },
    ),
    invalidate,
  );
  const accept = useGuardedMutation(
    (input: { ownerRole: string; rationale: string }) => apiRequest(
      `${base}/resolution-case`,
      { identity, method: "POST", body: input },
    ),
    invalidate,
  );
  const review = useGuardedMutation(
    (input: { caseId: string; decision: "confirm" | "needs_evidence" | "reject"; rationale: string }) => apiRequest(
      `/api/v2/resolution-cases/${encodeURIComponent(input.caseId)}/review`,
      { identity, method: "POST", body: { decision: input.decision, rationale: input.rationale } },
    ),
    invalidate,
  );
  const propose = useGuardedMutation(
    (input: { caseId: string; actions: Array<{ type: string; summary: string }> }) => apiRequest(
      `/api/v2/resolution-cases/${encodeURIComponent(input.caseId)}/propose`,
      { identity, method: "POST", body: { actions: input.actions } },
    ),
    invalidate,
  );
  const submit = useGuardedMutation(
    (input: { caseId: string }) => apiRequest(
      `/api/v2/resolution-cases/${encodeURIComponent(input.caseId)}/submit`,
      { identity, method: "POST", body: {} },
    ),
    invalidate,
  );
  const approve = useGuardedMutation(
    (input: { caseId: string }) => apiRequest(
      `/api/v2/resolution-cases/${encodeURIComponent(input.caseId)}/approve`,
      { identity, method: "POST", body: {} },
    ),
    invalidate,
  );
  const execute = useGuardedMutation(
    (input: { caseId: string }) => apiRequest(
      `/api/v2/resolution-cases/${encodeURIComponent(input.caseId)}/execute`,
      { identity, method: "POST", body: { idempotencyKey: `react-execute:${input.caseId}` } },
    ),
    invalidate,
  );
  const close = useGuardedMutation(
    (input: { caseId: string }) => apiRequest(
      `/api/v2/resolution-cases/${encodeURIComponent(input.caseId)}/close`,
      { identity, method: "POST", body: {} },
    ),
    invalidate,
  );

  return { policy, accept, review, propose, submit, approve, execute, close };
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
