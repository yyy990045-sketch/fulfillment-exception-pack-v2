import { AlertTriangle, ArrowRight, ListChecks } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { LocalState, ProductSection, SectionHeader } from "../../../components/product/page-layout.js";
import { Badge } from "../../../components/ui/badge.js";
import { useGroundedExplanation } from "../../../hooks/use-manufacturing.js";
import type { ExceptionView, RuleView, ThreadStage } from "../types.js";
import { exceptionStatusLabel, formatMetricValue, metricLabel } from "../utils.js";

export function ExceptionOverview({
  contextId,
  exception,
  rules,
  stages,
}: {
  contextId: string;
  exception: ExceptionView;
  rules: RuleView[];
  stages: ThreadStage[];
}) {
  const relatedRules = rules.filter((rule) => rule.stageKeys.some((stage) => exception.stageKeys.includes(stage)));
  const metrics = Object.entries(exception.metrics ?? {});
  const explanationQuery = useGroundedExplanation(contextId, exception.id);
  const explanation = explanationQuery.detail.data?.explanation;
  const questions = (explanation?.output.questionsToVerify ?? []).slice(0, 3);
  const questionsLoading = explanationQuery.list.isLoading ||
    Boolean(explanationQuery.latest && explanationQuery.detail.isLoading);
  const questionsError = explanationQuery.list.isError || explanationQuery.detail.isError;
  const [searchParams] = useSearchParams();
  const base = `/manufacturing/${encodeURIComponent(contextId)}/exceptions/${encodeURIComponent(exception.id)}`;
  const suffix = searchParams.toString() ? `?${searchParams.toString()}` : "";

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
      <div className="space-y-4">
        <section className="rounded-lg border border-border/85 bg-surface p-5">
          <div className="flex items-start gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-warning/10 text-warning">
              <AlertTriangle className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[14px] font-semibold">核心差异</h2>
              <p className="mt-1 max-w-[72ch] text-[13px] leading-6 text-text-secondary">{exception.summary}</p>
            </div>
          </div>
          {metrics.length > 0 && (
            <dl className="mt-5 grid gap-px overflow-hidden rounded-lg border border-border/80 bg-border/70 sm:grid-cols-2 lg:grid-cols-3">
              {metrics.map(([key, value], index) => (
                <div key={key} className="bg-surface px-4 py-3">
                  <dt className="text-[11px] text-text-muted">{metricLabel(key)}</dt>
                  <dd className={index === 0 ? "mt-1 text-[22px] font-semibold tabular-nums" : "mt-1 text-[18px] font-semibold tabular-nums"}>
                    {formatMetricValue(value)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        <ProductSection>
          <SectionHeader title="当前事实" description="来自当前异常记录与规则评估" />
          <dl className="grid gap-px bg-border/60 sm:grid-cols-2">
            {metrics.map(([key, value]) => (
              <div key={key} className="bg-surface px-4 py-3">
                <dt className="text-[11px] text-text-muted">{metricLabel(key)}</dt>
                <dd className="mt-1 text-[15px] font-semibold tabular-nums">{formatMetricValue(value)}</dd>
              </div>
            ))}
            {!metrics.length && <div className="bg-surface p-4 text-sm text-text-muted">暂无结构化事实。</div>}
          </dl>
        </ProductSection>

        <ProductSection>
          <SectionHeader title="相关规则评估" meta={`${relatedRules.length} 条`} />
          <div className="divide-y divide-border/70">
            {relatedRules.map((rule) => (
              <div key={rule.id} className="flex items-center justify-between gap-4 px-4 py-2.5 text-[13px]">
                <span>{rule.label}</span>
                <Badge variant={rule.matched ? "warning" : "success"}>{rule.statusLabel}</Badge>
              </div>
            ))}
            {!relatedRules.length && <div className="p-4"><LocalState kind="empty" title="暂无相关规则评估" compact /></div>}
          </div>
        </ProductSection>
      </div>

      <div className="space-y-4">
        <ProductSection>
          <SectionHeader title="待核实内容" />
          <div className="p-4">
            {questionsLoading ? (
              <LocalState kind="loading" title="正在读取待核实事项" compact />
            ) : questionsError ? (
              <LocalState kind="error" title="待核实事项暂不可用" compact />
            ) : questions.length ? (
              <ul className="space-y-2.5">
                {questions.map((question) => (
                  <li key={question} className="flex items-start gap-2 text-[12px] leading-5 text-text-secondary">
                    <ListChecks className="mt-0.5 size-3.5 shrink-0 text-text-muted" aria-hidden="true" />
                    {question}
                  </li>
                ))}
              </ul>
            ) : <p className="text-[12px] text-text-muted">暂无明确待核实事项</p>}
          </div>
        </ProductSection>

        <ProductSection>
          <SectionHeader title="相关业务阶段" />
          <div className="flex flex-wrap gap-2 p-4">
            {exception.stageKeys.map((stage) => (
              <Badge key={stage} variant="info">{stages.find((item) => item.key === stage)?.label ?? stage}</Badge>
            ))}
          </div>
        </ProductSection>

        <ProductSection>
          <SectionHeader title="当前状态" />
          <div className="p-4">
            <Badge>{exceptionStatusLabel(exception.status)}</Badge>
            <p className="mt-2 text-[12px] leading-5 text-text-muted">
              当前记录仍需按任务工作面继续核对事实、分析原因并选择治理方案。
            </p>
          </div>
        </ProductSection>

        <ProductSection>
          <SectionHeader title="继续处理" />
          <div className="divide-y divide-border/70">
            <Link className="flex items-center justify-between px-4 py-3 text-[13px] hover:bg-surface-subtle" to={`${base}/evidence${suffix}`}>
              查看证据 <ArrowRight className="size-3.5 text-text-muted" aria-hidden="true" />
            </Link>
            <Link className="flex items-center justify-between px-4 py-3 text-[13px] hover:bg-surface-subtle" to={`${base}/analysis${suffix}`}>
              查看分析 <ArrowRight className="size-3.5 text-text-muted" aria-hidden="true" />
            </Link>
          </div>
        </ProductSection>
      </div>
    </div>
  );
}
