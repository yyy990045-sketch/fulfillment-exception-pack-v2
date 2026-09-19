import { FileSearch } from "lucide-react";
import { cn } from "../../../lib/utils.js";
import type { EvidenceBundleView, EvidenceItem } from "../types.js";
import { evidenceRoleLabels, fieldLabel, formatBusinessValue, sourceSystemLabel } from "../utils.js";

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
  if (!bundle.evidence.length) {
    return <div className="py-10 text-sm text-text-muted">暂无相关证据</div>;
  }
  return (
    <div>
      <div className="sticky top-14 z-10 hidden grid-cols-[150px_150px_130px_minmax(140px,1fr)_120px] gap-4 border-b border-border bg-surface px-3 py-2 text-xs text-text-muted xl:grid">
        <span>角色</span>
        <span>字段</span>
        <span>值</span>
        <span>来源</span>
        <span>观测时间</span>
      </div>
      <div role="list" aria-label="Evidence 列表">
        {bundle.evidence.map((item) => {
          const active = item.evidenceId === selectedEvidenceId;
          return (
            <div key={item.evidenceId} role="listitem">
              <button
                type="button"
                data-testid="evidence-row"
                onClick={() => onSelect(item)}
                className={cn(
                  "grid w-full grid-cols-1 gap-2 border-b border-l-2 border-l-transparent border-border px-3 py-2.5 text-left transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-interactive/40 xl:grid-cols-[150px_150px_130px_minmax(140px,1fr)_120px] xl:items-center xl:gap-4",
                  active && "border-l-interactive bg-interactive/5",
                )}
              >
                <span className="text-sm font-medium">{evidenceRoleLabels[item.role] ?? item.role}</span>
                <span className="text-sm">{fieldLabel(item.field)}</span>
                <strong className="text-sm font-semibold">{formatBusinessValue(item)}</strong>
                <span className="truncate text-xs text-text-muted">{sourceSystemName(bundle, item)}</span>
                <span className="text-xs text-text-muted">{item.observedAt}</span>
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex justify-end pt-3">
        <p className="flex items-center gap-2 text-xs text-text-muted">
          <FileSearch className="size-3.5" aria-hidden="true" />
          选择一行查看来源与定位
        </p>
      </div>
    </div>
  );
}
