import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils.js";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4",
  {
    variants: {
      variant: {
        default: "border border-border bg-surface-muted text-text-secondary",
        info: "border border-interactive/20 bg-interactive/[0.07] text-interactive",
        warning: "border border-warning/20 bg-warning/[0.07] text-warning",
        danger: "border border-danger/20 bg-danger/[0.07] text-danger",
        success: "border border-success/20 bg-success/[0.07] text-success",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** 语义状态徽章：前置圆点承载状态色，常用于风险等级 / 治理状态 */
export function StatusDotBadge({
  className,
  variant = "default",
  children,
  ...props
}: BadgeProps) {
  const dotColor: Record<NonNullable<BadgeProps["variant"]>, string> = {
    default: "bg-text-muted",
    info: "bg-interactive",
    warning: "bg-warning",
    danger: "bg-danger",
    success: "bg-success",
  };
  return (
    <Badge className={cn("rounded-full px-2", className)} variant={variant} {...props}>
      <span className={cn("size-1.5 shrink-0 rounded-full", dotColor[variant ?? "default"])} aria-hidden="true" />
      {children}
    </Badge>
  );
}
