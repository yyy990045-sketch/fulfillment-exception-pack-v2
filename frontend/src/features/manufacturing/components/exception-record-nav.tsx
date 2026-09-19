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
}: {
  contextId: string;
  exceptionId: string;
}) {
  const location = useLocation();
  const base = `/manufacturing/${encodeURIComponent(contextId)}/exceptions/${encodeURIComponent(exceptionId)}`;
  return (
    <nav aria-label="异常记录工作面" className="border-b border-border bg-surface px-4 lg:px-5">
      <div className="flex gap-1 overflow-x-auto py-2">
        {items.map((item) => (
          <NavLink
            key={item.segment}
            to={`${base}/${item.segment}${location.search}`}
            className={({ isActive }) => cn(
              "inline-flex h-8 items-center rounded-md px-3 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-muted hover:text-text-primary",
              isActive && "bg-interactive/5 text-interactive",
            )}
          >
            {item.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
