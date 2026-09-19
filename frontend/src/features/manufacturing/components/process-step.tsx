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
        "relative border-l pl-5 transition-colors",
        status === "current" ? "border-l-interactive/40" : status === "error" ? "border-l-danger/40" : "border-l-border",
      )}
    >
      <span
        className={cn(
          "absolute -left-[9px] top-4 flex size-[18px] items-center justify-center rounded-full bg-surface text-text-muted",
          status === "done" && "text-success",
          status === "current" && "text-interactive",
          status === "error" && "text-danger",
        )}
      >
        <Icon className="size-[18px]" aria-hidden="true" />
      </span>
      <button
        type="button"
        className="w-full border-b border-border py-3.5 text-left transition-colors hover:text-interactive"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">{title}</h3>
            <p className="mt-0.5 text-xs text-text-muted">{summary}</p>
          </div>
          <div className="text-right text-xs text-text-muted">
            <div>{owner}</div>
            <div className="mt-0.5 text-text-secondary">{result}</div>
          </div>
        </div>
      </button>
      {expanded && <div className="py-4">{children}</div>}
    </section>
  );
}
