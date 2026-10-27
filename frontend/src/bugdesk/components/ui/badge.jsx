import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[#7c6cf6] text-white",
        secondary: "border-[rgba(99,102,241,0.14)] bg-violet-50 text-[#7c6cf6] dark:bg-secondary dark:text-secondary-foreground",
        outline: "border-[rgba(99,102,241,0.14)] text-[#1f2544] dark:border-border dark:text-foreground",
        success: "border border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
        destructive: "border border-rose-500/30 bg-rose-500/15 text-rose-600 dark:text-rose-400",
        accent: "chip-badge",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

function Badge({ className, variant, ...props }) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
