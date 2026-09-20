import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../api/client.js";
import { useDemoSettings } from "../app/demo-settings.js";
import type { AnalyticsProviders, PowerBiEmbedConfig, SupersetGuestToken } from "../features/analytics/types.js";
import { queryKeys } from "./query-keys.js";

export function useAnalyticsProviders() {
  const { identity } = useDemoSettings();
  return useQuery({
    queryKey: queryKeys.analyticsProviders(identity.tenantId, identity.actorId),
    queryFn: ({ signal }) => apiRequest<AnalyticsProviders>("/api/v2/analytics/providers", { identity, signal }),
    retry: false,
    staleTime: 30_000,
  });
}

/** 按需向后端换取短生命周期 guest token；Superset SDK 会用同一个回调做续签 */
export function useSupersetGuestToken(enabled = true) {
  const { identity } = useDemoSettings();
  return useQuery({
    queryKey: queryKeys.supersetGuestToken(identity.tenantId, identity.actorId),
    queryFn: ({ signal }) => apiRequest<SupersetGuestToken>("/api/v2/analytics/superset/guest-token", { identity, signal }),
    enabled,
    retry: false,
    staleTime: 0,
  });
}

export function usePowerBiEmbedConfig() {
  const { identity } = useDemoSettings();
  return useQuery({
    queryKey: queryKeys.powerBiEmbedConfig(identity.tenantId, identity.actorId),
    queryFn: ({ signal }) => apiRequest<PowerBiEmbedConfig>(
      "/api/v2/analytics/powerbi/embed-config",
      { identity, signal },
    ),
    retry: false,
    staleTime: 0,
  });
}
