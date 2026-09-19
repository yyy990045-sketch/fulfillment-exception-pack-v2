import { FileSearch } from "lucide-react";
import { cn } from "../../../lib/utils.js";
import type { EvidenceBundleView, EvidenceItem } from "../types.js";
import { evidenceRoleLabels, evidenceTitle, fieldLabel, formatBusinessValue } from "../utils.js";

function sourceSystemName(bundle: EvidenceBundleView, item: EvidenceItem) {
  return bundle.sourceSystems.find((system) => system.id === item.sourceSystemId)?.name ?? item.sourceSystemId;
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
      <div className="hidden grid-cols-[150px_150px_130px_minmax(140px,1fr)_120px] gap-3 border-b border-border px-3 py-2 text-xs text-text-muted xl:grid">
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
                  "grid w-full grid-cols-1 gap-2 border-b border-border px-3 py-3 text-left hover:bg-surface-muted xl:grid-cols-[150px_150px_130px_minmax(140px,1fr)_120px] xl:items-center xl:gap-3",
                  active && "bg-interactive/5",
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
