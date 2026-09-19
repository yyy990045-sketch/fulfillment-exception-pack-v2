import { AlertCircle, ChevronRight, ExternalLink } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Badge } from "../../../components/ui/badge.js";
import { Skeleton } from "../../../components/ui/skeleton.js";
import { useInstalledSolutionPacks, useOperationalAnalytics, usePackWorkbench } from "../../../hooks/use-operations.js";
import { cn } from "../../../lib/utils.js";
import { contextTypeLabel, formatBusinessValue, formatShortDateTime } from "../../manufacturing/utils.js";
import type { OperationalContextView, SolutionPackManifestView } from "../../operations/types.js";

const contextStatusLabels: Record<string, string> = {
  active: "进行中",
  closed: "已关闭",
  archived: "已归档",
};

function capabilityLabel(key: string) {
  return {
    rules: "规则能力",
    outcomes: "结果测量",
    presentation: "业务线程",
    decisionEligibility: "决策资格",
    demo: "示例数据",
  }[key] ?? key;
}

function contextLink(context: OperationalContextView) {
  return context.contextType === "sales_order"
    ? `/manufacturing/${encodeURIComponent(context.contextId)}`
    : `/workspace/${encodeURIComponent(context.contextId)}`;
}

function statusList(statuses: string[]) {
  const labels: Record<string, string> = {
    no_case: "未进入治理",
    triaged: "待复核",
    confirmed: "已确认",
    proposed_draft: "方案草案",
    pending_approval: "待审批",
    approved: "已批准",
    executed: "已执行",
    closed: "已结案",
    rejected: "已拒绝",
  };
  return statuses.length ? statuses.map((status) => labels[status] ?? status).join("、") : "未进入治理";
}

function PackList({
  packs,
  selectedPackId,
  onSelect,
}: {
  packs: Array<{ manifest: SolutionPackManifestView; installation: { status: string; packVersion: string } }>;
  selectedPackId?: string;
  onSelect: (packId: string) => void;
}) {
  return (
    <aside className="border-b border-border bg-surface lg:border-b-0 lg:border-r">
      <div className="border-b border-border px-3 py-3">
        <h2 className="text-sm font-semibold">已安装方案包</h2>
        <p className="mt-0.5 text-[11px] text-text-muted">当前企业真实安装的解决方案。</p>
      </div>
      <div role="list">
        {packs.map(({ manifest, installation }) => {
          const active = manifest.id === selectedPackId;
          return (
            <button
              key={manifest.id}
              type="button"
              aria-current={active ? "true" : undefined}
              className={cn(
                "w-full border-b border-l-2 border-l-transparent border-border px-3 py-3 text-left hover:bg-surface-muted",
                active && "border-l-interactive bg-interactive/5",
              )}
              onClick={() => onSelect(manifest.id)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{manifest.name}</span>
                <Badge variant={installation.status === "active" ? "success" : "default"}>
                  {installation.status === "active" ? "已启用" : "已停用"}
                </Badge>
              </div>
              <div className="mt-1 text-xs text-text-secondary">{manifest.description}</div>
              <div className="mt-2 flex items-center gap-2 text-[11px] text-text-muted">
                <span>{manifest.contextTypes.map(contextTypeLabel).join("、")}</span>
                <span aria-hidden="true">·</span>
                <span>v{installation.packVersion}</span>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

export function SolutionPackPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const packs = useInstalledSolutionPacks();
  const analytics = useOperationalAnalytics({});
  const selectedPackId = searchParams.get("pack") ?? packs.data?.installations[0]?.manifest.id;
  const selectedPack = packs.data?.installations.find((item) => item.manifest.id === selectedPackId);
  const contextTypeSet = new Set(selectedPack?.manifest.contextTypes ?? []);
  const contexts = (analytics.data?.contexts ?? []).filter((context) => contextTypeSet.has(context.contextType));
  const requestedContextId = searchParams.get("context") ?? undefined;
  const queryContext = contexts.find((item) => item.contextId === requestedContextId) ?? contexts[0];
  const workbench = usePackWorkbench(queryContext?.contextId);

  const selectPack = (packId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("pack", packId);
    next.delete("context");
    setSearchParams(next, { replace: true });
  };
  const selectContext = (contextId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("context", contextId);
    setSearchParams(next, { replace: true });
  };

  if (packs.isLoading || analytics.isLoading) {
    return (
      <main className="mx-auto w-full max-w-[1720px] space-y-3 px-5 py-5">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-[520px] w-full" />
      </main>
    );
  }
  if (packs.isError || analytics.isError || !packs.data || !analytics.data) {
    return <main className="mx-auto w-full max-w-[1720px] px-5 py-5 text-sm text-danger">方案包信息加载失败。</main>;
  }
  const installed = packs.data.installations;
  if (!installed.length) {
    return (
      <main className="mx-auto w-full max-w-[1720px] px-5 py-5">
        <h1 className="text-xl font-semibold">方案包</h1>
        <p className="mt-3 text-sm text-text-muted">当前企业尚未安装方案包。</p>
      </main>
    );
  }

  const manifest = selectedPack?.manifest;
  const packContexts = manifest
    ? analytics.data.contexts.filter((context) => manifest.contextTypes.includes(context.contextType))
    : [];
  const activeContext = packContexts.find((item) => item.contextId === requestedContextId) ?? packContexts[0];
  const activeWorkbench = workbench.data;
  const installationStatus = selectedPack?.installation.status === "active" ? "已启用" : "已停用";

  return (
    <main className="mx-auto w-full max-w-[1720px] px-5 py-4">
      <header className="border-b border-border pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">方案包</h1>
            <p className="mt-1 text-sm text-text-secondary">查看当前企业已安装的业务解决方案与可复用平台能力。</p>
          </div>
          {manifest && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="info">{manifest.name}</Badge>
              <Badge>{manifest.contextTypes.map(contextTypeLabel).join("、")}</Badge>
              <Badge>v{selectedPack?.installation.packVersion}</Badge>
              <Badge variant={selectedPack?.installation.status === "active" ? "success" : "default"}>{installationStatus}</Badge>
            </div>
          )}
        </div>
      </header>

      <div className="mt-4 grid border border-border bg-surface lg:grid-cols-[280px_minmax(0,1fr)]">
        <PackList packs={installed} selectedPackId={manifest?.id} onSelect={selectPack} />
        {!manifest || !selectedPack ? (
          <div className="p-8 text-sm text-text-muted">请选择一个已安装方案包。</div>
        ) : (
          <section className="min-w-0">
            <div className="border-b border-border px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">{manifest.name}</h2>
                  <p className="mt-1 max-w-[78ch] text-sm text-text-secondary">{manifest.description}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(manifest.capabilities).filter(([, enabled]) => enabled).map(([key]) => (
                    <Badge key={key} variant="info">{capabilityLabel(key)}</Badge>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid xl:grid-cols-[280px_minmax(0,1fr)]">
              <div className="border-b border-border xl:border-b-0 xl:border-r">
                <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
                  <h3 className="text-sm font-semibold">业务上下文</h3>
                  <span className="text-xs text-text-muted">{packContexts.length}</span>
                </div>
                {packContexts.length ? (
                  <div role="list">
                    {packContexts.map((context) => (
                      <button
                        key={context.contextId}
                        type="button"
                        aria-current={activeContext?.contextId === context.contextId ? "true" : undefined}
                        className={cn(
                          "w-full border-b border-l-2 border-l-transparent border-border px-3 py-2.5 text-left hover:bg-surface-muted",
                          activeContext?.contextId === context.contextId && "border-l-interactive bg-interactive/5",
                        )}
                        onClick={() => selectContext(context.contextId)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{context.businessKey}</span>
                          <ChevronRight className="size-3.5 text-text-muted" aria-hidden="true" />
                        </div>
                        <div className="mt-1 text-xs text-text-muted">
                          {context.exceptionCount} 异常 · {statusList(context.resolutionStatuses)}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 text-xs text-text-muted">该方案包暂无已绑定业务上下文。</div>
                )}
              </div>

              <div className="min-w-0">
                {workbench.isPending && queryContext ? (
                  <div className="space-y-3 p-4">
                    <Skeleton className="h-14 w-full" />
                    <Skeleton className="h-28 w-full" />
                    <Skeleton className="h-48 w-full" />
                  </div>
                ) : workbench.isError ? (
                  <div className="flex gap-3 p-5 text-sm text-danger">
                    <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    当前业务上下文加载失败。
                  </div>
                ) : activeWorkbench && activeContext ? (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-semibold">{activeWorkbench.context.businessKey}</h3>
                          <Badge>{activeWorkbench.pack.contextLabel}</Badge>
                          <Badge variant={activeWorkbench.context.status === "active" ? "info" : "default"}>
                            {contextStatusLabels[activeWorkbench.context.status] ?? activeWorkbench.context.status}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-text-muted">
                          {activeWorkbench.stats.entities} 个业务对象 · {activeWorkbench.stats.evidence} 条证据 · {activeWorkbench.stats.exceptions} 个异常
                        </p>
                      </div>
                      <Link
                        to={contextLink(activeContext)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-interactive hover:underline"
                      >
                        打开业务工作台
                        <ExternalLink className="size-3.5" aria-hidden="true" />
                      </Link>
                    </div>

                    <div className="border-b border-border px-4 py-3">
                      <h3 className="text-xs font-semibold text-text-muted">业务线程</h3>
                      <div className="mt-2 overflow-x-auto">
                        <div className="grid min-w-[760px] grid-cols-8 border-y border-border">
                          {activeWorkbench.thread.map((stage) => (
                            <div
                              key={stage.key}
                              className={cn(
                                "min-w-0 border-r border-border px-2.5 py-2 last:border-r-0",
                                stage.state === "exception" && "bg-warning/5",
                              )}
                            >
                              <div className="truncate text-xs font-medium">{stage.label}</div>
                              <div className="mt-0.5 truncate text-[11px] text-text-muted">{stage.businessKey}</div>
                              <div className="mt-1.5 space-y-0.5">
                                {stage.facts.slice(0, 2).map((fact) => (
                                  <div key={fact.key} className="truncate text-[11px]">
                                    {fact.label} <strong>{formatBusinessValue(fact)}</strong>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="grid xl:grid-cols-2">
                      <section className="border-b border-border xl:border-b-0 xl:border-r">
                        <div className="border-b border-border px-4 py-2.5">
                          <h3 className="text-sm font-semibold">异常类型</h3>
                        </div>
                        <div className="divide-y divide-border">
                          {activeWorkbench.exceptions.map((exception) => (
                            <div key={exception.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
                              <div>
                                <div className="font-medium">{exception.label}</div>
                                <div className="mt-0.5 text-xs text-text-muted">{exception.title}</div>
                              </div>
                              <Badge variant={exception.severity === "high" || exception.severity === "critical" ? "danger" : "warning"}>
                                {exception.severity}
                              </Badge>
                            </div>
                          ))}
                          {!activeWorkbench.exceptions.length && <div className="px-4 py-6 text-xs text-text-muted">暂无异常。</div>}
                        </div>
                      </section>
                      <section>
                        <div className="border-b border-border px-4 py-2.5">
                          <h3 className="text-sm font-semibold">规则能力</h3>
                        </div>
                        <div className="divide-y divide-border">
                          {activeWorkbench.rules.map((rule) => (
                            <div key={rule.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                              <span>{rule.label}</span>
                              <Badge variant={rule.matched ? "warning" : "success"}>{rule.matched ? "命中" : "未命中"}</Badge>
                            </div>
                          ))}
                          {!activeWorkbench.rules.length && <div className="px-4 py-6 text-xs text-text-muted">暂无规则评估。</div>}
                        </div>
                      </section>
                    </div>
                  </>
                ) : (
                  <div className="flex min-h-64 items-center justify-center p-8 text-sm text-text-muted">
                    当前方案包没有可展示的业务上下文。
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
