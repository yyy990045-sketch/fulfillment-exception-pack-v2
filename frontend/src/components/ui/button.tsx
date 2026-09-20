import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border text-[13px] font-medium leading-none transition-all duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-interactive/35",
  {
    variants: {
      variant: {
        default: "border-interactive bg-interactive text-white hover:bg-interactive/90",
        secondary: "border-border-strong bg-surface text-text-secondary hover:border-border-strong hover:bg-surface-muted",
        outline: "border-border bg-surface text-text-secondary hover:border-border-strong hover:bg-surface-subtle",
        ghost: "border-transparent bg-transparent text-text-secondary hover:bg-surface-subtle",
        danger: "border-danger/40 bg-danger/5 text-danger hover:bg-danger/10",
      },
      size: {
        default: "h-9 px-3.5",
        sm: "h-8 px-3 text-xs",
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
