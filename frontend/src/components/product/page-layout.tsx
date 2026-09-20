import { Inbox, LoaderCircle, ShieldX } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils.js";
import { Skeleton } from "../ui/skeleton.js";

export const shellWidthClass = "mx-auto w-full max-w-[1720px] px-5";
export const productWidthClass = "mx-auto w-full max-w-[1600px] px-5";
export const recordWidthClass = "mx-auto w-full max-w-[1440px] px-5";

export function ProductPage({ children, className }: { children: ReactNode; className?: string }) {
  return <main className={cn(productWidthClass, "py-4", className)}>{children}</main>;
}

export function ProductHeader({
  leading,
  title,
  description,
  badges,
  actions,
  footer,
  className,
  titleTestId,
}: {
  leading?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  className?: string;
  titleTestId?: string;
}) {
  return (
    <header className={cn("min-h-[64px] border-b border-border/80 pb-3", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {leading}
          <div className="flex min-h-7 flex-wrap items-center gap-2">
            <h1 data-testid={titleTestId} className="text-[23px] font-semibold leading-8 tracking-normal">{title}</h1>
            {badges}
          </div>
          {description && <div className="mt-1 max-w-[88ch] text-[13px] text-text-secondary">{description}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>}
      </div>
      {footer && <div className="mt-2 text-[11px] text-text-muted">{footer}</div>}
    </header>
  );
}

export function ProductSection({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("overflow-hidden rounded-xl border border-border bg-surface shadow-card", className)}>{children}</section>;
}

export function SectionHeader({
  title,
  description,
  meta,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-13 flex-wrap items-center justify-between gap-3 border-b border-border/75 px-4 py-3", className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold leading-5">{title}</h2>
        {description && <p className="mt-0.5 text-xs leading-4 text-text-muted">{description}</p>}
      </div>
      {(meta || actions) && <div className="flex items-center gap-2 text-xs text-text-muted">{meta}{actions}</div>}
    </div>
  );
}

export function SummaryStrip({ children, className, label = "业务摘要" }: { children: ReactNode; className?: string; label?: string }) {
  return <dl aria-label={label} className={cn("grid overflow-hidden rounded-xl border border-border bg-surface shadow-card", className)}>{children}</dl>;
}

export function SummaryItem({ label, value, hint }: { label: string; value: string | number; hint?: ReactNode }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="mt-1 text-[22px] font-semibold leading-7 tracking-tight tabular-nums">{value}</dd>
      {hint && <div className="mt-0.5 text-[11px] text-text-muted">{hint}</div>}
    </div>
  );
}

export function ProductLoading() {
  return (
    <ProductPage className="space-y-3 py-5">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-72 w-full" />
    </ProductPage>
  );
}

export function LocalState({
  kind,
  title,
  detail,
  compact = false,
}: {
  kind: "loading" | "error" | "empty" | "no-results" | "permission-denied";
  title: string;
  detail?: string;
  compact?: boolean;
}) {
  const Icon = kind === "loading" ? LoaderCircle : kind === "permission-denied" ? ShieldX : Inbox;
  const tone = kind === "error" || kind === "permission-denied"
    ? "border-danger/20 bg-danger/5 text-danger"
    : "border-border bg-surface-muted/40 text-text-muted";
  return (
    <div
      role={kind === "error" || kind === "permission-denied" ? "alert" : "status"}
      aria-label={kind === "loading" ? "加载中" : title}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border text-[13px]",
        compact ? "px-3 py-3" : "px-4 py-5",
        tone,
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", kind === "loading" && "animate-spin")} aria-hidden="true" />
      <div className="min-w-0">
        <div className={kind === "error" || kind === "permission-denied" ? "font-medium" : "font-medium text-text-secondary"}>
          {title}
        </div>
        {detail && <div className="mt-0.5 text-xs text-text-muted">{detail}</div>}
      </div>
    </div>
  );
}
