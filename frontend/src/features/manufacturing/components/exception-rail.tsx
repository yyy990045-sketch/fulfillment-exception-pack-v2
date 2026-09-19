import { Search, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Badge } from "../../../components/ui/badge.js";
import { Button } from "../../../components/ui/button.js";
import { cn } from "../../../lib/utils.js";
import {
  exceptionQueueOptions,
  filterAndSortExceptions,
  governanceStageLabel,
  primaryExceptionDifference,
  type ExceptionQueueFilters,
} from "../exception-queue.js";
import type { ExceptionView, ResolutionCaseSummaryView, ThreadStage } from "../types.js";
import { exceptionStatusLabel, formatShortDateTime } from "../utils.js";

const severityLabels: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "严重",
};

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="min-w-0 space-y-1 text-[11px] text-text-muted">
      <span>{label}</span>
      <select
        aria-label={label}
        className="h-8 w-full rounded-md border border-border-strong bg-surface px-2 text-xs text-text-secondary"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">全部</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

export function ExceptionRail({
  exceptions,
  resolutionCases,
  stages,
  selectedExceptionId,
  onSelect,
}: {
  exceptions: ExceptionView[];
  resolutionCases: ResolutionCaseSummaryView[];
  stages: ThreadStage[];
  selectedExceptionId?: string;
  onSelect: (exception: ExceptionView) => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters: ExceptionQueueFilters = {
    query: searchParams.get("q") ?? "",
    severity: searchParams.get("severity") ?? "",
    status: searchParams.get("status") ?? "",
    stageKey: searchParams.get("stageKey") ?? "",
    governanceStage: searchParams.get("governanceStage") ?? "",
    unresolvedFirst: searchParams.get("unresolvedFirst") !== "false",
  };
  const options = exceptionQueueOptions(exceptions, stages, resolutionCases);
  const results = filterAndSortExceptions(exceptions, resolutionCases, filters);
  const activeFilterCount = [
    filters.query,
    filters.severity,
    filters.status,
    filters.stageKey,
    filters.governanceStage,
  ].filter(Boolean).length;

  const updateFilter = (key: string, value: string | boolean) => {
    const next = new URLSearchParams(searchParams);
    if (value === "" || value === true) next.delete(key);
    else next.set(key, String(value));
    setSearchParams(next, { replace: true });
  };
  const clearFilters = () => {
    const next = new URLSearchParams(searchParams);
    for (const key of ["q", "severity", "status", "stageKey", "governanceStage", "unresolvedFirst"]) next.delete(key);
    setSearchParams(next, { replace: true });
  };

  return (
    <aside
      className="border-b border-border bg-surface lg:sticky lg:top-14 lg:max-h-[calc(100vh-3.5rem)] lg:overflow-y-auto lg:border-b-0 lg:border-r"
      aria-labelledby="exception-rail-title"
    >
      <div className="border-b border-border px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="exception-rail-title" className="text-sm font-semibold">异常队列</h2>
          <span className="text-xs text-text-muted">{results.length} / {exceptions.length}</span>
        </div>
        <label className="relative mt-2 block">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-text-muted" aria-hidden="true" />
          <input
            aria-label="搜索异常"
            className="h-8 w-full rounded-md border border-border-strong bg-surface pl-8 pr-8 text-xs text-text-primary placeholder:text-text-muted"
            value={filters.query}
            onChange={(event) => updateFilter("q", event.target.value)}
            placeholder="搜索异常、差异或状态"
          />
          {filters.query && (
            <button
              type="button"
              aria-label="清除搜索"
              className="absolute right-2 top-1.5 flex size-5 items-center justify-center text-text-muted hover:text-text-primary"
              onClick={() => updateFilter("q", "")}
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </label>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <FilterSelect
            label="严重程度"
            value={filters.severity}
            onChange={(value) => updateFilter("severity", value)}
            options={options.severities.map((value) => ({ value, label: severityLabels[value] ?? value }))}
          />
          <FilterSelect
            label="异常状态"
            value={filters.status}
            onChange={(value) => updateFilter("status", value)}
            options={options.statuses.map((value) => ({ value, label: exceptionStatusLabel(value) }))}
          />
          <FilterSelect
            label="业务阶段"
            value={filters.stageKey}
            onChange={(value) => updateFilter("stageKey", value)}
            options={options.stages}
          />
          <FilterSelect
            label="处理阶段"
            value={filters.governanceStage}
            onChange={(value) => updateFilter("governanceStage", value)}
            options={options.governanceStages}
          />
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 text-xs text-text-secondary">
            <input
              type="checkbox"
              className="size-3.5 accent-[var(--color-interactive)]"
              checked={filters.unresolvedFirst}
              onChange={(event) => updateFilter("unresolvedFirst", event.target.checked ? true : false)}
            />
            未处理优先
          </label>
          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={clearFilters}>
              清除筛选
            </Button>
          )}
        </div>
      </div>

      {results.length === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-text-muted">
          没有匹配当前条件的异常
        </div>
      ) : (
        <div role="list">
          {results.map(({ exception, governanceStage }) => {
            const active = exception.id === selectedExceptionId;
            return (
              <div key={exception.id} role="listitem">
                <button
                  type="button"
                  data-testid="exception-item"
                  aria-current={active ? "true" : undefined}
                  onClick={() => onSelect(exception)}
                  className={cn(
                    "w-full border-b border-l-2 border-l-transparent border-border px-3 py-2 text-left transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-interactive/40",
                    active && "border-l-interactive bg-interactive/5",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium leading-5">{exception.label}</span>
                    <Badge variant={exception.severity === "high" || exception.severity === "critical" ? "danger" : "warning"}>
                      {severityLabels[exception.severity] ?? exception.severity}
                    </Badge>
                  </div>
                  <div className="mt-1 truncate text-xs text-text-secondary">
                    {primaryExceptionDifference(exception)}
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-text-muted">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span>{exceptionStatusLabel(exception.status)}</span>
                      <span aria-hidden="true">·</span>
                      <span className="truncate">{governanceStageLabel(governanceStage)}</span>
                    </span>
                    <time className="shrink-0">{formatShortDateTime(exception.lastDetectedAt || exception.createdAt)}</time>
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
