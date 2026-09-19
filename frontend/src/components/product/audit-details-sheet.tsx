import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../ui/sheet.js";

export type AuditDetailRow = {
  label: string;
  value: string | null | undefined;
};

export type AuditDetailSection = {
  title: string;
  rows: AuditDetailRow[];
};

function DetailGroup({ title, rows }: AuditDetailSection) {
  return (
    <section className="border-b border-border py-4 last:border-b-0">
      <h3 className="text-xs font-semibold text-text-secondary">{title}</h3>
      <dl className="mt-2 grid grid-cols-[130px_1fr] gap-x-4 gap-y-2 text-xs">
        {rows.map((row) => (
          <div key={`${title}-${row.label}`} className="contents">
            <dt className="text-text-muted">{row.label}</dt>
            <dd className="break-all font-mono">{row.value || "—"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function AuditDetailsSheet({
  open,
  onOpenChange,
  sections,
  description = "技术标识、来源、快照和审计信息",
  contentTestId,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: AuditDetailSection[];
  description?: string;
  contentTestId?: string;
  children?: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent data-testid={contentTestId}>
        <SheetHeader>
          <SheetTitle>审计详情</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        {children}
        <div className="mt-4">
          {sections.map((section) => <DetailGroup key={section.title} {...section} />)}
        </div>
      </SheetContent>
    </Sheet>
  );
}
