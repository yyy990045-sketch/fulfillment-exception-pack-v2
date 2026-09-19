import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../../components/ui/sheet.js";
import { Separator } from "../../../components/ui/separator.js";
import type { EvidenceBundleView, EvidenceItem } from "../types.js";
import { evidenceRoleLabels, fieldLabel, formatBusinessValue, formatLocator } from "../utils.js";

export function EvidenceInspector({
  bundle,
  item,
  open,
  onOpenChange,
}: {
  bundle: EvidenceBundleView;
  item: EvidenceItem | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!item) return null;
  const sourceSystem = bundle.sourceSystems.find((system) => system.id === item.sourceSystemId);
  const sourceDocument = bundle.sourceDocuments.find((document) => document.id === item.sourceDocumentId);
  const locator = formatLocator(item.locator);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent data-testid="evidence-inspector">
        <SheetHeader>
          <SheetTitle>{evidenceRoleLabels[item.role] ?? item.role} · {fieldLabel(item.field)}</SheetTitle>
          <SheetDescription>证据来源与原始定位</SheetDescription>
        </SheetHeader>
        <div className="mt-5 space-y-4 text-sm">
          <div>
            <div className="text-xs text-text-muted">值</div>
            <div className="mt-1 text-2xl font-semibold">{formatBusinessValue(item)}</div>
          </div>
          <Separator />
          <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-3">
            <dt className="text-text-muted">来源系统</dt>
            <dd>{sourceSystem?.name ?? item.sourceSystemId}</dd>
            <dt className="text-text-muted">来源文档</dt>
            <dd>{sourceDocument?.externalDocumentId ?? item.sourceDocumentId}</dd>
            <dt className="text-text-muted">文档版本</dt>
            <dd>{sourceDocument?.version ?? item.sourceVersion}</dd>
            <dt className="text-text-muted">观测时间</dt>
            <dd>{item.observedAt}</dd>
            <dt className="text-text-muted">Evidence ID</dt>
            <dd className="break-all font-mono text-xs">{item.evidenceId}</dd>
          </dl>
          <Separator />
          <div>
            <div className="text-xs text-text-muted">引用原文</div>
            <blockquote className="mt-1 border-l-2 border-border-strong pl-3 text-text-secondary">
              {item.quote || "—"}
            </blockquote>
          </div>
          {locator.length > 0 && (
            <div>
              <div className="text-xs text-text-muted">定位</div>
              <dl className="mt-1 grid grid-cols-[100px_1fr] gap-x-4 gap-y-1">
                {locator.map((entry) => (
                  <div key={entry.label} className="contents">
                    <dt className="text-text-muted">{entry.label}</dt>
                    <dd>{entry.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
