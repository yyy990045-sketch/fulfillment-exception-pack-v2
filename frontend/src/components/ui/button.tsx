import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-interactive/40",
  {
    variants: {
      variant: {
        default: "border-interactive bg-interactive text-white hover:bg-interactive/90",
        secondary: "border-border-strong bg-surface text-text-secondary hover:bg-surface-muted",
        outline: "border-border bg-transparent text-text-secondary hover:bg-surface-muted",
        ghost: "border-transparent bg-transparent text-text-secondary hover:bg-surface-muted",
        danger: "border-danger/40 bg-danger/5 text-danger hover:bg-danger/10",
      },
      size: {
        default: "h-9 px-3",
        sm: "h-8 px-2.5 text-xs",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return <Component className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
