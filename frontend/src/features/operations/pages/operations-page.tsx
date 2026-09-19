import { AlertCircle, ChevronRight, RefreshCw, Search } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Badge } from "../../../components/ui/badge.js";
import { Button } from "../../../components/ui/button.js";
import { Skeleton } from "../../../components/ui/skeleton.js";
import { Tabs, TabsList, TabsTrigger } from "../../../components/ui/tabs.js";
import { useInstalledSolutionPacks, useInternalWorkItems, useOperationalAnalytics, type OperationalAnalyticsQuery } from "../../../hooks/use-operations.js";
import { cn } from "../../../lib/utils.js";
import type { OperationalContextView } from "../types.js";
import {
  actionTypeLabel,
  contextTypeLabel,
  exceptionStatusLabel,
  formatShortDateTime,
  resolutionStatusLabel,
  sourceSystemLabel,
} from "../../manufacturing/utils.js";

const severityLabels: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "严重",
};

const resolutionLabels: Record<string, string> = {
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

const outcomeLabels: Record<string, string> = {
  target_met: "目标达成",
  improved: "改善",
  unchanged: "未变化",
  worsened: "恶化",
  insufficient_evidence: "证据不足",
};

const contextStatusLabels: Record<string, string> = {
  active: "进行中",
  closed: "已关闭",
  archived: "已归档",
};

const bucketLabels: Record<string, string> = {
  day: "按日",
  week: "按周",
  month: "按月",
};

const sourceTypeLabels: Record<string, string> = {
  erp: "订单系统",
  mes: "生产系统",
  qms: "质量系统",
  wms: "仓储系统",
  crm: "客户系统",
  finance: "财务系统",
  service: "客户服务记录",
  manual: "人工记录",
  file: "文件来源",
  demo: "示例数据",
};

function severityVariant(severity: string | null | undefined) {
  if (severity === "critical" || severity === "high") return "danger" as const;
  if (severity === "medium") return "warning" as const;
  return "default" as const;
}

function formatRate(value: number | null) {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function statusList(statuses: string[]) {
  return statuses.length ? statuses.map((status) => resolutionLabels[status] ?? status).join("、") : "未进入治理";
}

function contextDestination(context: OperationalContextView) {
  return context.contextType === "sales_order"
    ? `/manufacturing/${encodeURIComponent(context.contextId)}`
    : `/workspace/${encodeURIComponent(context.contextId)}`;
}

function SectionState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex gap-3 border border-danger/25 bg-danger/5 p-4 text-sm">
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
      <div><div className="font-medium text-danger">{title}</div><div className="mt-1 text-text-secondary">{detail}</div></div>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 px-3 py-2">
      <div className="text-[11px] text-text-muted">{label}</div>
      <div className="mt-0.5 text-lg font-semibold leading-6">{value}</div>
    </div>
  );
}

function MiniBar({ label, value, max, onClick }: { label: string; value: number; max: number; onClick?: () => void }) {
  const width = max > 0 ? Math.max(3, Math.round((value / max) * 100)) : 0;
  return (
    <button
      type="button"
      className="grid w-full grid-cols-[minmax(0,1fr)_42px] items-center gap-2 py-1.5 text-left text-xs hover:text-interactive"
      onClick={onClick}
    >
      <span className="min-w-0">
        <span className="block truncate">{label}</span>
        <span className="mt-1 block h-1.5 bg-interactive/15">
          <span className="block h-full bg-interactive/70" style={{ width: `${width}%` }} />
        </span>
      </span>
      <strong className="text-right font-semibold">{value}</strong>
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
  if (!rows.length) return <div className="py-10 text-center text-sm text-text-muted">没有匹配当前条件的业务上下文</div>;
  return (
    <div className="overflow-x-auto">
      <table data-testid="operations-portfolio-table" className="w-full min-w-[920px] border-collapse text-left text-xs">
        <thead className="bg-surface-muted text-text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">业务上下文</th>
            <th className="px-3 py-2 font-medium">类型</th>
            <th className="px-3 py-2 font-medium">异常</th>
            <th className="px-3 py-2 font-medium">最高等级</th>
            <th className="px-3 py-2 font-medium">治理状态</th>
            <th className="px-3 py-2 font-medium">负责人</th>
            <th className="px-3 py-2 font-medium">最近变化</th>
            <th className="px-3 py-2 font-medium">结果</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((context) => (
            <tr key={context.contextId} className="hover:bg-surface-muted">
              <td className="px-3 py-2">
                <button type="button" className="font-medium text-interactive hover:underline" onClick={() => onOpenContext(context)}>
                  {context.businessKey}
                </button>
              </td>
              <td className="px-3 py-2">{contextTypeLabel(context.contextType)}</td>
              <td className="px-3 py-2">
                <span className="font-semibold">{context.exceptionCount}</span>
                <span className="ml-1 text-text-muted">{context.exceptionCodes.length} 类</span>
              </td>
              <td className="px-3 py-2">
                {context.highestSeverity
                  ? <Badge variant={severityVariant(context.highestSeverity)}>{severityLabels[context.highestSeverity] ?? context.highestSeverity}</Badge>
                  : "—"}
              </td>
              <td className="max-w-[220px] truncate px-3 py-2">{statusList(context.resolutionStatuses)}</td>
              <td className="max-w-[150px] truncate px-3 py-2">{context.resolutionOwnerRoles.join("、") || "未指派"}</td>
              <td className="px-3 py-2 text-text-muted">{formatShortDateTime(context.latestChangeAt)}</td>
              <td className="px-3 py-2">
                {context.outcomeMeasurementCount
                  ? `${context.outcomeMeasurementCount} 次 · ${context.outcomeStatuses.map((status) => outcomeLabels[status] ?? status).join("、")}`
                  : "暂无测量"}
              </td>
              <td className="px-3 py-2 text-right"><ChevronRight className="ml-auto size-4 text-text-muted" aria-hidden="true" /></td>
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
      <main className="mx-auto w-full max-w-[1720px] space-y-3 px-5 py-5">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-80 w-full" />
      </main>
    );
  }
  if (analytics.isError || !analytics.data) {
    return <main className="mx-auto w-full max-w-[1720px] px-5 py-5"><SectionState title="运营视图加载失败" detail="当前 API 无法返回经营治理分析。" /></main>;
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

  return (
    <main className="mx-auto w-full max-w-[1720px] px-5 py-4">
      <header className="border-b border-border pb-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">运营视图</h1>
            <p className="mt-1 text-sm text-text-secondary">跨业务上下文查看异常、治理进度和后续结果。</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-[11px] text-text-muted">
              时间粒度
              <select className="block h-8 rounded-md border border-border-strong bg-surface px-2 text-xs" value={bucket} onChange={(event) => updateParam("bucket", event.target.value)}>
                <option value="day">日</option>
                <option value="week">周</option>
                <option value="month">月</option>
              </select>
            </label>
            <label className="space-y-1 text-[11px] text-text-muted">
              开始
              <input type="date" className="block h-8 rounded-md border border-border-strong bg-surface px-2 text-xs" value={from} onChange={(event) => updateParam("from", event.target.value)} />
            </label>
            <label className="space-y-1 text-[11px] text-text-muted">
              结束
              <input type="date" className="block h-8 rounded-md border border-border-strong bg-surface px-2 text-xs" value={to} onChange={(event) => updateParam("to", event.target.value)} />
            </label>
            <Button variant="outline" size="sm" disabled={analytics.isFetching} onClick={() => void analytics.refetch()}>
              <RefreshCw className={cn("size-3.5", analytics.isFetching && "animate-spin")} aria-hidden="true" />
              刷新
            </Button>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-text-muted">
          {analytics.isFetching ? "正在刷新…" : `统计窗口：${data.window.from ?? "最早"} 至 ${data.window.to ?? "最新"} · ${bucketLabels[data.window.bucket] ?? data.window.bucket}`}
          {" · "}已安装方案包 {packs.isPending || packs.isError ? "—" : packs.data?.installations.length ?? 0} 个
        </p>
      </header>

      <section className="grid grid-cols-2 divide-x divide-y divide-border border-x border-b border-border bg-surface sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0">
        <SummaryItem label="异常总数" value={data.summary.detectedExceptionCount} />
        <SummaryItem label="未进入治理" value={data.summary.exceptionsWithoutResolutionCase} />
        <SummaryItem label="待审批" value={data.resolutionFunnel.pending_approval} />
        <SummaryItem label="已执行" value={data.resolutionFunnel.executed} />
        <SummaryItem label="已结案" value={data.summary.closedResolutionCaseCount} />
      </section>

      <section className="mt-4 border border-border bg-surface">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-3 py-2.5">
          <div>
            <h2 className="text-sm font-semibold">业务上下文组合</h2>
            <p className="mt-0.5 text-[11px] text-text-muted">先定位有风险的业务对象，再进入对应工作台。</p>
          </div>
          <span className="text-xs text-text-muted">{data.contexts.length} 个上下文</span>
        </div>
        <div className="grid gap-2 border-b border-border p-3 md:grid-cols-[minmax(200px,1fr)_150px_180px_170px]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-text-muted" aria-hidden="true" />
            <input
              aria-label="搜索业务上下文"
              className="h-8 w-full rounded-md border border-border-strong bg-surface pl-8 pr-2 text-xs"
              value={query}
              onChange={(event) => updateParam("q", event.target.value)}
              placeholder="搜索业务编号、类型或异常"
            />
          </label>
          <select aria-label="异常类型" className="h-8 rounded-md border border-border-strong bg-surface px-2 text-xs" value={exceptionCode} onChange={(event) => updateParam("exceptionCode", event.target.value)}>
            <option value="">全部异常类型</option>
            {data.exceptionBreakdown.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
          </select>
          <select aria-label="最高等级" className="h-8 rounded-md border border-border-strong bg-surface px-2 text-xs" value={severity} onChange={(event) => updateParam("severity", event.target.value)}>
            <option value="">全部等级</option>
            <option value="critical">严重</option>
            <option value="high">高</option>
            <option value="medium">中</option>
            <option value="low">低</option>
          </select>
          <select aria-label="治理状态" className="h-8 rounded-md border border-border-strong bg-surface px-2 text-xs" value={resolutionStatus} onChange={(event) => updateParam("resolutionStatus", event.target.value)}>
            <option value="">全部治理状态</option>
            {Object.entries(resolutionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <PortfolioTable contexts={data.contexts} query={query} onOpenContext={(context) => navigate(contextDestination(context))} />
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className="border border-border bg-surface p-3">
          <h2 className="text-sm font-semibold">异常趋势</h2>
          <p className="mt-0.5 text-[11px] text-text-muted">按业务发生时间聚合，点击柱形筛选时间窗口。</p>
          <div className="mt-3 divide-y divide-border">
            {data.exceptionTrend.map((item) => (
              <MiniBar key={item.bucket} label={item.bucket} value={item.exceptionCount} max={maxTrend} onClick={() => drillTrendBucket(item.bucket)} />
            ))}
            {!data.exceptionTrend.length && <div className="py-6 text-xs text-text-muted">暂无趋势数据</div>}
          </div>
        </div>
        <div className="border border-border bg-surface p-3">
          <h2 className="text-sm font-semibold">异常类型</h2>
          <p className="mt-0.5 text-[11px] text-text-muted">点击类型筛选业务组合。</p>
          <div className="mt-3 divide-y divide-border">
            {data.exceptionBreakdown.slice(0, 8).map((item) => (
              <MiniBar key={item.code} label={item.label} value={item.count} max={maxException} onClick={() => updateParam("exceptionCode", item.code)} />
            ))}
          </div>
        </div>
        <div className="border border-border bg-surface p-3">
          <h2 className="text-sm font-semibold">治理状态</h2>
          <p className="mt-0.5 text-[11px] text-text-muted">当前状态分布，不是概率漏斗。</p>
          <div className="mt-3 divide-y divide-border">
            {Object.entries(data.resolutionFunnel).map(([status, count]) => (
              <MiniBar key={status} label={resolutionLabels[status] ?? status} value={count} max={maxFunnel} onClick={() => updateParam("resolutionStatus", status)} />
            ))}
          </div>
        </div>
      </section>

      <section className="mt-4 border border-border bg-surface">
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
                <tbody className="divide-y divide-border">{data.contexts.map((context) => <tr key={context.contextId}><td className="px-3 py-2 font-medium">{context.businessKey}</td><td className="px-3 py-2">{context.exceptionCodes.map((code) => exceptionLabels.get(code) ?? code).join("、") || "无"}</td><td className="px-3 py-2">{context.exceptionCount}</td><td className="px-3 py-2">{contextStatusLabels[context.status] ?? exceptionStatusLabel(context.status)}</td></tr>)}</tbody>
              </table>
            )}
            {activeTab === "governance" && (
              <table className="w-full min-w-[820px] text-left text-xs">
                <thead className="bg-surface-muted text-text-muted"><tr><th className="px-3 py-2 font-medium">规则</th><th className="px-3 py-2 font-medium">评估</th><th className="px-3 py-2 font-medium">命中</th><th className="px-3 py-2 font-medium">未命中</th><th className="px-3 py-2 font-medium">触发率</th></tr></thead>
                <tbody className="divide-y divide-border">{data.rulePerformance.map((rule) => <tr key={rule.ruleId}><td className="px-3 py-2">{rule.label}</td><td className="px-3 py-2">{rule.evaluations}</td><td className="px-3 py-2">{rule.matched}</td><td className="px-3 py-2">{rule.notMatched}</td><td className="px-3 py-2">{formatRate(rule.triggerRate)}</td></tr>)}</tbody>
              </table>
            )}
            {activeTab === "actions" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3">
                  <SummaryItem label="未完成任务" value={taskCount} />
                  <SummaryItem label="补证请求" value={evidenceRequestCount} />
                  <SummaryItem label="动作总数" value={data.summary.actionCount} />
                </div>
                <table className="w-full min-w-[760px] text-left text-xs">
                  <thead className="bg-surface-muted text-text-muted"><tr><th className="px-3 py-2 font-medium">动作</th><th className="px-3 py-2 font-medium">总数</th><th className="px-3 py-2 font-medium">草稿</th><th className="px-3 py-2 font-medium">待审批</th><th className="px-3 py-2 font-medium">已执行</th><th className="px-3 py-2 font-medium">已核验</th></tr></thead>
                  <tbody className="divide-y divide-border">{data.actionBreakdown.map((item) => <tr key={item.type}><td className="px-3 py-2">{actionTypeLabel(item.type)}</td><td className="px-3 py-2">{item.total}</td><td className="px-3 py-2">{item.draft}</td><td className="px-3 py-2">{item.pending_approval}</td><td className="px-3 py-2">{item.succeeded}</td><td className="px-3 py-2">{item.verified}</td></tr>)}</tbody>
                </table>
              </div>
            )}
            {activeTab === "sources" && (
              <table className="w-full min-w-[620px] text-left text-xs">
                <thead className="bg-surface-muted text-text-muted"><tr><th className="px-3 py-2 font-medium">来源系统</th><th className="px-3 py-2 font-medium">类型</th><th className="px-3 py-2 font-medium">涉及异常</th></tr></thead>
                <tbody className="divide-y divide-border">{data.sourceSystemInvolvement.map((source) => <tr key={source.sourceSystemId}><td className="px-3 py-2">{sourceSystemLabel(source.systemType, source.name)}</td><td className="px-3 py-2">{sourceTypeLabels[source.systemType] ?? source.systemType}</td><td className="px-3 py-2">{source.involvedExceptionCount}</td></tr>)}</tbody>
              </table>
            )}
            {activeTab === "results" && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-5">
                  <SummaryItem label="已测量" value={data.outcomes.summary.measuredOutcomeCount} />
                  <SummaryItem label="目标达成" value={data.outcomes.summary.targetMetCount} />
                  <SummaryItem label="改善" value={data.outcomes.summary.improvedCount} />
                  <SummaryItem label="未变化" value={data.outcomes.summary.unchangedCount} />
                  <SummaryItem label="证据不足" value={data.outcomes.summary.insufficientEvidenceCount} />
                </div>
                <p className="text-xs text-text-muted">后续业务状态观察，不证明前序动作导致变化。</p>
              </div>
            )}
          </div>
        </Tabs>
      </section>
    </main>
  );
}
