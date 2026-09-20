import { cn } from "../../../lib/utils.js";
import { severityLabel, severityTone } from "../../../lib/presentation.js";
import { governanceStageLabel } from "../exception-queue.js";
import type { ExceptionView, WorkbenchStats, WorkbenchView } from "../types.js";

const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const;

const SEVERITY_BAR_CLASS: Record<string, string> = {
  danger: "bg-danger",
  warning: "bg-warning",
  info: "bg-interactive",
  default: "bg-border-strong",
};

function SeverityDistribution({ exceptions }: { exceptions: ExceptionView[] }) {
  const total = exceptions.length;
  const rows = SEVERITY_ORDER.map((severity) => ({
    severity,
    label: severityLabel(severity),
    count: exceptions.filter((exception) => exception.severity === severity).length,
  })).filter((row) => row.count > 0);

  return (
    <div className="rounded-xl border border-border bg-surface shadow-card">
      <div className="border-b border-border/75 px-4 py-3">
        <h3 className="text-[13px] font-semibold">严重度分布</h3>
        <p className="mt-0.5 text-[11px] text-text-muted">共 {total} 个异常</p>
      </div>
      <ul className="space-y-2.5 px-4 py-3">
        {rows.length ? rows.map((row) => (
          <li key={row.severity}>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-text-secondary">{row.label}</span>
              <span className="tabular-nums text-text-muted">{row.count}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-subtle">
              <div
                className={cn("h-full rounded-full", SEVERITY_BAR_CLASS[severityTone(row.severity)] ?? SEVERITY_BAR_CLASS.default)}
                style={{ width: `${total ? Math.max((row.count / total) * 100, 6) : 0}%` }}
              />
            </div>
          </li>
        )) : <li className="text-[11px] text-text-muted">当前没有异常。</li>}
      </ul>
    </div>
  );
}

function PendingGovernance({
  exceptions,
  onOpen,
}: {
  exceptions: ExceptionView[];
  onOpen: (exception: ExceptionView) => void;
}) {
  const pending = exceptions
    .filter((exception) => exception.governanceStage === "not_started" || exception.governanceStage === "review")
    .sort((left, right) => {
      const rank = { critical: 3, high: 2, medium: 1, low: 0 } as Record<string, number>;
      return (rank[right.severity] ?? 0) - (rank[left.severity] ?? 0);
    });

  return (
    <div className="rounded-xl border border-border bg-surface shadow-card">
      <div className="border-b border-border/75 px-4 py-3">
        <h3 className="text-[13px] font-semibold">等待治理</h3>
        <p className="mt-0.5 text-[11px] text-text-muted">
          {pending.length ? `${pending.length} 个异常尚未进入治理流程` : "全部异常已进入治理流程"}
        </p>
      </div>
      {pending.length ? (
        <ul className="divide-y divide-border/70">
          {pending.slice(0, 5).map((exception) => (
            <li key={exception.id}>
              <button
                type="button"
                data-testid="pending-exception-item"
                className="flex w-full items-start justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-subtle/70"
                onClick={() => onOpen(exception)}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-medium text-text-primary hover:text-interactive">{exception.label}</span>
                  <span className="mt-0.5 block text-[11px] text-text-muted">{governanceStageLabel(exception.governanceStage)}</span>
                </span>
                <span className={cn(
                  "mt-0.5 size-1.5 shrink-0 rounded-full",
                  SEVERITY_BAR_CLASS[severityTone(exception.severity)] ?? SEVERITY_BAR_CLASS.default,
                )} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-3 text-[11px] text-text-muted">没有待治理的异常。</p>
      )}
    </div>
  );
}

function RuleEvaluationSummary({ rules }: { rules: WorkbenchView["rules"] }) {
  const matched = rules.filter((rule) => rule.matched);
  const unmatched = rules.filter((rule) => !rule.matched);
  return (
    <div className="rounded-xl border border-border bg-surface shadow-card">
      <div className="border-b border-border/75 px-4 py-3">
        <h3 className="text-[13px] font-semibold">规则评估</h3>
        <p className="mt-0.5 text-[11px] text-text-muted">
          共 {rules.length} 条 · 命中 <span className="text-danger">{matched.length}</span> · 未命中 {unmatched.length}
        </p>
      </div>
      {matched.length ? (
        <ul className="divide-y divide-border/70">
          {matched.slice(0, 5).map((rule) => (
            <li key={rule.id} className="px-4 py-2.5">
              <p className="truncate text-[12px] font-medium text-text-primary">{rule.label}</p>
              <p className="mt-0.5 truncate text-[11px] text-text-muted">{rule.code}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-3 text-[11px] text-text-muted">当前没有命中的规则。</p>
      )}
    </div>
  );
}

/** 右侧洞察栏：严重度分布 / 等待治理 / 规则评估，均为后端真实数据 */
export function ContextInsightsPanel({
  view,
  onOpenException,
}: {
  view: WorkbenchView;
  onOpenException: (exception: ExceptionView) => void;
}) {
  return (
    <aside
      data-testid="context-insights"
      aria-label="上下文洞察"
      className="space-y-3 xl:sticky xl:top-[72px] xl:self-start"
    >
      <SeverityDistribution exceptions={view.exceptions} />
      <PendingGovernance exceptions={view.exceptions} onOpen={onOpenException} />
      <RuleEvaluationSummary rules={view.rules} />
    </aside>
  );
}
