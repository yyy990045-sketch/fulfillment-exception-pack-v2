import { ProductHeader, productWidthClass } from "../../../components/product/page-layout.js";
import { ContextStatusBadge } from "../../../components/product/status-badge.js";
import type { WorkbenchView } from "../types.js";
import { contextTypeLabel, formatShortDateTime } from "../utils.js";

export function ContextHeader({ view }: { view: WorkbenchView }) {
  const meta = [
    `来源系统 ${view.stats.sourceSystems}`,
    `文档 ${view.stats.documents}`,
    `事件 ${view.stats.events}`,
    `开启于 ${formatShortDateTime(view.context.openedAt)}`,
  ];
  return (
    <section data-testid="context-header" className="border-b border-border bg-surface">
      <div className={`${productWidthClass} py-3.5`}>
        <ProductHeader
          className="min-h-[56px] border-0 pb-0"
          title={view.context.businessKey}
          badges={<ContextStatusBadge status={view.context.status} />}
          description={`当前有 ${view.stats.exceptions} 个异常需要核对`}
          actions={(
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
              <span>{contextTypeLabel(view.context.contextType)}</span>
              <span>更新 {formatShortDateTime(view.context.updatedAt)}</span>
            </div>
          )}
          footer={meta.join(" · ")}
        />
      </div>
    </section>
  );
}
