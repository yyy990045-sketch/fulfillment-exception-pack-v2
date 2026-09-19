import { AlertCircle, Inbox } from "lucide-react";
import { Skeleton } from "../../../components/ui/skeleton.js";

export function SectionSkeleton() {
  return (
    <div className="space-y-2 py-2" aria-label="加载中">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

export function InlineError({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex gap-3 border border-danger/25 bg-danger/5 p-4 text-sm">
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
      <div>
        <div className="font-medium text-danger">{title}</div>
        <div className="mt-1 text-text-secondary">{detail}</div>
      </div>
    </div>
  );
}

export function InlineEmpty({ message = "暂无生成结果" }: { message?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-text-muted">
      <Inbox className="size-4" aria-hidden="true" />
      {message}
    </div>
  );
}
