import { useMemo, useState } from "react";
import { ArrowUpRight, Clock3, RefreshCw, Search, SlidersHorizontal, UserRound, X } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  LocalState,
  ProductHeader,
  ProductPage,
  ProductSection,
  SectionHeader,
} from "../../../components/product/page-layout.js";
import { ResolutionStatusBadge, SeverityBadge } from "../../../components/product/status-badge.js";
import { BiDashboard } from "../components/bi-dashboard.js";
import { Badge } from "../../../components/ui/badge.js";
import { Button } from "../../../components/ui/button.js";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../../components/ui/sheet.js";
import {
  useContextResolutionCases,
  useOperationalAnalytics,
  type OperationalAnalyticsQuery,
} from "../../../hooks/use-operations.js";
import { resolutionStatusLabel } from "../../../lib/presentation.js";
import { cn } from "../../../lib/utils.js";
import type { OperationalContextView } from "../types.js";
import { contextTypeLabel, formatShortDateTime } from "../../manufacturing/utils.js";

type QueueViewId = "pending" | "pending_approval" | "high_risk" | "unassigned" | "recent" | "all";
type QueueSortId = "risk" | "updated_desc" | "updated_asc";

type QueueView = {
  id: QueueViewId;
  label: string;
};

const QUEUE_VIEWS: QueueView[] = [
  { id: "pending", label: "待处理" },
  { id: "pending_approval", label: "待审批" },
  { id: "high_risk", label: "高风险" },
  { id: "unassigned", label: "无人负责" },
  { id: "recent", label: "最近更新" },
  { id: "all", label: "全部" },
];

const SORT_OPTIONS: Array<{ id: QueueSortId; label: string }> = [
  { id: "risk", label: "风险优先" },
  { id: "updated_desc", label: "最近更新" },
  { id: "updated_asc", label: "最久未更新" },
];

const STATUS_FILTERS = [
  "no_case",
  "triaged",
  "confirmed",
  "proposed_draft",
  "pending_approval",
  "approved",
  "executed",
  "closed",
  "rejected",
] as const;

const TERMINAL_STATUSES = new Set(["closed", "rejected"]);
const ACTIVE_STATUSES = new Set(["triaged", "confirmed", "proposed_draft", "pending_approval", "approved", "executed"]);

function contextDestination(context: OperationalContextView) {
  return context.contextType === "sales_order"
    ? `/manufacturing/${encodeURIComponent(context.contextId)}`
    : `/workspace/${encodeURIComponent(context.contextId)}`;
}

function contextTitle(context: OperationalContextView, labels: Map<string, string>) {
  const titles = [...new Set(context.exceptionCodes.map((code) => labels.get(code) ?? "未命名异常"))];
  if (!titles.length) return "需要关注的异常";
  if (titles.length === 1) return titles[0]!;
  return `${titles[0]}等 ${titles.length} 类异常`;
}

function isPending(context: OperationalContextView) {
  if (!context.exceptionCount) return false;
  if (!context.resolutionStatuses.length) return true;
  return context.resolutionStatuses.some((status) => !TERMINAL_STATUSES.has(status));
}

function inQueueView(context: OperationalContextView, view: QueueViewId) {
  if (view === "pending") return isPending(context);
  if (view === "pending_approval") return context.resolutionStatuses.includes("pending_approval");
  if (view === "high_risk") return context.highestSeverity === "high" || context.highestSeverity === "critical";
  if (view === "unassigned") return context.resolutionOwnerRoles.length === 0;
  return true;
}

function nextStep(context: OperationalContextView) {
  const statuses = new Set(context.resolutionStatuses);
  if (statuses.has("pending_approval")) return "等待独立审批";
  if (statuses.has("proposed_draft")) return "提交审批";
  if (statuses.has("confirmed")) return "拟定处置方案";
  if (statuses.has("triaged")) return "等待复核";
  if (statuses.has("approved")) return "执行已批准方案";
  if (statuses.has("executed")) return "核验回执";
  if (!statuses.size || statuses.has("no_case")) return "需要受理";
  if ([...statuses].every((status) => status === "closed")) return "已完成";
  if ([...statuses].every((status) => TERMINAL_STATUSES.has(status))) return "已拒绝";
  if ([...statuses].some((status) => ACTIVE_STATUSES.has(status))) return "待确认";
  return "待确认";
}

function nextStepVariant(value: string) {
  if (value === "已完成") return "success" as const;
  if (value === "已拒绝") return "danger" as const;
  if (value === "等待独立审批" || value === "提交审批") return "warning" as const;
  if (value === "需要受理" || value === "等待复核") return "info" as const;
  return "default" as const;
}

function riskRank(context: OperationalContextView) {
  return { critical: 4, high: 3, medium: 2, low: 1 }[context.highestSeverity ?? "low"] ?? 0;
}

function timestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortContexts(contexts: OperationalContextView[], sort: QueueSortId) {
  return [...contexts].sort((left, right) => {
    if (sort === "updated_desc") return timestamp(right.latestChangeAt) - timestamp(left.latestChangeAt);
    if (sort === "updated_asc") return timestamp(left.latestChangeAt) - timestamp(right.latestChangeAt);
    const riskDifference = riskRank(right) - riskRank(left);
    return riskDifference || timestamp(right.latestChangeAt) - timestamp(left.latestChangeAt);
  });
}

function formatRelativeTime(value: string) {
  const timestampValue = Date.parse(value);
  if (!Number.isFinite(timestampValue)) return "时间未记录";
  const delta = timestampValue - Date.now();
  const absolute = Math.abs(delta);
  if (absolute < 60_000) return "刚刚";
  const formatter = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
  if (absolute < 3_600_000) return formatter.format(Math.round(delta / 60_000), "minute");
  if (absolute < 86_400_000) return formatter.format(Math.round(delta / 3_600_000), "hour");
  if (absolute < 2_592_000_000) return formatter.format(Math.round(delta / 86_400_000), "day");
  return formatter.format(Math.round(delta / 2_592_000_000), "month");
}

function matchesSearch(context: OperationalContextView, query: string, labels: Map<string, string>) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const text = [
    context.businessKey,
    context.contextId,
    contextTypeLabel(context.contextType),
    ...context.exceptionCodes,
    ...context.exceptionCodes.map((code) => labels.get(code) ?? ""),
    ...context.resolutionOwnerRoles,
  ].join(" ").toLowerCase();
  return text.includes(normalized);
}

function GovernanceStatus({ context }: { context: OperationalContextView }) {
  if (!context.resolutionStatuses.length) return <ResolutionStatusBadge status="no_case" />;
  const visible = context.resolutionStatuses.slice(0, 2);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {visible.map((status) => <ResolutionStatusBadge key={status} status={status} />)}
      {context.resolutionStatuses.length > 2 && (
        <span className="text-[10px] text-text-muted">+{context.resolutionStatuses.length - 2}</span>
      )}
    </div>
  );
}


/** 按所选日期范围自动选择趋势粒度：范围越长，分桶越粗，避免趋势点过多或过少 */
function resolveTrendBucket(from: string, to: string): "day" | "week" | "month" {
  if (!from && !to) return "day";
  const start = Date.parse(from || to);
  const end = Date.parse(to || from);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "day";
  const days = Math.abs(end - start) / 86_400_000;
  if (days <= 31) return "day";
  if (days <= 182) return "week";
  return "month";
}

const TREND_BUCKET_LABEL: Record<"day" | "week" | "month", string> = {
  day: "按天",
  week: "按周",
  month: "按月",
};


function QueueTable({
  contexts,
  labels,
  onOpenPreview,
  onOpenRecord,
}: {
  contexts: OperationalContextView[];
  labels: Map<string, string>;
  onOpenPreview: (context: OperationalContextView) => void;
  onOpenRecord: (context: OperationalContextView) => void;
}) {
  if (!contexts.length) {
    return (
      <div className="p-4">
        <LocalState kind="no-results" title="没有匹配当前搜索和筛选条件的异常" detail="请调整搜索词、视图或筛选条件。" compact />
      </div>
    );
  }
  return (
    <div className="max-h-[calc(100vh-270px)] overflow-auto">
      <table data-testid="operations-work-queue" className="w-full min-w-[960px] border-collapse text-left text-xs">
        <thead className="sticky top-0 z-10 bg-surface-subtle/80 text-[11px] font-medium text-text-muted backdrop-blur-sm">
          <tr>
            <th className="sticky left-0 z-20 border-b border-border bg-surface-subtle/95 px-4 py-2.5 font-medium">异常 / 业务对象</th>
            <th className="border-b border-border px-4 py-2.5 font-medium">风险</th>
            <th className="border-b border-border px-4 py-2.5 font-medium">治理状态</th>
            <th className="border-b border-border px-4 py-2.5 font-medium">下一步</th>
            <th className="hidden border-b border-border px-4 py-2.5 font-medium xl:table-cell">负责人</th>
            <th className="hidden border-b border-border px-4 py-2.5 font-medium xl:table-cell">最近变化</th>
            <th className="border-b border-border px-4 py-2.5 font-medium" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border/80">
          {contexts.map((context) => {
            const step = nextStep(context);
            const owner = context.resolutionOwnerRoles.join("、") || "未指派";
            return (
              <tr
                key={context.contextId}
                data-testid="operations-row"
                tabIndex={0}
                role="button"
                aria-label={`查看 ${context.businessKey} 快速预览`}
                className="group h-16 cursor-pointer outline-none transition-colors duration-150 hover:bg-interactive/[0.03] focus-visible:bg-interactive/[0.05]"
                onClick={() => onOpenPreview(context)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpenPreview(context);
                  }
                }}
              >
                <td className="sticky left-0 z-10 bg-surface px-4 py-3 transition-colors group-hover:bg-interactive/[0.03] group-focus-visible:bg-interactive/[0.05]">
                  <button
                    type="button"
                    className="block max-w-[430px] text-left"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenRecord(context);
                    }}
                  >
                    <span className="block truncate text-[13px] font-semibold text-text-primary transition-colors group-hover:text-interactive">
                      {contextTitle(context, labels)}
                    </span>
                    <span className="mt-1 block truncate text-[11px] text-text-muted">
                      {context.businessKey} · {contextTypeLabel(context.contextType)} · {context.exceptionCount} 个异常
                    </span>
                  </button>
                </td>
                <td className="px-4 py-3">
                  {context.highestSeverity ? <SeverityBadge severity={context.highestSeverity} /> : <span className="text-text-muted">未定级</span>}
                </td>
                <td className="px-4 py-3"><GovernanceStatus context={context} /></td>
                <td className="px-4 py-3"><Badge variant={nextStepVariant(step)}>{step}</Badge></td>
                <td className="hidden px-4 py-3 text-text-secondary xl:table-cell">
                  <span className="inline-flex items-center gap-1.5">
                    {context.resolutionOwnerRoles.length ? <UserRound className="size-3.5 text-text-muted" aria-hidden="true" /> : null}
                    {owner}
                  </span>
                </td>
                <td className="hidden px-4 py-3 text-text-muted xl:table-cell">
                  <span title={formatShortDateTime(context.latestChangeAt)}>{formatRelativeTime(context.latestChangeAt)}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-text-muted opacity-0 transition-all duration-150 hover:bg-surface-subtle hover:text-interactive focus-visible:opacity-100 group-hover:opacity-100"
                    aria-label={`打开 ${context.businessKey} 完整记录`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenRecord(context);
                    }}
                  >
                    <ArrowUpRight className="size-4" aria-hidden="true" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function OperationsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const view = (QUEUE_VIEWS.some((item) => item.id === searchParams.get("view"))
    ? searchParams.get("view")
    : "pending") as QueueViewId;
  const sort = (SORT_OPTIONS.some((item) => item.id === searchParams.get("sort"))
    ? searchParams.get("sort")
    : "risk") as QueueSortId;
  const query = searchParams.get("q") ?? "";
  const severity = searchParams.get("severity") ?? "";
  const exceptionCode = searchParams.get("exceptionCode") ?? "";
  const resolutionStatus = searchParams.get("resolutionStatus") ?? "";
  const owner = searchParams.get("owner") ?? "";
  const contextType = searchParams.get("contextType") ?? "";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const timeBasis = (searchParams.get("timeBasis") ?? "context_opened") as "context_opened" | "exception_occurrence";
  const previewId = searchParams.get("preview") ?? "";

  const trendBucket = resolveTrendBucket(from, to);
  const analyticsQuery: OperationalAnalyticsQuery = {
    bucket: trendBucket,
    timeBasis,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
  const analytics = useOperationalAnalytics(analyticsQuery);
  const data = analytics.data;
  const contexts = data?.contexts ?? [];
  const exceptionLabels = useMemo(
    () => new Map((data?.exceptionBreakdown ?? []).map((item) => [item.code, item.label])),
    [data?.exceptionBreakdown],
  );

  // 趋势数据来自后端真实分桶，不足两期时不展示趋势卡
  const trend = data?.exceptionTrend ?? [];
  // 看板视觉数据：柱图用 count，柱体点击下钻用该分桶的真实时间区间
  const trendData = trend.map((bucket) => ({
    key: bucket.bucket,
    label: bucket.label,
    value: bucket.exceptionCount,
  }));
  const trendRanges = new Map(trend.map((bucket) => [bucket.bucket, { from: bucket.from, to: bucket.to }]));

  const updateParams = (updates: Record<string, string | undefined>, replace = true) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearchParams(next, { replace });
  };

  const viewCounts = Object.fromEntries(
    QUEUE_VIEWS.map((item) => [item.id, contexts.filter((context) => inQueueView(context, item.id)).length]),
  ) as Record<QueueViewId, number>;

  const filteredContexts = sortContexts(
    contexts
      .filter((context) => inQueueView(context, view))
      .filter((context) => !severity || context.highestSeverity === severity)
      .filter((context) => !exceptionCode || context.exceptionCodes.includes(exceptionCode))
      .filter((context) => !resolutionStatus || context.resolutionStatuses.includes(resolutionStatus as never) || (resolutionStatus === "no_case" && !context.resolutionStatuses.length))
      .filter((context) => !owner || context.resolutionOwnerRoles.includes(owner))
      .filter((context) => !contextType || context.contextType === contextType)
      .filter((context) => matchesSearch(context, query, exceptionLabels)),
    sort,
  );

  const previewContext = contexts.find((context) => context.contextId === previewId);
  const previewCases = useContextResolutionCases(previewContext?.contextId);
  const ownerOptions = [...new Set(contexts.flatMap((context) => context.resolutionOwnerRoles))].sort();
  const contextTypeOptions = [...new Set(contexts.map((context) => context.contextType))].sort();
  const activeFilterCount = [severity, exceptionCode, resolutionStatus, owner, contextType, from, to].filter(Boolean).length;
  const activeFilters = [
    severity ? { key: "severity", label: `风险：${severity === "critical" ? "严重" : severity === "high" ? "高" : severity === "medium" ? "中" : "低"}` } : null,
    exceptionCode ? { key: "exceptionCode", label: `异常：${exceptionLabels.get(exceptionCode) ?? exceptionCode}` } : null,
    resolutionStatus ? { key: "resolutionStatus", label: `治理：${resolutionStatusLabel(resolutionStatus)}` } : null,
    owner ? { key: "owner", label: `负责人：${owner}` } : null,
    contextType ? { key: "contextType", label: `业务类型：${contextTypeLabel(contextType)}` } : null,
    from ? { key: "from", label: `开始：${from}` } : null,
    to ? { key: "to", label: `结束：${to}` } : null,
  ].filter((item): item is { key: string; label: string } => Boolean(item));

  const clearAllFilters = () => {
    updateParams({
      q: undefined,
      severity: undefined,
      exceptionCode: undefined,
      resolutionStatus: undefined,
      owner: undefined,
      contextType: undefined,
      from: undefined,
      to: undefined,
      timeBasis: undefined,
      preview: undefined,
    });
  };

  const openPreview = (context: OperationalContextView) => updateParams({ preview: context.contextId }, true);
  const openRecord = (context: OperationalContextView) => navigate(contextDestination(context));

  return (
    <ProductPage className="py-4">
      <ProductHeader
        title="运营中心"
        description="集中处理需要关注的履约异常"
        actions={(
          <Button variant="outline" size="sm" disabled={analytics.isFetching} onClick={() => void analytics.refetch()}>
            <RefreshCw className={cn("size-3.5", analytics.isFetching && "animate-spin")} aria-hidden="true" />
            刷新
          </Button>
        )}
      />

      <BiDashboard
        view={data}
        loading={analytics.isLoading}
        error={analytics.isError}
        trend={trendData}
        buckets={trendRanges}
        bucketLabel={TREND_BUCKET_LABEL[trendBucket]}
        viewCounts={viewCounts}
        activeView={view}
        onSelectView={(nextView) => updateParams({ view: nextView, preview: undefined }, false)}
        {...(severity ? { severity } : {})}
        onSelectSeverity={(next) => updateParams({ severity: severity === next ? undefined : next })}
        {...(exceptionCode ? { exceptionCode } : {})}
        onSelectExceptionCode={(next) => updateParams({ exceptionCode: exceptionCode === next ? undefined : next })}
        onSelectBucket={({ from, to }) => updateParams({
          from: from.slice(0, 10),
          to: to.slice(0, 10),
          timeBasis: "exception_occurrence",
        })}
      />

      <div className="mt-4 flex flex-wrap items-center gap-1 rounded-lg border border-border/80 bg-surface p-1 shadow-card" role="tablist" aria-label="运营队列视图">
        {QUEUE_VIEWS.map((item) => {
          const active = item.id === view;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-2 rounded-md px-2.5 text-[12.5px] font-medium transition-colors",
                active
                  ? "bg-interactive/[0.08] text-interactive"
                  : "text-text-muted hover:bg-surface-subtle hover:text-text-primary",
              )}
              onClick={() => updateParams({ view: item.id, preview: undefined }, false)}
            >
              {item.label}
              <span className={cn(
                "inline-flex h-[18px] min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] tabular-nums transition-colors",
                active ? "bg-interactive/10 text-interactive" : "bg-surface-subtle text-text-muted",
              )}>
                {analytics.isLoading ? "\u2014" : viewCounts[item.id]}
              </span>
            </button>
          );
        })}
      </div>

      <ProductSection className="mt-3">
        <SectionHeader
          title="异常队列"
          description="按风险、治理进度和最近变化扫描需要处理的业务异常。"
          meta={`${filteredContexts.length} / ${contexts.length} 个业务上下文`}
        />
        <div className="grid gap-2 border-b border-border/75 bg-surface-subtle/50 p-3 md:grid-cols-[minmax(220px,1fr)_auto_180px]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-text-muted" aria-hidden="true" />
            <input
              aria-label="搜索异常"
              className="h-9 w-full rounded-md border border-border-strong bg-surface pl-8 pr-2 text-[12px] shadow-[0_1px_2px_rgba(16,24,40,0.04)] outline-none transition-colors placeholder:text-text-muted/80 focus:border-interactive focus:ring-[3px] focus:ring-interactive/15"
              value={query}
              onChange={(event) => updateParams({ q: event.target.value })}
              placeholder="搜索异常、订单或业务对象……"
            />
          </label>
          <Button variant="outline" size="sm" onClick={() => setFiltersOpen(true)}>
            <SlidersHorizontal className="size-3.5" aria-hidden="true" />
            筛选
            {activeFilterCount > 0 && <Badge variant="info">{activeFilterCount}</Badge>}
          </Button>
          <label className="sr-only" htmlFor="operations-sort">排序</label>
          <select
            id="operations-sort"
            aria-label="排序"
            className="h-9 rounded-md border border-border-strong bg-surface px-2.5 text-[12px] text-text-secondary shadow-[0_1px_2px_rgba(16,24,40,0.04)] outline-none transition-colors focus:border-interactive focus:ring-[3px] focus:ring-interactive/15"
            value={sort}
            onChange={(event) => updateParams({ sort: event.target.value as QueueSortId }, false)}
          >
            {SORT_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </div>

        {(activeFilters.length > 0 || query) && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-surface-muted/50 px-3 py-2">
            {query && (
              <button type="button" className="inline-flex h-6 items-center gap-1 rounded-full border border-border bg-surface px-2 text-[11px] text-text-secondary transition-colors hover:border-border-strong hover:bg-surface-subtle" onClick={() => updateParams({ q: undefined })}>
                搜索：{query}
                <X className="size-3 text-text-muted" aria-hidden="true" />
              </button>
            )}
            {activeFilters.map((filter) => (
              <button key={filter.key} type="button" className="inline-flex h-6 items-center gap-1 rounded-full border border-border bg-surface px-2 text-[11px] text-text-secondary transition-colors hover:border-border-strong hover:bg-surface-subtle" onClick={() => updateParams({ [filter.key]: undefined })}>
                {filter.label}
                <X className="size-3 text-text-muted" aria-hidden="true" />
              </button>
            ))}
            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={clearAllFilters}>清除全部</Button>
          </div>
        )}

        {analytics.isLoading ? (
          <div className="space-y-px p-3" aria-label="运营队列加载中">
            {[0, 1, 2, 3, 4].map((item) => <div key={item} className="h-14 animate-pulse rounded-sm bg-surface-muted" />)}
          </div>
        ) : analytics.isError ? (
          <div className="p-4">
            <LocalState kind="error" title="运营队列加载失败" detail="当前 API 无法返回运营队列。" compact />
            <Button className="mt-3" variant="outline" size="sm" onClick={() => void analytics.refetch()}>重试</Button>
          </div>
        ) : (
          <QueueTable contexts={filteredContexts} labels={exceptionLabels} onOpenPreview={openPreview} onOpenRecord={openRecord} />
        )}
      </ProductSection>

      <Sheet open={Boolean(previewContext)} onOpenChange={(open) => { if (!open) updateParams({ preview: undefined }, true); }}>
        <SheetContent data-testid="operations-quick-preview" className="max-w-[460px]">
          {previewContext && (
            <>
              <SheetHeader>
                <SheetTitle>{contextTitle(previewContext, exceptionLabels)}</SheetTitle>
                <SheetDescription>
                  {previewContext.businessKey} · {contextTypeLabel(previewContext.contextType)}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-5 space-y-5">
                <div className="flex flex-wrap gap-1.5">
                  {previewContext.highestSeverity && <SeverityBadge severity={previewContext.highestSeverity} />}
                  <GovernanceStatus context={previewContext} />
                  <Badge variant={nextStepVariant(nextStep(previewContext))}>{nextStep(previewContext)}</Badge>
                </div>
                <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 border-y border-border py-3 text-xs">
                  <dt className="text-text-muted">业务对象</dt><dd>{previewContext.businessKey}</dd>
                  <dt className="text-text-muted">异常数量</dt><dd className="tabular-nums">{previewContext.exceptionCount}</dd>
                  <dt className="text-text-muted">负责人</dt><dd>{previewContext.resolutionOwnerRoles.join("、") || "未指派"}</dd>
                  <dt className="text-text-muted">规则评估</dt><dd className="tabular-nums">{previewContext.ruleEvaluationCount}</dd>
                  <dt className="text-text-muted">来源系统</dt><dd className="tabular-nums">{previewContext.sourceSystemIds.length}</dd>
                  <dt className="text-text-muted">最近变化</dt><dd title={formatShortDateTime(previewContext.latestChangeAt)}>{formatRelativeTime(previewContext.latestChangeAt)}</dd>
                </dl>
                <div>
                  <h3 className="text-xs font-semibold text-text-secondary">治理案件</h3>
                  {previewCases.isLoading ? (
                    <div className="mt-2 h-16 animate-pulse rounded-sm bg-surface-muted" />
                  ) : previewCases.isError ? (
                    <p className="mt-2 text-xs text-danger">治理案件暂无法读取。</p>
                  ) : previewCases.data?.resolutionCases.length ? (
                    <div className="mt-2 divide-y divide-border border-y border-border">
                      {previewCases.data.resolutionCases.map((resolutionCase) => (
                        <div key={resolutionCase.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-text-secondary">{resolutionCase.title}</p>
                            <p className="mt-0.5 text-text-muted">{resolutionCase.ownerRole || "未指派负责人"}</p>
                          </div>
                          <ResolutionStatusBadge status={resolutionCase.status} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-text-muted">当前没有已建立的治理案件。</p>
                  )}
                </div>
                <div className="flex gap-2 border-y border-border py-3 text-xs text-text-muted">
                  <Clock3 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <p>当前运营队列不包含 Evidence 摘要；完整证据请在关联工作台查看。</p>
                </div>
                <Button asChild>
                  <Link to={contextDestination(previewContext)}>打开完整记录</Link>
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent className="max-w-[440px]">
          <SheetHeader>
            <SheetTitle>筛选队列</SheetTitle>
            <SheetDescription>筛选条件会保留在当前 URL 中。</SheetDescription>
          </SheetHeader>
          <div className="mt-5 space-y-4">
            <label className="block space-y-1 text-xs text-text-muted">
              异常类型
              <select className="h-9 w-full rounded-md border border-border-strong bg-surface px-2 text-sm" value={exceptionCode} onChange={(event) => updateParams({ exceptionCode: event.target.value })}>
                <option value="">全部异常类型</option>
                {(data?.exceptionBreakdown ?? []).map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
              </select>
            </label>
            <label className="block space-y-1 text-xs text-text-muted">
              风险等级
              <select className="h-9 w-full rounded-md border border-border-strong bg-surface px-2 text-sm" value={severity} onChange={(event) => updateParams({ severity: event.target.value })}>
                <option value="">全部等级</option>
                <option value="critical">紧急</option>
                <option value="high">高</option>
                <option value="medium">中</option>
                <option value="low">低</option>
              </select>
            </label>
            <label className="block space-y-1 text-xs text-text-muted">
              治理状态
              <select className="h-9 w-full rounded-md border border-border-strong bg-surface px-2 text-sm" value={resolutionStatus} onChange={(event) => updateParams({ resolutionStatus: event.target.value })}>
                <option value="">全部治理状态</option>
                {STATUS_FILTERS.map((status) => <option key={status} value={status}>{resolutionStatusLabel(status)}</option>)}
              </select>
            </label>
            <label className="block space-y-1 text-xs text-text-muted">
              负责人
              <select className="h-9 w-full rounded-md border border-border-strong bg-surface px-2 text-sm" value={owner} onChange={(event) => updateParams({ owner: event.target.value })}>
                <option value="">全部负责人</option>
                {ownerOptions.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="block space-y-1 text-xs text-text-muted">
              业务类型
              <select className="h-9 w-full rounded-md border border-border-strong bg-surface px-2 text-sm" value={contextType} onChange={(event) => updateParams({ contextType: event.target.value })}>
                <option value="">全部业务类型</option>
                {contextTypeOptions.map((item) => <option key={item} value={item}>{contextTypeLabel(item)}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1 text-xs text-text-muted">
                开始日期
                <input type="date" className="h-9 w-full rounded-md border border-border-strong bg-surface px-2 text-sm" value={from} onChange={(event) => updateParams({ from: event.target.value, timeBasis: "context_opened" })} />
              </label>
              <label className="block space-y-1 text-xs text-text-muted">
                结束日期
                <input type="date" className="h-9 w-full rounded-md border border-border-strong bg-surface px-2 text-sm" value={to} onChange={(event) => updateParams({ to: event.target.value, timeBasis: "context_opened" })} />
              </label>
            </div>
            <label className="block space-y-1 text-xs text-text-muted">
              时间口径
              <select className="h-9 w-full rounded-md border border-border-strong bg-surface px-2 text-sm" value={timeBasis} onChange={(event) => updateParams({ timeBasis: event.target.value })}>
                <option value="context_opened">业务对象创建时间</option>
                <option value="exception_occurrence">异常发生时间</option>
              </select>
            </label>
            <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
              <Button variant="ghost" size="sm" onClick={clearAllFilters}>清除全部</Button>
              <Button size="sm" onClick={() => setFiltersOpen(false)}>完成</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </ProductPage>
  );
}
