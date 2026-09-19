import { ArrowLeft, ChevronRight } from "lucide-react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Badge } from "../../../components/ui/badge.js";
import { Skeleton } from "../../../components/ui/skeleton.js";
import { useContextResolutionCases, usePackWorkbench } from "../../../hooks/use-operations.js";
import {
  contextTypeLabel,
  fieldLabel,
  formatBusinessValue,
  formatShortDateTime,
  resolutionStatusLabel,
} from "../../manufacturing/utils.js";

const contextStatusLabels: Record<string, string> = {
  active: "进行中",
  closed: "已关闭",
  archived: "已归档",
};

const outcomeStatusLabels: Record<string, string> = {
  target_met: "目标达成",
  improved: "改善",
  unchanged: "未变化",
  worsened: "恶化",
  insufficient_evidence: "证据不足",
};

function outcomeValue(value: unknown) {
  if (typeof value === "number") {
    return formatBusinessValue({ value, valueType: "number" });
  }
  return formatBusinessValue({ value });
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="px-3 py-2">
      <div className="text-[11px] text-text-muted">{label}</div>
      <div className="mt-0.5 text-lg font-semibold">{value}</div>
    </div>
  );
}

export function GenericContextWorkspacePage() {
  const { contextId } = useParams();
  const workbench = usePackWorkbench(contextId);
  const resolutions = useContextResolutionCases(contextId);

  if (workbench.isLoading) {
    return (
      <main className="mx-auto w-full max-w-[1720px] space-y-3 px-5 py-5">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-72 w-full" />
      </main>
    );
  }
  if (workbench.isError || !workbench.data) {
    return <main className="mx-auto w-full max-w-[1720px] px-5 py-5 text-sm text-danger">业务上下文加载失败或当前方案包未安装。</main>;
  }
  const data = workbench.data;
  if (data.context.contextType === "sales_order" && contextId) {
    return <Navigate to={`/manufacturing/${encodeURIComponent(contextId)}`} replace />;
  }

  const resolutionCases = resolutions.data?.resolutionCases ?? [];
  return (
    <main className="mx-auto w-full max-w-[1720px] px-5 py-4">
      <header className="border-b border-border pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link to="/operations" className="mb-2 inline-flex items-center gap-1 text-xs text-text-muted hover:text-interactive">
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              返回运营视图
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{data.context.businessKey}</h1>
              <Badge variant="info">{data.pack.name}</Badge>
              <Badge>{contextTypeLabel(data.context.contextType)}</Badge>
              <Badge>v{data.pack.version}</Badge>
            </div>
            <p className="mt-1 text-sm text-text-secondary">{data.pack.contextLabel}工作台</p>
          </div>
          <div className="text-right text-xs text-text-muted">
            <div>更新 {formatShortDateTime(data.context.updatedAt)}</div>
            <div className="mt-1">状态：{contextStatusLabels[data.context.status] ?? data.context.status}</div>
          </div>
        </div>
      </header>

      <section className="mt-4 grid grid-cols-2 divide-x divide-y divide-border border border-border bg-surface lg:grid-cols-5 lg:divide-y-0">
        <Stat label="业务对象" value={data.stats.entities} />
        <Stat label="证据" value={data.stats.evidence} />
        <Stat label="规则评估" value={data.stats.ruleEvaluations} />
        <Stat label="异常" value={data.stats.exceptions} />
        <Stat label="后续结果" value={data.outcomes.length} />
      </section>

      <section className="mt-4 border border-border bg-surface">
        <div className="border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold">业务线程</h2>
          <p className="mt-0.5 text-[11px] text-text-muted">仅表示业务顺序，不代表因果关系。</p>
        </div>
        <div className="divide-y divide-border">
          {data.thread.map((stage) => (
            <div key={stage.key} className="grid gap-2 px-4 py-3 md:grid-cols-[180px_minmax(0,1fr)]">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{stage.label}</span>
                  <span className={stage.state === "exception" ? "size-2 rounded-full bg-warning" : "size-2 rounded-full bg-success"} />
                </div>
                <div className="mt-0.5 text-[11px] text-text-muted">{stage.businessKey}</div>
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {stage.facts.map((fact) => (
                  <div key={fact.key} className="text-xs">
                    <span className="text-text-muted">{fact.label} </span>
                    <strong>{formatBusinessValue(fact)}</strong>
                  </div>
                ))}
                {!stage.facts.length && <span className="text-xs text-text-muted">暂无核心事实</span>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="border border-border bg-surface">
          <div className="border-b border-border px-4 py-2.5"><h2 className="text-sm font-semibold">规则与异常</h2></div>
          <div className="divide-y divide-border">
            {data.rules.map((rule) => (
              <div key={rule.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span>{rule.label}</span>
                <Badge variant={rule.matched ? "warning" : "success"}>{rule.matched ? "命中" : "未命中"}</Badge>
              </div>
            ))}
            {data.exceptions.map((exception) => (
              <div key={exception.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{exception.label}</div>
                    <div className="mt-0.5 text-xs text-text-muted">{exception.summary}</div>
                  </div>
                  <Badge variant={exception.severity === "high" || exception.severity === "critical" ? "danger" : "warning"}>
                    {exception.severity}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border border-border bg-surface">
          <div className="border-b border-border px-4 py-2.5"><h2 className="text-sm font-semibold">治理与结果</h2></div>
          <div className="divide-y divide-border">
            {resolutions.isPending && <div className="px-4 py-5 text-xs text-text-muted">正在读取治理信息…</div>}
            {resolutions.isError && <div className="px-4 py-5 text-xs text-danger">治理信息暂不可用。</div>}
            {!resolutions.isPending && !resolutions.isError && resolutionCases.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-xs">
                <div>
                  <div>{item.title}</div>
                  <div className="mt-0.5 text-[11px] text-text-muted">{item.ownerRole || "负责人未记录"} · 更新 {formatShortDateTime(item.updatedAt)}</div>
                </div>
                <Badge>{resolutionStatusLabel(item.status)}</Badge>
              </div>
            ))}
            {data.outcomes.map((outcome) => (
              <div key={outcome.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-xs">
                <div>
                  <div>后续测量 · {fieldLabel(outcome.current.field)} {outcomeValue(outcome.current.value)}</div>
                  <div className="mt-0.5 text-[11px] text-text-muted">测量时间 {formatShortDateTime(outcome.evaluatedAt)}</div>
                </div>
                <Badge variant={outcome.status === "target_met" ? "success" : "warning"}>
                  {outcomeStatusLabels[outcome.status] ?? outcome.status}
                </Badge>
              </div>
            ))}
            {!resolutions.isPending && !resolutions.isError && !resolutionCases.length && <div className="px-4 py-5 text-xs text-text-muted">尚未进入治理。</div>}
            {!data.outcomes.length && <div className="px-4 py-5 text-xs text-text-muted">暂无后续结果测量。</div>}
          </div>
        </div>
      </section>
    </main>
  );
}
