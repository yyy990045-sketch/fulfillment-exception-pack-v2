import { AlertTriangle, ListChecks } from "lucide-react";
import { Badge } from "../../../components/ui/badge.js";
import type { ExceptionView, RuleView, ThreadStage } from "../types.js";
import { formatMetricValue, metricLabel } from "../utils.js";

export function ExceptionOverview({
  exception,
  rules,
  stages,
}: {
  exception: ExceptionView;
  rules: RuleView[];
  stages: ThreadStage[];
}) {
  const relatedRules = rules.filter((rule) => rule.stageKeys.some((stage) => exception.stageKeys.includes(stage)));
  const metrics = Object.entries(exception.metrics ?? {});
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
          <p className="mt-1 text-sm text-text-secondary">
            需要结合 Evidence 确认业务事实，当前页面不推断责任或因果关系。
          </p>
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
    </div>
  );
}
