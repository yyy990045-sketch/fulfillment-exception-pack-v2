import { ChevronRight, RefreshCw, Search, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  LocalState,
  ProductHeader,
  ProductPage,
  ProductSection,
  SectionHeader,
  SummaryItem,
  SummaryStrip,
} from "../../../components/product/page-layout.js";
import {
  OutcomeStatusBadge,
  ResolutionStatusBadge,
  SeverityBadge,
} from "../../../components/product/status-badge.js";
import { Button } from "../../../components/ui/button.js";
import { Tabs, TabsList, TabsTrigger } from "../../../components/ui/tabs.js";
import { useInstalledSolutionPacks, useInternalWorkItems, useOperationalAnalytics, type OperationalAnalyticsQuery } from "../../../hooks/use-operations.js";
import { cn } from "../../../lib/utils.js";
import {
  resolutionStatusLabel,
  resolutionStatusTone,
  severityLabel,
  severityTone,
  type StatusTone,
} from "../../../lib/presentation.js";
import type { OperationalContextView } from "../types.js";
import {
  actionTypeLabel,
  contextTypeLabel,
  exceptionStatusLabel,
  formatShortDateTime,
  sourceSystemLabel,
} from "../../manufacturing/utils.js";

const bucketLabels: Record<string, string> = {
  day: "按日",
  week: "按周",
  month: "按月",
};

function formatRate(value: number | null) {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function contextDestination(context: OperationalContextView) {
  return context.contextType === "sales_order"
    ? `/manufacturing/${encodeURIComponent(context.contextId)}`
    : `/workspace/${encodeURIComponent(context.contextId)}`;
}

function MiniBar({
  label,
  value,
  max,
  tone = "interactive",
  onClick,
}: {
  label: string;
  value: number;
  max: number;
  tone?: StatusTone | "interactive";
  onClick?: () => void;
}) {
  const width = max > 0 ? Math.max(3, Math.round((value / max) * 100)) : 0;
  const toneClass = {
    default: "bg-text-muted/45",
    info: "bg-interactive/70",
    interactive: "bg-interactive/70",
    warning: "bg-warning/70",
    danger: "bg-danger/70",
    success: "bg-success/70",
  }[tone];
  return (
    <button
      type="button"
      className="grid w-full grid-cols-[minmax(0,1fr)_42px] items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors hover:bg-interactive/5 focus-visible:bg-interactive/5"
      onClick={onClick}
    >
      <span className="min-w-0">
        <span className="block truncate">{label}</span>
        <span className="mt-1 block h-1.5 bg-border">
          <span className={cn("block h-full", toneClass)} style={{ width: `${width}%` }} />
        </span>
      </span>
      <strong className="text-right font-semibold tabular-nums">{value}</strong>
    </button>
  );
}

function PortfolioTable({
  contexts,
  query,
  onOpenContext,
}: {
  contexts: OperationalContextView[];
  query: string;
  onOpenContext: (context: OperationalContextView) => void;
}) {
  const normalized = query.trim().toLowerCase();
  const rows = contexts.filter((context) =>
    !normalized ||
    context.businessKey.toLowerCase().includes(normalized) ||
    contextTypeLabel(context.contextType).toLowerCase().includes(normalized) ||
    context.exceptionCodes.some((code) => code.toLowerCase().includes(normalized)),
  );
  if (!rows.length) {
    return <div className="p-3"><LocalState kind="no-results" title="没有匹配当前条件的业务上下文" compact /></div>;
  }
  return (
    <div className="max-h-[560px] overflow-auto">
      <table data-testid="operations-portfolio-table" className="w-full min-w-[1040px] border-collapse text-left text-xs">
        <thead className="sticky top-0 z-10 bg-surface-muted text-text-muted">
          <tr>
            <th className="sticky left-0 z-20 border-b border-border bg-surface-muted px-3 py-2 font-medium">业务上下文</th>
            <th className="border-b border-border px-3 py-2 font-medium">异常</th>
            <th className="border-b border-border px-3 py-2 font-medium">等级</th>
            <th className="border-b border-border px-3 py-2 font-medium">治理状态</th>
            <th className="border-b border-border px-3 py-2 font-medium">负责人</th>
            <th className="border-b border-border px-3 py-2 font-medium">最近变化</th>
            <th className="border-b border-border px-3 py-2 font-medium">结果</th>
            <th className="border-b border-border px-3 py-2 font-medium text-text-muted">类型</th>
            <th className="border-b border-border px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((context) => (
            <tr key={context.contextId} className="group h-[50px] transition-colors duration-150 hover:bg-surface-subtle focus-within:bg-interactive/[0.035]">
              <td className="sticky left-0 z-10 bg-surface px-3.5 py-3 transition-colors group-hover:bg-surface-subtle group-focus-within:bg-interactive/[0.035]">
                <button
                  type="button"
                  className="text-[13px] font-semibold text-text-primary hover:text-interactive hover:underline focus-visible:rounded-sm"
                  onClick={() => onOpenContext(context)}
                >
                  {context.businessKey}
                </button>
              </td>
              <td className="px-3.5 py-3">
                <span className="font-semibold tabular-nums">{context.exceptionCount}</span>
                <span className="ml-1 text-text-muted">{context.exceptionCodes.length} 类</span>
              </td>
              <td className="px-3.5 py-3">
                {context.highestSeverity ? <SeverityBadge severity={context.highestSeverity} /> : <span className="text-text-muted">—</span>}
              </td>
              <td className="px-3.5 py-3">
                <div className="flex max-w-[240px] flex-wrap gap-1">
                  {context.resolutionStatuses.length
                    ? context.resolutionStatuses.slice(0, 2).map((status) => <ResolutionStatusBadge key={status} status={status} />)
                    : <ResolutionStatusBadge status="no_case" />}
                  {context.resolutionStatuses.length > 2 && (
                    <span className="self-center text-[10px] text-text-muted">+{context.resolutionStatuses.length - 2}</span>
                  )}
                </div>
              </td>
              <td className="max-w-[150px] truncate px-3.5 py-3">{context.resolutionOwnerRoles.join("、") || "未指派"}</td>
              <td className="px-3.5 py-3 text-text-muted tabular-nums">{formatShortDateTime(context.latestChangeAt)}</td>
              <td className="px-3.5 py-3">
                {context.outcomeMeasurementCount ? (
                  <div className="flex max-w-[170px] flex-wrap items-center gap-1">
                    <span className="font-medium tabular-nums">{context.outcomeMeasurementCount} 次</span>
                    {context.outcomeStatuses.slice(0, 2).map((status) => <OutcomeStatusBadge key={status} status={status} />)}
                  </div>
                ) : "暂无测量"}
              </td>
              <td className="px-3.5 py-3 text-text-muted">{contextTypeLabel(context.contextType)}</td>
              <td className="px-3.5 py-3 text-right"><ChevronRight className="ml-auto size-4 text-text-muted" aria-hidden="true" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OperationsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") ?? "exceptions";
  const query = searchParams.get("q") ?? "";
  const severity = searchParams.get("severity") ?? "";
  const exceptionCode = searchParams.get("exceptionCode") ?? "";
  const resolutionStatus = searchParams.get("resolutionStatus") ?? "";
  const bucket = (searchParams.get("bucket") ?? "month") as "day" | "week" | "month";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const filters: OperationalAnalyticsQuery = {
    bucket,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(severity ? { severity: severity as OperationalAnalyticsQuery["severity"] } : {}),
    ...(exceptionCode ? { exceptionCode } : {}),
    ...(resolutionStatus ? { resolutionStatus: resolutionStatus as OperationalAnalyticsQuery["resolutionStatus"] } : {}),
  };
  const analytics = useOperationalAnalytics(filters);
  const packs = useInstalledSolutionPacks();
  const workItems = useInternalWorkItems();

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };
  const clearAllFilters = () => {
    const next = new URLSearchParams(searchParams);
    for (const key of ["q", "severity", "exceptionCode", "resolutionStatus", "from", "to"]) next.delete(key);
    setSearchParams(next, { replace: true });
  };
  const applyRange = (nextFrom: string, nextTo: string) => {
    const next = new URLSearchParams(searchParams);
    if (nextFrom) next.set("from", nextFrom);
    else next.delete("from");
    if (nextTo) next.set("to", nextTo);
    else next.delete("to");
    setSearchParams(next, { replace: true });
  };
  const drillTrendBucket = (bucketKey: string) => {
    const start = new Date(bucketKey);
    if (Number.isNaN(start.getTime())) return;
    const end = new Date(start);
    if (bucket === "day") end.setUTCDate(end.getUTCDate());
    if (bucket === "week") end.setUTCDate(end.getUTCDate() + 6);
    if (bucket === "month") end.setUTCMonth(end.getUTCMonth() + 1, 0);
    applyRange(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10));
  };

  if (analytics.isLoading) {
    return (
      <ProductPage className="space-y-3 py-5">
        <LocalState kind="loading" title="正在读取运营视图" />
        <div className="h-72 border border-border bg-surface" />
      </ProductPage>
    );
  }
  if (analytics.isError || !analytics.data) {
    return (
      <ProductPage className="py-5">
        <ProductHeader title="运营视图" description="跨业务上下文查看异常、治理进度和后续结果。" />
        <div className="mt-4">
          <LocalState kind="error" title="运营视图加载失败" detail="当前 API 无法返回经营治理分析。" />
        </div>
      </ProductPage>
    );
  }

  const data = analytics.data;
  const maxTrend = Math.max(0, ...data.exceptionTrend.map((item) => item.exceptionCount));
  const maxException = Math.max(0, ...data.exceptionBreakdown.map((item) => item.count));
  const maxFunnel = Math.max(0, ...Object.values(data.resolutionFunnel));
  const openWorkItems = workItems.data?.workItems ?? [];
  const workItemsUnavailable = workItems.isPending || workItems.isError;
  const taskCount = workItemsUnavailable ? "—" : openWorkItems.filter((item) => item.kind === "task").length;
  const evidenceRequestCount = workItemsUnavailable ? "—" : openWorkItems.filter((item) => item.kind === "evidence_request").length;
  const exceptionLabels = new Map(data.exceptionBreakdown.map((item) => [item.code, item.label]));
  const activeFilters = [
    query ? { key: "q", label: `搜索：${query}` } : null,
    exceptionCode ? { key: "exceptionCode", label: `异常：${exceptionLabels.get(exceptionCode) ?? exceptionCode}` } : null,
    severity ? { key: "severity", label: `等级：${severityLabel(severity)}` } : null,
    resolutionStatus ? { key: "resolutionStatus", label: `治理：${resolutionStatusLabel(resolutionStatus)}` } : null,
    from ? { key: "from", label: `开始：${from}` } : null,
    to ? { key: "to", label: `结束：${to}` } : null,
  ].filter((item): item is { key: string; label: string } => Boolean(item));

  return (
    <ProductPage>
      <ProductHeader
        title="运营视图"
        description="跨业务上下文查看异常、治理进度和后续结果。"
        actions={(
          <>
            <label className="space-y-1 text-[11px] text-text-muted">
              时间粒度
              <select className="block h-9 rounded-md border border-border-strong bg-surface px-2.5 text-[12px]" value={bucket} onChange={(event) => updateParam("bucket", event.target.value)}>
                <option value="day">日</option>
                <option value="week">周</option>
                <option value="month">月</option>
              </select>
            </label>
            <label className="space-y-1 text-[11px] text-text-muted">
              开始
              <input type="date" className="block h-9 rounded-md border border-border-strong bg-surface px-2.5 text-[12px]" value={from} onChange={(event) => updateParam("from", event.target.value)} />
            </label>
            <label className="space-y-1 text-[11px] text-text-muted">
              结束
              <input type="date" className="block h-9 rounded-md border border-border-strong bg-surface px-2.5 text-[12px]" value={to} onChange={(event) => updateParam("to", event.target.value)} />
            </label>
            <Button variant="outline" size="sm" disabled={analytics.isFetching} onClick={() => void analytics.refetch()}>
              <RefreshCw className={cn("size-3.5", analytics.isFetching && "animate-spin")} aria-hidden="true" />
              刷新
            </Button>
          </>
        )}
        footer={(
          <>
            {analytics.isFetching ? "正在刷新…" : `统计窗口：${data.window.from ?? "最早"} 至 ${data.window.to ?? "最新"} · ${bucketLabels[data.window.bucket] ?? data.window.bucket}`}
            {" · "}已安装方案包 {packs.isPending || packs.isError ? "—" : packs.data?.installations.length ?? 0} 个
          </>
        )}
      />

      <SummaryStrip
        className="border-t-0 sm:grid-cols-3 lg:grid-cols-5 lg:divide-x lg:divide-y-0"
        label="运营摘要"
      >
        <SummaryItem label="异常总数" value={data.summary.detectedExceptionCount} />
        <SummaryItem label="未进入治理" value={data.summary.exceptionsWithoutResolutionCase} />
        <SummaryItem label="待审批" value={data.resolutionFunnel.pending_approval} />
        <SummaryItem label="已执行" value={data.resolutionFunnel.executed} />
        <SummaryItem label="已结案" value={data.summary.closedResolutionCaseCount} />
      </SummaryStrip>

      <ProductSection className="mt-4">
        <SectionHeader
          title="业务上下文组合"
          description="先定位有风险的业务对象，再进入对应工作台。"
          meta={`${data.contexts.length} 个上下文`}
        />
        <div className="grid gap-2 border-b border-border/75 bg-surface-subtle/60 p-3 md:grid-cols-[minmax(200px,1fr)_150px_180px_170px]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-text-muted" aria-hidden="true" />
            <input
              aria-label="搜索业务上下文"
              className="h-9 w-full rounded-md border border-border-strong bg-surface pl-8 pr-2 text-[12px]"
              value={query}
              onChange={(event) => updateParam("q", event.target.value)}
              placeholder="搜索业务编号、类型或异常"
            />
          </label>
          <select aria-label="异常类型" className="h-9 rounded-md border border-border-strong bg-surface px-2.5 text-[12px]" value={exceptionCode} onChange={(event) => updateParam("exceptionCode", event.target.value)}>
            <option value="">全部异常类型</option>
            {data.exceptionBreakdown.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
          </select>
          <select aria-label="最高等级" className="h-9 rounded-md border border-border-strong bg-surface px-2.5 text-[12px]" value={severity} onChange={(event) => updateParam("severity", event.target.value)}>
            <option value="">全部等级</option>
            <option value="critical">严重</option>
            <option value="high">高</option>
            <option value="medium">中</option>
            <option value="low">低</option>
          </select>
          <select aria-label="治理状态" className="h-9 rounded-md border border-border-strong bg-surface px-2.5 text-[12px]" value={resolutionStatus} onChange={(event) => updateParam("resolutionStatus", event.target.value)}>
            <option value="">全部治理状态</option>
            {["no_case", "triaged", "confirmed", "proposed_draft", "pending_approval", "approved", "executed", "closed", "rejected"].map((value) => (
              <option key={value} value={value}>{resolutionStatusLabel(value)}</option>
            ))}
          </select>
        </div>
        {activeFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-surface-muted/50 px-3 py-2">
            <span className="mr-1 text-[11px] text-text-muted">当前筛选</span>
            {activeFilters.map((filter) => (
              <button
                key={filter.key}
                type="button"
                className="inline-flex h-6 items-center gap-1 rounded-sm border border-border bg-surface px-1.5 text-[11px] text-text-secondary hover:border-border-strong"
                onClick={() => updateParam(filter.key, "")}
              >
                {filter.label}
                <X className="size-3 text-text-muted" aria-hidden="true" />
              </button>
            ))}
            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={clearAllFilters}>
              清除全部
            </Button>
          </div>
        )}
        <PortfolioTable contexts={data.contexts} query={query} onOpenContext={(context) => navigate(contextDestination(context))} />
      </ProductSection>

      <ProductSection className="mt-4">
        <SectionHeader
          title="经营信号"
          description="点击异常类型或状态可直接缩小业务组合范围。"
          meta="按当前时间范围"
        />
        <div className="grid divide-y divide-border xl:grid-cols-3 xl:divide-x xl:divide-y-0">
          <div className="p-3.5">
            <h3 className="text-sm font-semibold">异常趋势</h3>
            <p className="mt-0.5 text-[11px] text-text-muted">按业务发生时间聚合，点击柱形筛选时间窗口。</p>
            <div className="mt-3 border-t border-border">
              {data.exceptionTrend.map((item) => (
                <MiniBar key={item.bucket} label={item.bucket} value={item.exceptionCount} max={maxTrend} tone="interactive" onClick={() => drillTrendBucket(item.bucket)} />
              ))}
              {!data.exceptionTrend.length && <div className="pt-3"><LocalState kind="empty" title="暂无趋势数据" compact /></div>}
            </div>
          </div>
          <div className="p-3.5">
            <h3 className="text-sm font-semibold">异常类型</h3>
            <p className="mt-0.5 text-[11px] text-text-muted">点击类型筛选业务组合。</p>
            <div className="mt-3 border-t border-border">
              {data.exceptionBreakdown.slice(0, 8).map((item) => {
                const highestSeverity = ["critical", "high", "medium", "low"].find((severity) => Number(item.severityBreakdown[severity] ?? 0) > 0);
                return (
                  <MiniBar
                    key={item.code}
                    label={item.label}
                    value={item.count}
                    max={maxException}
                    tone={severityTone(highestSeverity)}
                    onClick={() => updateParam("exceptionCode", item.code)}
                  />
                );
              })}
              {!data.exceptionBreakdown.length && <div className="pt-3"><LocalState kind="empty" title="暂无异常类型数据" compact /></div>}
            </div>
          </div>
          <div className="p-3.5">
            <h3 className="text-sm font-semibold">治理状态</h3>
            <p className="mt-0.5 text-[11px] text-text-muted">当前状态分布，不是概率漏斗。</p>
            <div className="mt-3 border-t border-border">
              {Object.entries(data.resolutionFunnel).map(([status, count]) => (
                <MiniBar
                  key={status}
                  label={resolutionStatusLabel(status)}
                  value={count}
                  max={maxFunnel}
                  tone={resolutionStatusTone(status)}
                  onClick={() => updateParam("resolutionStatus", status)}
                />
              ))}
            </div>
          </div>
        </div>
      </ProductSection>

      <ProductSection className="mt-4">
        <Tabs value={activeTab} onValueChange={(tab) => updateParam("tab", tab)}>
          <div className="border-b border-border px-3 pt-2">
            <TabsList aria-label="运营明细">
              <TabsTrigger value="exceptions">异常</TabsTrigger>
              <TabsTrigger value="governance">治理</TabsTrigger>
              <TabsTrigger value="actions">动作</TabsTrigger>
              <TabsTrigger value="sources">来源</TabsTrigger>
              <TabsTrigger value="results">结果</TabsTrigger>
            </TabsList>
          </div>
          <div className="overflow-x-auto p-3">
            {activeTab === "exceptions" && (
              <table data-testid="operations-exceptions-table" className="w-full min-w-[760px] text-left text-xs">
                <thead className="bg-surface-muted text-text-muted"><tr><th className="px-3 py-2 font-medium">业务上下文</th><th className="px-3 py-2 font-medium">异常类型</th><th className="px-3 py-2 font-medium">异常数</th><th className="px-3 py-2 font-medium">状态</th></tr></thead>
                <tbody className="divide-y divide-border">{data.contexts.map((context) => <tr key={context.contextId}><td className="px-3 py-2 font-medium">{context.businessKey}</td><td className="px-3 py-2">{context.exceptionCodes.map((code) => exceptionLabels.get(code) ?? code).join("、") || "无"}</td><td className="px-3 py-2 tabular-nums">{context.exceptionCount}</td><td className="px-3 py-2">{exceptionStatusLabel(context.status)}</td></tr>)}</tbody>
              </table>
            )}
            {activeTab === "governance" && (
              <table className="w-full min-w-[820px] text-left text-xs">
                <thead className="bg-surface-muted text-text-muted"><tr><th className="px-3 py-2 font-medium">规则</th><th className="px-3 py-2 font-medium">评估</th><th className="px-3 py-2 font-medium">命中</th><th className="px-3 py-2 font-medium">未命中</th><th className="px-3 py-2 font-medium">触发率</th></tr></thead>
                <tbody className="divide-y divide-border">{data.rulePerformance.map((rule) => <tr key={rule.ruleId}><td className="px-3 py-2">{rule.label}</td><td className="px-3 py-2 tabular-nums">{rule.evaluations}</td><td className="px-3 py-2 tabular-nums">{rule.matched}</td><td className="px-3 py-2 tabular-nums">{rule.notMatched}</td><td className="px-3 py-2 tabular-nums">{formatRate(rule.triggerRate)}</td></tr>)}</tbody>
              </table>
            )}
            {activeTab === "actions" && (
              <div className="space-y-4">
                <SummaryStrip className="grid-cols-2 sm:grid-cols-3" label="动作摘要">
                  <SummaryItem label="未完成任务" value={taskCount} />
                  <SummaryItem label="补证请求" value={evidenceRequestCount} />
                  <SummaryItem label="动作总数" value={data.summary.actionCount} />
                </SummaryStrip>
                <table className="w-full min-w-[760px] text-left text-xs">
                  <thead className="bg-surface-muted text-text-muted"><tr><th className="px-3 py-2 font-medium">动作</th><th className="px-3 py-2 font-medium">总数</th><th className="px-3 py-2 font-medium">草稿</th><th className="px-3 py-2 font-medium">待审批</th><th className="px-3 py-2 font-medium">已执行</th><th className="px-3 py-2 font-medium">已核验</th></tr></thead>
                  <tbody className="divide-y divide-border">{data.actionBreakdown.map((item) => <tr key={item.type}><td className="px-3 py-2">{actionTypeLabel(item.type)}</td><td className="px-3 py-2 tabular-nums">{item.total}</td><td className="px-3 py-2 tabular-nums">{item.draft}</td><td className="px-3 py-2 tabular-nums">{item.pending_approval}</td><td className="px-3 py-2 tabular-nums">{item.succeeded}</td><td className="px-3 py-2 tabular-nums">{item.verified}</td></tr>)}</tbody>
                </table>
              </div>
            )}
            {activeTab === "sources" && (
              <table className="w-full min-w-[520px] text-left text-xs">
                <thead className="bg-surface-muted text-text-muted"><tr><th className="px-3 py-2 font-medium">来源系统</th><th className="px-3 py-2 font-medium">涉及异常</th></tr></thead>
                <tbody className="divide-y divide-border">{data.sourceSystemInvolvement.map((source) => <tr key={source.sourceSystemId}><td className="px-3 py-2">{sourceSystemLabel(source.systemType, source.name)}</td><td className="px-3 py-2 tabular-nums">{source.involvedExceptionCount}</td></tr>)}</tbody>
              </table>
            )}
            {activeTab === "results" && (
              <div className="space-y-3">
                <SummaryStrip className="grid-cols-2 sm:grid-cols-5" label="结果摘要">
                  <SummaryItem label="已测量" value={data.outcomes.summary.measuredOutcomeCount} />
                  <SummaryItem label="目标达成" value={data.outcomes.summary.targetMetCount} />
                  <SummaryItem label="改善" value={data.outcomes.summary.improvedCount} />
                  <SummaryItem label="未变化" value={data.outcomes.summary.unchangedCount} />
                  <SummaryItem label="证据不足" value={data.outcomes.summary.insufficientEvidenceCount} />
                </SummaryStrip>
                <p className="text-xs text-text-muted">后续业务状态观察，不证明前序动作导致变化。</p>
              </div>
            )}
          </div>
        </Tabs>
      </ProductSection>
    </ProductPage>
  );
}
