import { Button } from "../../../components/ui/button.js";
import type { CitationStatement } from "../analysis-types.js";

export function CitationStatementList({
  items,
  onOpenEvidence,
}: {
  items: CitationStatement[];
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
                  className="h-6 px-1.5 font-mono text-xs"
                  onClick={() => onOpenEvidence(evidenceId)}
                >
                  {evidenceId}
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
  onOpenEvidence,
}: {
  evidenceIds: string[];
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
          className="h-6 px-1.5 font-mono text-xs"
          onClick={() => onOpenEvidence(evidenceId)}
        >
          {evidenceId}
        </Button>
      ))}
    </div>
  );
}
