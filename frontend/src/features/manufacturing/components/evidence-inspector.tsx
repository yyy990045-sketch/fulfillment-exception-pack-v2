import { AuditDetailsSheet, type AuditDetailSection } from "../../../components/product/audit-details-sheet.js";
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
  if (!open) return null;
  const sourceSystem = bundle.sourceSystems.find((system) => system.id === item.sourceSystemId);
  const sourceDocument = bundle.sourceDocuments.find((document) => document.id === item.sourceDocumentId);
  const locator = formatLocator(item.locator);
  const sections: AuditDetailSection[] = [
    {
      title: "证据标识",
      rows: [
        { label: "Evidence ID", value: item.evidenceId },
        { label: "Event ID", value: item.eventId },
        { label: "Source system ID", value: item.sourceSystemId },
        { label: "Source document ID", value: item.sourceDocumentId },
      ],
    },
    {
      title: "来源与时间",
      rows: [
        { label: "来源系统", value: sourceSystem?.name ?? item.sourceSystemId },
        { label: "来源文档", value: sourceDocument?.externalDocumentId ?? item.sourceDocumentId },
        { label: "文档版本", value: sourceDocument?.version ?? item.sourceVersion },
        { label: "Observed at", value: item.observedAt },
        { label: "Support", value: item.support },
        { label: "Confidence", value: item.confidence === undefined ? null : String(item.confidence) },
      ],
    },
    {
      title: "原文定位",
      rows: locator.map((entry) => ({ label: entry.label, value: entry.value })),
    },
  ];
  return (
    <AuditDetailsSheet
      open={open}
      onOpenChange={onOpenChange}
      sections={sections}
      description={`${evidenceRoleLabels[item.role] ?? item.role} · ${fieldLabel(item.field)} 的来源与原始定位`}
      contentTestId="evidence-inspector"
    >
        <div className="mt-5 space-y-4 text-sm">
          <div>
            <div className="text-xs text-text-muted">值</div>
            <div className="mt-1 text-2xl font-semibold">{formatBusinessValue(item)}</div>
          </div>
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
    </AuditDetailsSheet>
  );
}
