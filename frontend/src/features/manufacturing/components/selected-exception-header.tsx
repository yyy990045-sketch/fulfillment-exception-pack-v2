import { Badge } from "../../../components/ui/badge.js";
import { exceptionStatusLabel } from "../utils.js";
import type { ExceptionView } from "../types.js";

const severityLabels: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "严重",
};

export function SelectedExceptionHeader({ exception }: { exception: ExceptionView }) {
  return (
    <header className="border-b border-border px-4 py-3 lg:px-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">{exception.label}</h2>
        <Badge variant={exception.severity === "high" || exception.severity === "critical" ? "danger" : "warning"}>
          {severityLabels[exception.severity] ?? exception.severity}
        </Badge>
        <Badge>{exceptionStatusLabel(exception.status)}</Badge>
      </div>
      <p className="mt-1 max-w-4xl text-sm text-text-secondary">{exception.summary}</p>
      <p className="mt-1 text-xs text-text-muted">{exception.evidenceCount} 条证据 · {exception.sourceSystemCount} 个来源系统</p>
    </header>
  );
}
