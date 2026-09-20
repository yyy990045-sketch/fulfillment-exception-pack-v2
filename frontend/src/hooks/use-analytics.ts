import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../api/client.js";
import { useDemoSettings } from "../app/demo-settings.js";
import type { PowerBiEmbedConfig } from "../features/analytics/types.js";
import { queryKeys } from "./query-keys.js";

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
