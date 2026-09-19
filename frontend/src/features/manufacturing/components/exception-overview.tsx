import { AlertTriangle, ListChecks } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Badge } from "../../../components/ui/badge.js";
import { useGroundedExplanation } from "../../../hooks/use-manufacturing.js";
import type { ExceptionView, RuleView, ThreadStage } from "../types.js";
import { formatMetricValue, metricLabel } from "../utils.js";

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
    <div className="space-y-5">
      <section className="max-w-4xl">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <div>
            <h3 className="text-sm font-semibold">核心差异</h3>
            <p className="mt-1 text-sm leading-6 text-text-secondary">{exception.summary}</p>
          </div>
        </div>
      </section>

      {metrics.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold">当前事实</h3>
          <dl className="mt-2 grid gap-x-6 gap-y-3 border-y border-border py-3 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map(([key, value]) => (
              <div key={key} className="min-w-0">
                <dt className="text-xs text-text-muted">{metricLabel(key)}</dt>
                <dd className="mt-0.5 text-lg font-semibold">{formatMetricValue(value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <ListChecks className="size-4 text-text-muted" aria-hidden="true" />
            待核实内容
          </h3>
          {questionsLoading ? (
            <p className="mt-2 text-sm text-text-muted">正在读取待核实事项</p>
          ) : questionsError ? (
            <p className="mt-2 text-sm text-text-muted">待核实事项暂不可用</p>
          ) : questions.length ? (
            <ul className="mt-2 space-y-1.5 text-sm text-text-secondary">
              {questions.map((question) => <li key={question}>{question}</li>)}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-text-muted">暂无明确待核实事项</p>
          )}
        </div>
        <div>
          <h3 className="text-sm font-semibold">相关业务阶段</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {exception.stageKeys.map((stage) => (
              <Badge key={stage} variant="info">{stages.find((item) => item.key === stage)?.label ?? stage}</Badge>
            ))}
          </div>
        </div>
      </section>

      {relatedRules.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold">相关规则评估</h3>
          <div className="mt-2 divide-y divide-border border-y border-border">
            {relatedRules.map((rule) => (
              <div key={rule.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                <span>{rule.label}</span>
                <Badge variant={rule.matched ? "warning" : "success"}>{rule.statusLabel}</Badge>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <span className="text-xs text-text-muted">继续核对</span>
        <Link className="text-sm font-medium text-interactive hover:underline" to={`${base}/evidence${suffix}`}>
          查看证据
        </Link>
        <Link className="text-sm font-medium text-interactive hover:underline" to={`${base}/analysis${suffix}`}>
          查看分析
        </Link>
      </section>
    </div>
  );
}
