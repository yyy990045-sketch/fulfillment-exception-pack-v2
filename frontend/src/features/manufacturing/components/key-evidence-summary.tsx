import { Badge } from "../../../components/ui/badge.js";
import type { EvidenceBundleView, EvidenceItem } from "../types.js";
import {
  evidenceRoleLabels,
  evidenceSupportLabel,
  fieldLabel,
  formatBusinessValue,
  formatShortDateTime,
  sourceSystemLabel,
} from "../utils.js";

function sourceLabel(bundle: EvidenceBundleView, item: EvidenceItem) {
  const source = bundle.sourceSystems.find((system) => system.id === item.sourceSystemId);
  if (!source) return "来源未记录";
  return sourceSystemLabel(source.systemType, source.name);
}

function supportVariant(support: string) {
  if (support === "supported") return "success" as const;
  if (support === "partial") return "warning" as const;
  return "danger" as const;
}

export function KeyEvidenceSummary({
  evidenceIds,
  bundle,
  limit = 5,
  onOpenEvidence,
  emptyMessage = "暂无可展示的关键证据",
}: {
  evidenceIds: string[];
  bundle: EvidenceBundleView | undefined;
  limit?: number;
  onOpenEvidence: (evidenceId: string) => void;
  emptyMessage?: string;
}) {
  if (!bundle || !evidenceIds.length) return <p className="text-xs text-text-muted">{emptyMessage}</p>;
  const items = evidenceIds
    .slice(0, limit)
    .flatMap((evidenceId) => {
      const item = bundle.evidence.find((candidate) => candidate.evidenceId === evidenceId);
      return item ? [item] : [];
    });
  if (!items.length) return <p className="text-xs text-text-muted">{emptyMessage}</p>;

  return (
    <div className="divide-y divide-border border-y border-border">
      {items.map((item) => (
        <button
          key={item.evidenceId}
          type="button"
          className="grid w-full gap-1.5 py-2.5 text-left transition-colors hover:bg-surface-subtle"
          onClick={() => onOpenEvidence(item.evidenceId)}
        >
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-medium text-text-secondary">
              {fieldLabel(item.field)} · {formatBusinessValue(item)}
            </span>
            <Badge variant={supportVariant(item.support)}>{evidenceSupportLabel(item.support)}</Badge>
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-text-muted">
            <span>{sourceLabel(bundle, item)}</span>
            <span aria-hidden="true">·</span>
            <span>{formatShortDateTime(item.observedAt)}</span>
            <span aria-hidden="true">·</span>
            <span>{evidenceRoleLabels[item.role] ?? item.role}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
