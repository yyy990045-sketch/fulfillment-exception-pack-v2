/**
 * Superset 嵌入式看板。
 *
 * 官方要求（docs/docs/using-superset/embedding.mdx）：guest token 必须由宿主后端调用
 * Superset 换取，浏览器侧只能通过 fetchGuestToken 回调取得短生命周期 token。
 * 因此这里不接触任何 Superset 账号、密钥；SDK 在 token 过期时会再次回调本函数续签。
 */
import { embedDashboard } from "@superset-ui/embedded-sdk";
import { useEffect, useRef, useState } from "react";
import { apiRequest, type ApiIdentity } from "../../../api/client.js";
import { useDemoSettings } from "../../../app/demo-settings.js";
import type { SupersetGuestToken } from "../types.js";

export function SupersetReport({
  dashboardId,
  supersetDomain,
}: {
  dashboardId: string;
  supersetDomain: string;
}) {
  const { identity } = useDemoSettings();
  const mountRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "rendered" | "error">("loading");

  useEffect(() => {
    const mountPoint = mountRef.current;
    if (!mountPoint) return;
    let cancelled = false;
    mountPoint.innerHTML = "";
    setState("loading");

    const identityRef: ApiIdentity = { tenantId: identity.tenantId, actorId: identity.actorId };
    embedDashboard({
      id: dashboardId,
      supersetDomain,
      mountPoint,
      fetchGuestToken: async () => {
        const token = await apiRequest<SupersetGuestToken>(
          "/api/v2/analytics/superset/guest-token",
          { identity: identityRef },
        );
        return token.guestToken;
      },
      dashboardUiConfig: { hideTitle: true, filters: { expanded: false } },
    })
      .then(() => {
        if (!cancelled) setState("rendered");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });

    return () => {
      cancelled = true;
      mountPoint.innerHTML = "";
    };
  }, [dashboardId, supersetDomain, identity.tenantId, identity.actorId]);

  return (
    <div className="relative h-full min-h-[420px] w-full" data-testid="superset-dashboard">
      <div ref={mountRef} className="h-full w-full [&>iframe]:h-full [&>iframe]:w-full [&>iframe]:border-0" />
      {state === "loading" && (
        <div className="absolute inset-0 grid place-items-center bg-surface text-[12px] text-text-muted">
          正在加载分析看板…
        </div>
      )}
      {state === "error" && (
        <div className="absolute inset-0 grid place-items-center bg-surface">
          <div className="text-center">
            <p className="text-[13px] font-medium text-text-primary">分析看板暂时无法加载</p>
            <p className="mt-1 text-[12px] text-text-muted">请稍后重试，或联系管理员检查分析服务配置。</p>
          </div>
        </div>
      )}
    </div>
  );
}
