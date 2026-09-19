import { Search, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Button } from "../../../components/ui/button.js";
import { cn } from "../../../lib/utils.js";
import type { EvidenceBundleView, EvidenceItem } from "../types.js";
import { evidenceRoleLabels, fieldLabel, formatBusinessValue, formatShortDateTime, sourceSystemLabel } from "../utils.js";

function sourceSystemName(bundle: EvidenceBundleView, item: EvidenceItem) {
  const system = bundle.sourceSystems.find((candidate) => candidate.id === item.sourceSystemId);
  return system ? sourceSystemLabel(system.systemType, system.name) : "业务系统";
}

export function EvidenceWorkspace({
  bundle,
  selectedEvidenceId,
  onSelect,
}: {
  bundle: EvidenceBundleView;
  selectedEvidenceId?: string;
  onSelect: (evidence: EvidenceItem) => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("eq") ?? "";
  const source = searchParams.get("esource") ?? "";
  const role = searchParams.get("erole") ?? "";

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };
  const clear = () => {
    const next = new URLSearchParams(searchParams);
    for (const key of ["eq", "esource", "erole"]) next.delete(key);
    setSearchParams(next, { replace: true });
  };

  if (!bundle.evidence.length) {
    return <div className="py-10 text-sm text-text-muted">暂无相关证据</div>;
  }

  const sourceOptions = bundle.sourceSystems.map((system) => ({
    value: system.id,
    label: sourceSystemLabel(system.systemType, system.name),
  }));
  const results = bundle.evidence.filter((item) => {
    if (source && item.sourceSystemId !== source) return false;
    if (role && item.role !== role) return false;
    if (!query.trim()) return true;
    const haystack = [
      fieldLabel(item.field),
      formatBusinessValue(item),
      item.quote,
      sourceSystemName(bundle, item),
      evidenceRoleLabels[item.role],
    ].join(" ").toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });
  const activeFilters = Boolean(query || source || role);

  return (
    <div>
      <div className="border-b border-border pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-text-muted" aria-hidden="true" />
            <input
              aria-label="搜索证据"
              className="h-8 w-full rounded-md border border-border-strong bg-surface pl-8 pr-8 text-xs text-text-primary placeholder:text-text-muted"
              value={query}
              onChange={(event) => update("eq", event.target.value)}
              placeholder="搜索字段、值或引用原文"
            />
            {query && (
              <button
                type="button"
                aria-label="清除证据搜索"
                className="absolute right-2 top-1.5 flex size-5 items-center justify-center text-text-muted hover:text-text-primary"
                onClick={() => update("eq", "")}
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            )}
          </label>
          <select
            aria-label="来源筛选"
            className="h-8 rounded-md border border-border-strong bg-surface px-2 text-xs text-text-secondary"
            value={source}
            onChange={(event) => update("esource", event.target.value)}
          >
            <option value="">全部来源</option>
            {sourceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <select
            aria-label="证据角色筛选"
            className="h-8 rounded-md border border-border-strong bg-surface px-2 text-xs text-text-secondary"
            value={role}
            onChange={(event) => update("erole", event.target.value)}
          >
            <option value="">全部角色</option>
            {Object.entries(evidenceRoleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          {activeFilters && (
            <Button variant="ghost" size="sm" className="h-8" onClick={clear}>清除</Button>
          )}
          <span className="ml-auto text-xs text-text-muted">{results.length} / {bundle.evidence.length} 条</span>
        </div>
      </div>

      {results.length === 0 ? (
        <div className="py-10 text-sm text-text-muted">没有匹配当前条件的证据</div>
      ) : (
        <>
          <div className="sticky top-14 z-10 hidden grid-cols-[130px_140px_120px_minmax(160px,1fr)_120px] gap-4 border-b border-border bg-surface px-3 py-2 text-xs text-text-muted xl:grid">
            <span>角色</span>
            <span>字段</span>
            <span>值</span>
            <span>来源</span>
            <span>观测时间</span>
          </div>
          <div role="list" aria-label="Evidence 列表">
            {results.map((item) => {
              const active = item.evidenceId === selectedEvidenceId;
              return (
                <div key={item.evidenceId} role="listitem">
                  <button
                    type="button"
                    data-testid="evidence-row"
                    onClick={() => onSelect(item)}
                    className={cn(
                      "grid w-full grid-cols-1 gap-2 border-b border-l-2 border-l-transparent border-border px-3 py-2 text-left transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-interactive/40 xl:grid-cols-[130px_140px_120px_minmax(160px,1fr)_120px] xl:items-center xl:gap-4",
                      active && "border-l-interactive bg-interactive/5",
                    )}
                  >
                    <span className="text-sm font-medium">{evidenceRoleLabels[item.role] ?? item.role}</span>
                    <span className="text-sm">{fieldLabel(item.field)}</span>
                    <strong className="text-sm font-semibold">{formatBusinessValue(item)}</strong>
                    <span className="truncate text-xs text-text-muted">{sourceSystemName(bundle, item)}</span>
                    <span className="text-xs text-text-muted">{formatShortDateTime(item.observedAt)}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
