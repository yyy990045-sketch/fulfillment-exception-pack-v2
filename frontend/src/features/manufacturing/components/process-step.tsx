import { AlertCircle, CheckCircle2, Circle, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../../lib/utils.js";

export type ProcessStepStatus = "done" | "current" | "pending" | "error";

const icons = {
  done: CheckCircle2,
  current: LoaderCircle,
  pending: Circle,
  error: AlertCircle,
};

export function ProcessStep({
  id,
  title,
  status,
  summary,
  owner,
  result,
  expanded,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  status: ProcessStepStatus;
  summary: string;
  owner: string;
  result: string;
  expanded: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  const Icon = icons[status];
  return (
    <section
      data-testid={`process-step-${id}`}
      data-status={status}
      className={cn(
        "overflow-hidden rounded-lg border border-border/80 bg-surface transition-colors",
        status === "current" && "border-interactive/25 bg-interactive/[0.015]",
        status === "error" && "border-danger/25",
      )}
    >
      <button
        type="button"
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-subtle"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span
          className={cn(
            "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-text-muted",
            status === "done" && "text-success",
            status === "current" && "bg-interactive/10 text-interactive",
            status === "error" && "text-danger",
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-[13px] font-semibold">{title}</h3>
              <p className="mt-0.5 text-[11px] leading-4 text-text-muted">{summary}</p>
            </div>
            <div className="text-right text-[11px] text-text-muted">
              <div>{owner}</div>
              <div className="mt-0.5 text-text-secondary">{result}</div>
            </div>
          </div>
        </div>
      </button>
      {expanded && <div className="border-t border-border/70 bg-surface px-4 py-4">{children}</div>}
    </section>
  );
}
