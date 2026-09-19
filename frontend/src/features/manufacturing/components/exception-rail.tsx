import { Badge } from "../../../components/ui/badge.js";
import { cn } from "../../../lib/utils.js";
import type { ExceptionView } from "../types.js";
import { exceptionStatusLabel, formatMetricValue, metricLabel } from "../utils.js";

const severityLabels: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "严重",
};

const severityOrder: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function ExceptionRail({
  exceptions,
  selectedExceptionId,
  onSelect,
}: {
  exceptions: ExceptionView[];
  selectedExceptionId?: string;
  onSelect: (exception: ExceptionView) => void;
}) {
  const sortedExceptions = exceptions
    .map((exception, index) => ({ exception, index }))
    .sort((left, right) =>
      (severityOrder[right.exception.severity] ?? 0) - (severityOrder[left.exception.severity] ?? 0) ||
      left.index - right.index,
    )
    .map((item) => item.exception);
  return (
    <aside className="border-b border-border bg-surface lg:border-b-0 lg:border-r" aria-labelledby="exception-rail-title">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 id="exception-rail-title" className="text-sm font-semibold">当前异常</h2>
        <Badge>{exceptions.length}</Badge>
      </div>
      <div className="grid gap-0 sm:grid-cols-2 lg:grid-cols-1" role="list">
        {sortedExceptions.map((exception) => {
          const firstMetric = Object.entries(exception.metrics ?? {})[0];
          const active = exception.id === selectedExceptionId;
          return (
            <div key={exception.id} role="listitem">
              <button
                type="button"
                data-testid="exception-item"
                aria-current={active ? "true" : undefined}
                onClick={() => onSelect(exception)}
                className={cn(
                  "w-full border-b border-l-2 border-l-transparent border-border px-4 py-3 text-left transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-interactive/40",
                  active && "border-l-interactive bg-interactive/5",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-sm font-medium leading-5">{exception.label}</span>
                  <Badge variant={exception.severity === "high" || exception.severity === "critical" ? "danger" : "warning"}>
                    {severityLabels[exception.severity] ?? exception.severity}
                  </Badge>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                  <span>{exceptionStatusLabel(exception.status)}</span>
                  <span>{exception.evidenceCount} 条证据</span>
                  {firstMetric && <span>{metricLabel(firstMetric[0])} {formatMetricValue(firstMetric[1])}</span>}
                </div>
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
