import { FileSearch, Info } from "lucide-react";
import { ProductSection, SectionHeader } from "../../../components/product/page-layout.js";
import { Button } from "../../../components/ui/button.js";
import type { EvidenceBundleView, EvidenceItem } from "../types.js";
import {
  evidenceRoleLabels,
  fieldLabel,
  formatBusinessValue,
  formatLocator,
  formatShortDateTime,
  sourceSystemLabel,
} from "../utils.js";

function sourceName(bundle: EvidenceBundleView, item: EvidenceItem) {
  const source = bundle.sourceSystems.find((candidate) => candidate.id === item.sourceSystemId);
  return source ? sourceSystemLabel(source.systemType, source.name) : "业务来源";
}

export function EvidencePreview({
  bundle,
  item,
  onOpenTechnical,
}: {
  bundle: EvidenceBundleView;
  item: EvidenceItem | undefined;
  onOpenTechnical: (evidenceId: string) => void;
}) {
  if (!item) {
    return (
      <ProductSection className="min-h-80">
        <SectionHeader title="证据详情" />
        <div className="flex min-h-[260px] flex-col items-center justify-center gap-2 p-6 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-surface-subtle text-text-muted">
            <FileSearch className="size-4.5" aria-hidden="true" />
          </span>
          <p className="text-[13px] font-medium text-text-secondary">选择一条证据</p>
          <p className="max-w-[26ch] text-[11px] leading-4 text-text-muted">点击左侧列表中的证据，查看原文引用、来源与关键字段。</p>
        </div>
      </ProductSection>
    );
  }
  const locator = formatLocator(item.locator);
  return (
    <ProductSection className="min-h-80">
      <SectionHeader title="证据详情" actions={<FileSearch className="size-4 text-text-muted" aria-hidden="true" />} />
      <div className="space-y-4 p-4">
        <div>
          <div className="text-[11px] font-medium text-text-muted">原文</div>
          <blockquote className="mt-2 border-l-2 border-interactive/40 pl-3 text-[13px] leading-6 text-text-primary">
            {item.quote}
          </blockquote>
        </div>
        <dl className="space-y-2.5 border-t border-border/70 pt-4">
          {[
            ["角色", evidenceRoleLabels[item.role] ?? item.role],
            ["字段", fieldLabel(item.field)],
            ["值", formatBusinessValue(item)],
            ["来源", sourceName(bundle, item)],
            ["业务时间", formatShortDateTime(item.observedAt)],
            ["定位", locator.map((entry) => `${entry.label} ${entry.value}`).join(" · ") || "未记录"],
          ].map(([label, value]) => (
            <div key={label} className="grid grid-cols-[84px_minmax(0,1fr)] gap-3">
              <dt className="text-[11px] text-text-muted">{label}</dt>
              <dd className="text-[12px] font-medium text-text-secondary">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => onOpenTechnical(item.evidenceId)}>
            <Info className="size-3.5" aria-hidden="true" />
            审计详情
          </Button>
        </div>
      </div>
    </ProductSection>
  );
}
