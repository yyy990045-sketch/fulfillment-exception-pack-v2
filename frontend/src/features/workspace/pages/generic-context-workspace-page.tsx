import { ArrowLeft } from "lucide-react";
import { Link, Navigate, useParams } from "react-router-dom";
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
  ContextStatusBadge,
  OutcomeStatusBadge,
  ResolutionStatusBadge,
  SeverityBadge,
} from "../../../components/product/status-badge.js";
import { Badge } from "../../../components/ui/badge.js";
import { useContextResolutionCases, usePackWorkbench } from "../../../hooks/use-operations.js";
import {
  contextTypeLabel,
  fieldLabel,
  formatBusinessValue,
  formatShortDateTime,
} from "../../manufacturing/utils.js";

function outcomeValue(value: unknown) {
  if (typeof value === "number") {
    return formatBusinessValue({ value, valueType: "number" });
  }
  return formatBusinessValue({ value });
}

export function GenericContextWorkspacePage() {
  const { contextId } = useParams();
  const workbench = usePackWorkbench(contextId);
  const resolutions = useContextResolutionCases(contextId);

  if (workbench.isLoading) {
    return (
      <ProductPage className="space-y-3 py-5">
        <LocalState kind="loading" title="正在读取业务上下文" />
        <div className="h-72 border border-border bg-surface" />
      </ProductPage>
    );
  }
  if (workbench.isError || !workbench.data) {
    return (
      <ProductPage className="py-5">
        <ProductHeader title="业务上下文" description="通用方案包工作台" />
        <div className="mt-4">
          <LocalState kind="error" title="业务上下文加载失败" detail="当前方案包可能未安装，或当前用户无权访问。" />
        </div>
      </ProductPage>
    );
  }
  const data = workbench.data;
  if (data.context.contextType === "sales_order" && contextId) {
    return <Navigate to={`/manufacturing/${encodeURIComponent(contextId)}`} replace />;
  }

  const resolutionCases = resolutions.data?.resolutionCases ?? [];
  return (
    <ProductPage>
      <ProductHeader
        title={data.context.businessKey}
        leading={(
          <Link to="/operations" className="mb-2 inline-flex items-center gap-1 text-xs text-text-muted hover:text-interactive">
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            返回运营视图
          </Link>
        )}
        badges={(
          <>
            <Badge variant="info">{contextTypeLabel(data.context.contextType)}</Badge>
            <ContextStatusBadge status={data.context.status} />
          </>
        )}
        description={`${data.pack.name} · ${data.pack.contextLabel}`}
        actions={<div className="text-right text-xs text-text-muted">最近更新 {formatShortDateTime(data.context.updatedAt)}</div>}
        footer={(
          <details className="inline-block">
            <summary className="cursor-pointer text-[11px] text-text-muted hover:text-text-secondary">方案包信息</summary>
            <span className="ml-2">{data.pack.name} · 版本 v{data.pack.version}</span>
          </details>
        )}
      />

      <SummaryStrip className="border-t-0 sm:grid-cols-3 lg:grid-cols-5 lg:divide-x lg:divide-y-0" label="业务摘要">
        <SummaryItem label="业务对象" value={data.stats.entities} />
        <SummaryItem label="证据" value={data.stats.evidence} />
        <SummaryItem label="规则评估" value={data.stats.ruleEvaluations} />
        <SummaryItem label="异常" value={data.stats.exceptions} />
        <SummaryItem label="后续结果" value={data.outcomes.length} />
      </SummaryStrip>

      <ProductSection className="mt-4">
        <SectionHeader
          title="业务线程"
          description="仅表示业务顺序，不代表因果关系。"
          meta={`${data.thread.length} 个阶段`}
        />
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
          {!data.thread.length && <div className="p-3"><LocalState kind="empty" title="暂无业务线程数据" compact /></div>}
        </div>
      </ProductSection>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <ProductSection>
          <SectionHeader title="规则评估" meta={`${data.rules.length} 条`} />
          <div className="divide-y divide-border">
            {data.rules.map((rule) => (
              <div key={rule.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span>{rule.label}</span>
                <Badge variant={rule.matched ? "warning" : "success"}>{rule.matched ? "命中" : "未命中"}</Badge>
              </div>
            ))}
            {!data.rules.length && <div className="p-3"><LocalState kind="empty" title="暂无规则评估" compact /></div>}
          </div>
        </ProductSection>

        <ProductSection>
          <SectionHeader title="异常" meta={`${data.exceptions.length} 个`} />
          <div className="divide-y divide-border">
            {data.exceptions.map((exception) => (
              <div key={exception.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{exception.label}</div>
                    <div className="mt-0.5 text-xs text-text-muted">{exception.summary}</div>
                  </div>
                  <SeverityBadge severity={exception.severity} />
                </div>
              </div>
            ))}
            {!data.exceptions.length && <div className="p-3"><LocalState kind="empty" title="暂无异常" compact /></div>}
          </div>
        </ProductSection>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <ProductSection>
          <SectionHeader title="治理状态" meta={`${resolutionCases.length} 项`} />
          <div className="divide-y divide-border">
            {resolutions.isPending && <div className="p-3"><LocalState kind="loading" title="正在读取治理信息" compact /></div>}
            {resolutions.isError && <div className="p-3"><LocalState kind="error" title="治理信息暂不可用" compact /></div>}
            {!resolutions.isPending && !resolutions.isError && resolutionCases.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-xs">
                <div>
                  <div>{item.title}</div>
                  <div className="mt-0.5 text-[11px] text-text-muted">{item.ownerRole || "负责人未记录"} · 更新 {formatShortDateTime(item.updatedAt)}</div>
                </div>
                <ResolutionStatusBadge status={item.status} />
              </div>
            ))}
            {!resolutions.isPending && !resolutions.isError && !resolutionCases.length && (
              <div className="p-3"><LocalState kind="empty" title="尚未进入治理" compact /></div>
            )}
          </div>
        </ProductSection>

        <ProductSection>
          <SectionHeader title="后续结果" meta={`${data.outcomes.length} 次测量`} />
          <div className="divide-y divide-border">
            {data.outcomes.map((outcome) => (
              <div key={outcome.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-xs">
                <div>
                  <div>后续测量 · {fieldLabel(outcome.current.field)} {outcomeValue(outcome.current.value)}</div>
                  <div className="mt-0.5 text-[11px] text-text-muted">测量时间 {formatShortDateTime(outcome.evaluatedAt)}</div>
                </div>
                <OutcomeStatusBadge status={outcome.status} />
              </div>
            ))}
            {!data.outcomes.length && <div className="p-3"><LocalState kind="empty" title="暂无后续结果测量" compact /></div>}
          </div>
        </ProductSection>
      </div>
    </ProductPage>
  );
}
