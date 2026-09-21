import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../api/client.js";
import { useDemoSettings } from "../app/demo-settings.js";
import type { JudgeManifestView } from "../features/judge/types.js";
import { queryKeys } from "./query-keys.js";

/**
 * 评委视图数据源：现有接口的只读聚合（`/api/v2/demo/judge/manifest`）。
 * contextId 为空时由后端挑默认 Context（优先带生产缺口异常的那条）。
 */
export function useJudgeManifest(contextId?: string) {
  const { identity } = useDemoSettings();
  const query = contextId ? `?contextId=${encodeURIComponent(contextId)}` : "";
  return useQuery({
    queryKey: queryKeys.judgeManifest(identity.tenantId, contextId ?? "auto"),
    queryFn: ({ signal }) => apiRequest<JudgeManifestView>(
      `/api/v2/demo/judge/manifest${query}`,
      { identity, signal },
    ),
  });
}
