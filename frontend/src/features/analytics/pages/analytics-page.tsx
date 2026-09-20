import { AlertCircle, Expand, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../../../api/client.js";
import {
  LocalState,
  ProductHeader,
  ProductPage,
  ProductSection,
} from "../../../components/product/page-layout.js";
import { Button } from "../../../components/ui/button.js";
import { Skeleton } from "../../../components/ui/skeleton.js";
import { useAnalyticsProviders, usePowerBiEmbedConfig } from "../../../hooks/use-analytics.js";
import { cn } from "../../../lib/utils.js";
import { PowerBiReport } from "../components/powerbi-report.js";
import { SupersetReport } from "../components/superset-report.js";

function errorCode(error: unknown) {
  return error instanceof ApiError ? error.code : "POWERBI_UPSTREAM_FAILURE";
}

function NotConfiguredState() {
  return (
    <div className="grid min-h-[360px] place-items-center rounded-xl border border-dashed border-border-strong bg-surface px-6 py-10">
      <div className="max-w-xl text-center">
        <AlertCircle className="mx-auto size-6 text-text-muted" aria-hidden="true" />
        <h2 className="mt-3 text-base font-semibold text-text-primary">分析服务尚未配置</h2>
        <p className="mt-1 text-[13px] text-text-muted">管理员完成以下配置后，经营分析会在这里显示真实看板。</p>
        <ul className="mx-auto mt-4 max-w-md space-y-1.5 text-left text-xs text-text-secondary">
          <li>自托管 Superset 与嵌入式看板（当前推荐）</li>
          <li>或 Microsoft Entra 应用与 Power BI 工作区权限</li>
          <li>后端对应的嵌入环境变量</li>
        </ul>
      </div>
    </div>
  );
}

/** 刷新 / 全屏控件：两个 provider 共用同一套页面骨架 */
function AnalyticsShell({
  onRefresh,
  refreshing,
  fullscreen,
  onToggleFullscreen,
  children,
}: {
  onRefresh: () => void;
  refreshing: boolean;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  children: ReactNode;
}) {
  return (
    <ProductPage className="flex h-[calc(100dvh-56px)] max-w-none flex-col gap-3 py-4">
      <ProductHeader
        title="经营分析"
        description="集中查看履约风险、治理效率与业务结果。"
        actions={(
          <>
            <Button variant="outline" size="sm" disabled={refreshing} onClick={onRefresh}>
              <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} aria-hidden="true" />
              刷新
            </Button>
            <Button variant="outline" size="sm" onClick={onToggleFullscreen}>
              <Expand className="size-3.5" aria-hidden="true" />
              {fullscreen ? "退出全屏" : "全屏"}
            </Button>
          </>
        )}
      />
      <ProductSection className="min-h-0 flex-1">
        {children}
      </ProductSection>
    </ProductPage>
  );
}

function useFullscreen() {
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  return { fullscreen, setFullscreen };
}

/** Superset 分支：guest token 由后端签发，SDK 负责在过期前自动续签 */
function SupersetAnalytics({ dashboardId, supersetDomain }: { dashboardId: string; supersetDomain: string }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const reportRef = useRef<HTMLDivElement>(null);
  const { fullscreen, setFullscreen } = useFullscreen();

  const requestFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await reportRef.current?.requestFullscreen();
  };

  return (
    <AnalyticsShell
      onRefresh={() => setRefreshKey((value) => value + 1)}
      refreshing={false}
      fullscreen={fullscreen}
      onToggleFullscreen={() => void requestFullscreen()}
    >
      <div className="h-full min-h-[420px]" ref={reportRef}>
        <SupersetReport key={refreshKey} dashboardId={dashboardId} supersetDomain={supersetDomain} />
      </div>
    </AnalyticsShell>
  );
}

/** Power BI 分支：保留现有实现，但不作为当前默认 provider */
function PowerBiAnalytics() {
  const query = usePowerBiEmbedConfig();
  const reportRef = useRef<HTMLDivElement>(null);
  const { fullscreen, setFullscreen } = useFullscreen();

  useEffect(() => {
    const expiration = query.data?.expiresAt ? Date.parse(query.data.expiresAt) : Number.NaN;
    if (!Number.isFinite(expiration)) return;
    const delay = Math.max(30_000, expiration - Date.now() - 60_000);
    const timer = window.setTimeout(() => void query.refetch(), delay);
    return () => window.clearTimeout(timer);
  }, [query.data?.expiresAt, query.refetch]);

  const requestFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await reportRef.current?.requestFullscreen();
  };

  return (
    <AnalyticsShell
      onRefresh={() => void query.refetch()}
      refreshing={query.isFetching}
      fullscreen={fullscreen}
      onToggleFullscreen={() => void requestFullscreen()}
    >
      <div className="h-full min-h-[420px]" ref={reportRef}>
        {query.isLoading ? (
          <div className="grid h-full grid-rows-[48px_1fr] gap-3 p-4" data-testid="analytics-loading">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-full min-h-[360px] w-full" />
          </div>
        ) : query.isError && errorCode(query.error) === "POWERBI_NOT_CONFIGURED" ? (
          <NotConfiguredState />
        ) : query.isError ? (
          <div className="grid h-full min-h-[420px] place-items-center p-6">
            <LocalState
              kind="error"
              title="分析报告加载失败"
              detail="无法获取 Power BI Embed 配置，请稍后重试。"
            />
            <details className="mt-3 text-xs text-text-muted">
              <summary className="cursor-pointer">查看技术信息</summary>
              <code className="mt-2 block rounded bg-surface-muted px-2 py-1">{errorCode(query.error)}</code>
            </details>
          </div>
        ) : query.data ? (
          <PowerBiReport embedConfig={query.data} onTokenRefresh={() => void query.refetch()} />
        ) : (
          <div className="grid h-full min-h-[420px] place-items-center">
            <LocalState kind="empty" title="暂无经营分析数据" />
          </div>
        )}
      </div>
    </AnalyticsShell>
  );
}

export function AnalyticsPage() {
  const providers = useAnalyticsProviders();
  const provider = providers.data?.defaultProvider ?? null;
  const superset = providers.data?.providers.superset;

  if (providers.isLoading) {
    return (
      <AnalyticsShell onRefresh={() => void providers.refetch()} refreshing fullscreen={false} onToggleFullscreen={() => undefined}>
        <div className="grid h-full grid-rows-[48px_1fr] gap-3 p-4" data-testid="analytics-loading">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-full min-h-[360px] w-full" />
        </div>
      </AnalyticsShell>
    );
  }

  if (provider === "superset" && superset?.dashboardId && superset.supersetDomain) {
    return <SupersetAnalytics dashboardId={superset.dashboardId} supersetDomain={superset.supersetDomain} />;
  }

  if (provider === "powerbi") {
    return <PowerBiAnalytics />;
  }

  if (providers.isError) {
    return (
      <AnalyticsShell onRefresh={() => void providers.refetch()} refreshing={providers.isFetching} fullscreen={false} onToggleFullscreen={() => undefined}>
        <div className="grid h-full min-h-[420px] place-items-center p-6">
          <LocalState kind="error" title="分析服务状态读取失败" detail="请稍后重试。" />
        </div>
      </AnalyticsShell>
    );
  }

  return (
    <AnalyticsShell onRefresh={() => void providers.refetch()} refreshing={providers.isFetching} fullscreen={false} onToggleFullscreen={() => undefined}>
      <NotConfiguredState />
    </AnalyticsShell>
  );
}
