import { Search, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { LocalState, ProductSection, SectionHeader } from "../../../components/product/page-layout.js";
import { SeverityBadge } from "../../../components/product/status-badge.js";
import { Button } from "../../../components/ui/button.js";
import { severityLabel } from "../../../lib/presentation.js";
import { cn } from "../../../lib/utils.js";
import {
  exceptionQueueOptions,
  filterAndSortExceptions,
  governanceStageLabel,
  primaryExceptionDifference,
  type ExceptionQueueFilters,
} from "../exception-queue.js";
import type { ExceptionView, ThreadStage } from "../types.js";
import { exceptionStatusLabel, formatShortDateTime } from "../utils.js";

function FilterSelect({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  className?: string;
}) {
  return (
    <label className={cn("min-w-0 shrink-0 space-y-1 text-[11px] text-text-muted", className)}>
      <span className="block">{label}</span>
      <select
        aria-label={label}
        className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-[12px] text-text-secondary shadow-[0_1px_2px_rgba(28,27,24,0.04)] outline-none transition-colors focus:border-interactive focus:ring-[3px] focus:ring-interactive/15"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">全部</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

export function ExceptionQueueTable({
  exceptions,
  stages,
  onOpen,
}: {
  exceptions: ExceptionView[];
  stages: ThreadStage[];
  onOpen: (exception: ExceptionView) => void;
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
  const options = exceptionQueueOptions(exceptions, stages);
  const results = filterAndSortExceptions(exceptions, filters);
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
    <ProductSection>
      <SectionHeader
        title="异常"
        description="定位需要进入治理的异常，再打开独立异常记录。"
        meta={`${results.length} / ${exceptions.length}`}
      />
      <div className="flex flex-wrap items-end gap-3 border-b border-border/60 bg-surface-subtle/45 p-3">
        <label className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-text-muted" aria-hidden="true" />
          <input
            aria-label="搜索异常"
            className="h-9 w-full rounded-md border border-border-strong bg-surface pl-8 pr-8 text-[12px] text-text-primary shadow-[0_1px_2px_rgba(28,27,24,0.04)] outline-none transition-colors placeholder:text-text-muted focus:border-interactive focus:ring-[3px] focus:ring-interactive/15"
            value={filters.query}
            onChange={(event) => updateFilter("q", event.target.value)}
            placeholder="搜索异常、差异或状态"
          />
          {filters.query && (
            <button
              type="button"
              aria-label="清除搜索"
              className="absolute right-2 top-2 flex size-5 items-center justify-center text-text-muted hover:text-text-primary"
              onClick={() => updateFilter("q", "")}
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </label>
        <FilterSelect
          label="严重程度"
          className="w-[120px]"
          value={filters.severity}
          onChange={(value) => updateFilter("severity", value)}
          options={options.severities.map((value) => ({ value, label: severityLabel(value) }))}
        />
        <FilterSelect
          label="异常状态"
          className="w-[130px]"
          value={filters.status}
          onChange={(value) => updateFilter("status", value)}
          options={options.statuses.map((value) => ({ value, label: exceptionStatusLabel(value) }))}
        />
        <FilterSelect
          label="业务阶段"
          className="w-[140px]"
          value={filters.stageKey}
          onChange={(value) => updateFilter("stageKey", value)}
          options={options.stages}
        />
        <FilterSelect
          label="处理阶段"
          className="w-[140px]"
          value={filters.governanceStage}
          onChange={(value) => updateFilter("governanceStage", value)}
          options={options.governanceStages}
        />
        <div className="ml-auto flex items-end gap-2">
          <label className="flex h-8 items-center gap-1.5 whitespace-nowrap text-xs text-text-secondary">
            <input
              type="checkbox"
              className="size-3.5 accent-[var(--color-interactive)]"
              checked={filters.unresolvedFirst}
              onChange={(event) => updateFilter("unresolvedFirst", event.target.checked ? true : false)}
            />
            未处理优先
          </label>
          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>清除筛选</Button>
          )}
        </div>
      </div>

      {results.length === 0 ? (
        <div className="p-3"><LocalState kind="no-results" title="没有匹配当前条件的异常" compact /></div>
      ) : (
        <div className="overflow-x-auto">
        <table data-testid="exception-queue-table" className="w-full min-w-[1080px] text-left text-[13px]">
            <thead className="bg-surface-subtle/60 text-[11px] font-medium text-text-muted">
              <tr>
                <th className="border-b border-border/70 px-4 py-2.5 font-medium">异常</th>
                <th className="border-b border-border/70 px-4 py-2.5 font-medium">等级</th>
                <th className="border-b border-border/70 px-4 py-2.5 font-medium">状态</th>
                <th className="border-b border-border/70 px-4 py-2.5 font-medium">核心差异</th>
                <th className="border-b border-border/70 px-4 py-2.5 font-medium">处理阶段</th>
                <th className="border-b border-border/70 px-4 py-2.5 text-right font-medium">证据</th>
                <th className="border-b border-border/70 px-4 py-2.5 text-right font-medium">来源系统</th>
                <th className="border-b border-border/70 px-4 py-2.5 font-medium">最近更新</th>
              </tr>
            </thead>
        <tbody className="divide-y divide-border/45">
              {results.map(({ exception, governanceStage }) => (
                <tr
                  key={exception.id}
                  className="group h-[51px] cursor-pointer transition-colors duration-150 hover:bg-interactive/[0.03] focus-within:bg-interactive/[0.05]"
                  onClick={() => onOpen(exception)}
                >
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      data-testid="exception-item"
                      className="text-left text-[14px] font-semibold text-text-primary transition-colors group-hover:text-interactive focus-visible:rounded-sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpen(exception);
                      }}
                    >
                      {exception.label}
                    </button>
                  </td>
                  <td className="px-4 py-3"><SeverityBadge severity={exception.severity} className="px-1.5 py-0 text-[10px]" /></td>
                  <td className="px-4 py-3 text-text-secondary">{exceptionStatusLabel(exception.status)}</td>
                  <td className="px-4 py-3 text-text-secondary">{primaryExceptionDifference(exception)}</td>
                  <td className="px-4 py-3 text-text-secondary">{governanceStageLabel(governanceStage)}</td>
                  <td className="px-4 py-3 text-right text-text-secondary tabular-nums">{exception.evidenceCount}</td>
                  <td className="px-4 py-3 text-right text-text-secondary tabular-nums">{exception.sourceSystemCount}</td>
                  <td className="px-4 py-3 text-text-muted tabular-nums">
                    {formatShortDateTime(exception.lastDetectedAt || exception.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ProductSection>
  );
}
