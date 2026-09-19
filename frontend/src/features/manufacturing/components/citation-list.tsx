import { Button } from "../../../components/ui/button.js";
import type { CitationStatement } from "../analysis-types.js";
import type { EvidenceBundleView } from "../types.js";
import { evidenceRoleLabels, fieldLabel, formatBusinessValue } from "../utils.js";

function evidenceLabel(evidenceId: string, bundle: EvidenceBundleView | undefined) {
  const item = bundle?.evidence.find((evidence) => evidence.evidenceId === evidenceId);
  if (!item) return "关联证据";
  return `${evidenceRoleLabels[item.role] ?? item.role} ${formatBusinessValue(item)}`;
}

function evidenceTitle(evidenceId: string, bundle: EvidenceBundleView | undefined) {
  const item = bundle?.evidence.find((evidence) => evidence.evidenceId === evidenceId);
  return item ? `${fieldLabel(item.field)} · ${evidenceId}` : evidenceId;
}

export function CitationStatementList({
  items,
  bundle,
  onOpenEvidence,
}: {
  items: CitationStatement[];
  bundle: EvidenceBundleView | undefined;
  onOpenEvidence: (evidenceId: string) => void;
}) {
  if (!items.length) return <p className="text-sm text-text-muted">无</p>;
  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li key={`${item.statement}-${index}`} className="border-b border-border pb-2 last:border-b-0 last:pb-0">
          <p className="text-sm text-text-secondary">{item.statement}</p>
          {item.evidenceIds.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {item.evidenceIds.map((evidenceId) => (
                <Button
                  key={evidenceId}
                  variant="ghost"
                  size="sm"
                  className="h-auto min-h-6 max-w-full px-1.5 py-0.5 text-xs"
                  title={evidenceTitle(evidenceId, bundle)}
                  onClick={() => onOpenEvidence(evidenceId)}
                >
                  {evidenceLabel(evidenceId, bundle)}
                </Button>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function EvidenceReferenceList({
  evidenceIds,
  bundle,
  onOpenEvidence,
}: {
  evidenceIds: string[];
  bundle: EvidenceBundleView | undefined;
  onOpenEvidence: (evidenceId: string) => void;
}) {
  if (!evidenceIds.length) return <span className="text-xs text-text-muted">无</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {evidenceIds.map((evidenceId) => (
        <Button
          key={evidenceId}
          variant="ghost"
          size="sm"
          className="h-auto min-h-6 max-w-full px-1.5 py-0.5 text-xs"
          title={evidenceTitle(evidenceId, bundle)}
          onClick={() => onOpenEvidence(evidenceId)}
        >
          {evidenceLabel(evidenceId, bundle)}
        </Button>
      ))}
    </div>
  );
}
