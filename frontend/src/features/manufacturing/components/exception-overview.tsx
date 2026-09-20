import { AlertTriangle, ArrowRight, ListChecks } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { LocalState, ProductSection, SectionHeader } from "../../../components/product/page-layout.js";
import { Badge, StatusDotBadge } from "../../../components/ui/badge.js";
import { useGroundedExplanation } from "../../../hooks/use-manufacturing.js";
import { cn } from "../../../lib/utils.js";
import type { ExceptionView, RuleView, ThreadStage } from "../types.js";
import { exceptionStatusLabel, formatBusinessValue, formatShortDateTime } from "../utils.js";

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
  // 相关业务事实取自数字线程中该异常关联的阶段，避免与页头指标重复
  const relatedStages = stages.filter((stage) => exception.stageKeys.includes(stage.key));
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
              <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-muted">
                <span>证据 {exception.evidenceCount} 条</span>
                <span>来源系统 {exception.sourceSystemCount} 个</span>
                <span>检测于 {formatShortDateTime(exception.lastDetectedAt || exception.createdAt)}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="border-t border-border/70 pt-4">
          <h2 className="text-[14px] font-semibold">相关业务事实</h2>
          <p className="mt-0.5 text-[11px] text-text-muted">来自履约数字线程中与该异常关联的业务阶段</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {relatedStages.map((stage) => (
              <div key={stage.key} className="rounded-lg border border-border/80 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[12px] font-medium">
                    <span
                      className={cn("size-1.5 rounded-full", stage.state === "exception" ? "bg-warning" : "bg-border-strong")}
                      aria-label={stage.state === "exception" ? "存在异常" : "正常"}
                    />
                    {stage.label}
                  </span>
                  <span className="truncate text-[11px] text-text-muted">{stage.businessKey}</span>
                </div>
                {stage.facts.length ? (
                  <dl className="mt-2.5 space-y-1.5">
                    {stage.facts.slice(0, 4).map((fact) => (
                      <div key={fact.key} className="flex items-baseline justify-between gap-3 text-[12px]">
                        <dt className="min-w-0 truncate text-text-muted">{fact.label}</dt>
                        <dd className="shrink-0 font-semibold tabular-nums">{formatBusinessValue(fact)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="mt-2 text-[11px] text-text-muted">该阶段暂无线索事实。</p>
                )}
              </div>
            ))}
            {!relatedStages.length && <div className="text-sm text-text-muted">该异常暂未关联业务阶段。</div>}
          </div>
        </section>

        <section className="border-t border-border/70 pt-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[14px] font-semibold">相关规则评估</h2>
            <span className="text-[11px] text-text-muted">{relatedRules.length} 条</span>
          </div>
          <div className="mt-2 divide-y divide-border/60">
            {relatedRules.map((rule) => (
              <div key={rule.id} className="flex items-center justify-between gap-4 py-2.5 text-[13px]">
                <span className="min-w-0 truncate">{rule.label}</span>
                <StatusDotBadge variant={rule.matched ? "warning" : "success"}>{rule.statusLabel}</StatusDotBadge>
              </div>
            ))}
            {!relatedRules.length && <div className="py-3"><LocalState kind="empty" title="暂无相关规则评估" compact /></div>}
          </div>
        </section>
      </div>

      <ProductSection>
        <div className="divide-y divide-border/70">
          <section className="p-4">
            <h2 className="text-[14px] font-semibold">待核实内容</h2>
            {questionsLoading ? (
              <div className="mt-3"><LocalState kind="loading" title="正在读取待核实事项" compact /></div>
            ) : questionsError ? (
              <div className="mt-3"><LocalState kind="error" title="待核实事项暂不可用" compact /></div>
            ) : questions.length ? (
              <ul className="mt-3 space-y-2.5">
                {questions.map((question) => (
                  <li key={question} className="flex items-start gap-2 text-[12px] leading-5 text-text-secondary">
                    <ListChecks className="mt-0.5 size-3.5 shrink-0 text-text-muted" aria-hidden="true" />
                    {question}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-3 text-[12px] text-text-muted">暂无明确待核实事项</p>}
          </section>

          <section className="p-4">
            <h2 className="text-[14px] font-semibold">相关业务阶段</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {exception.stageKeys.map((stage) => (
                <Badge key={stage} variant="info">{stages.find((item) => item.key === stage)?.label ?? stage}</Badge>
              ))}
            </div>
          </section>

          <section className="p-4">
            <h2 className="text-[14px] font-semibold">当前状态</h2>
            <div className="mt-3"><Badge>{exceptionStatusLabel(exception.status)}</Badge></div>
            <p className="mt-2 text-[12px] leading-5 text-text-muted">
              当前记录仍需按任务工作面继续核对事实、分析原因并选择治理方案。
            </p>
          </section>

          <section>
            <h2 className="px-4 pt-4 text-[14px] font-semibold">继续处理</h2>
            <div className="mt-2 divide-y divide-border/70">
              <Link className="flex items-center justify-between px-4 py-3 text-[13px] hover:bg-surface-subtle" to={`${base}/evidence${suffix}`}>
              查看证据 <ArrowRight className="size-3.5 text-text-muted" aria-hidden="true" />
              </Link>
              <Link className="flex items-center justify-between px-4 py-3 text-[13px] hover:bg-surface-subtle" to={`${base}/analysis${suffix}`}>
              查看分析 <ArrowRight className="size-3.5 text-text-muted" aria-hidden="true" />
              </Link>
            </div>
          </section>
        </div>
      </ProductSection>
    </div>
  );
}
