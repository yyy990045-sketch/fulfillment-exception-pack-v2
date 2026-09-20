import { NavLink, useLocation } from "react-router-dom";
import { cn } from "../../../lib/utils.js";

const items = [
  { segment: "overview", label: "概览" },
  { segment: "evidence", label: "证据" },
  { segment: "analysis", label: "分析" },
  { segment: "decision", label: "决策" },
  { segment: "governance", label: "治理" },
] as const;

export function ExceptionRecordNav({
  contextId,
  exceptionId,
  evidenceCount,
}: {
  contextId: string;
  exceptionId: string;
  evidenceCount?: number;
}) {
  const location = useLocation();
  const base = `/manufacturing/${encodeURIComponent(contextId)}/exceptions/${encodeURIComponent(exceptionId)}`;
  return (
    <nav aria-label="异常记录工作面" className="sticky top-14 z-20 border-b border-border/80 bg-surface/95 px-4 lg:px-5">
      <div className="mx-auto flex max-w-[1440px] gap-0 overflow-x-auto">
        {items.map((item) => (
          <NavLink
            key={item.segment}
            to={`${base}/${item.segment}${location.search}`}
            className={({ isActive }) => cn(
              "inline-flex h-11 items-center gap-1.5 border-b-2 border-transparent px-3.5 text-[13px] font-medium text-text-secondary transition-colors duration-150 hover:bg-surface-subtle hover:text-text-primary",
              isActive && "border-interactive bg-interactive/[0.025] text-text-primary",
            )}
          >
            {item.label}
            {item.segment === "evidence" && typeof evidenceCount === "number" && (
              <span className="inline-flex h-[18px] min-w-[20px] items-center justify-center rounded-full bg-surface-subtle px-1.5 text-[11px] tabular-nums text-text-muted">
                {evidenceCount}
              </span>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
