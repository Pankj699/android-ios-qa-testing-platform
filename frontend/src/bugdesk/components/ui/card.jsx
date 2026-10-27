import * as React from "react";
import { cn } from "../../lib/utils";

function Card({ className, ...props }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-[rgba(99,102,241,0.14)] glass text-[#1f2544] shadow-glass dark:border-[#1A2234] dark:bg-[#0E131F]/90 dark:text-card-foreground dark:shadow-md transition-colors",
        className
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }) {
  return <div className={cn("flex flex-col gap-1 p-6 pb-4", className)} {...props} />;
}

function CardTitle({ className, ...props }) {
  return (
    <h3
      className={cn(
        "font-sans text-[16.5px] font-extrabold tracking-tight text-[#1f2544] dark:text-white",
        className
      )}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }) {
  return <p className={cn("text-[13px] text-[#6b7194] dark:text-[#8F97A6]", className)} {...props} />;
}

function CardContent({ className, ...props }) {
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}

function CardFooter({ className, ...props }) {
  return <div className={cn("flex items-center p-6 pt-0", className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
