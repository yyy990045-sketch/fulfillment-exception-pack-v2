import { Badge } from "../../../components/ui/badge.js";
import { exceptionStatusLabel, formatMetricValue, metricLabel } from "../utils.js";
import type { ExceptionView, WorkbenchView } from "../types.js";
import { ExceptionDetailsSheet } from "./exception-details-sheet.js";

const severityLabels: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "严重",
};

export function SelectedExceptionHeader({
  exception,
  contextId,
  context,
}: {
  exception: ExceptionView;
  contextId: string;
  context: WorkbenchView["context"];
}) {
  const metrics = Object.entries(exception.metrics ?? {}).slice(0, 3);
  return (
    <header data-testid="selected-exception-header" className="border-b border-border px-4 py-3 lg:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">{exception.label}</h2>
          <Badge variant={exception.severity === "high" || exception.severity === "critical" ? "danger" : "warning"}>
            {severityLabels[exception.severity] ?? exception.severity}
          </Badge>
          <Badge>{exceptionStatusLabel(exception.status)}</Badge>
        </div>
        <ExceptionDetailsSheet contextId={contextId} exception={exception} context={context} />
      </div>
      {metrics.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-text-muted">
          {metrics.map(([key, value]) => (
            <span key={key}>
              {metricLabel(key)} <strong className="font-semibold text-text-primary">{formatMetricValue(value)}</strong>
            </span>
          ))}
        </div>
      )}
    </header>
  );
}
