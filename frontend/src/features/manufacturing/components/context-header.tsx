import { Badge } from "../../../components/ui/badge.js";
import type { WorkbenchView } from "../types.js";

export function ContextHeader({ view }: { view: WorkbenchView }) {
  return (
    <section className="border-b border-border bg-surface">
      <div className="mx-auto flex w-full max-w-[1720px] flex-col gap-3 px-5 py-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-normal">{view.context.businessKey}</h1>
            <Badge variant={view.context.status === "active" ? "info" : "default"}>
              {view.context.status === "active" ? "履约进行中" : view.context.status}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-text-secondary">
            当前有 {view.stats.exceptions} 个异常需要核对
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
          <span>Context {view.context.id}</span>
          <span>{view.context.contextType}</span>
          <span>更新 {view.context.updatedAt}</span>
        </div>
      </div>
    </section>
  );
}
