import { Info } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/ui/button.js";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../../components/ui/sheet.js";

export function TechnicalMetadataSheet({
  title,
  metadata,
}: {
  title: string;
  metadata: Array<{ label: string; value: string | null | undefined }>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Info className="size-3.5" aria-hidden="true" />
        技术信息
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>Provider、model、ID 与 snapshot metadata</SheetDescription>
          </SheetHeader>
          <dl className="mt-5 grid grid-cols-[130px_1fr] gap-x-4 gap-y-3 text-sm">
            {metadata.map((item) => (
              <div key={item.label} className="contents">
                <dt className="text-text-muted">{item.label}</dt>
                <dd className="break-all font-mono text-xs">{item.value || "—"}</dd>
              </div>
            ))}
          </dl>
        </SheetContent>
      </Sheet>
    </>
  );
}
