import * as React from "react";
import { cn } from "../../lib/utils";

function Card({ className, ...props }) {
  return (
    <div
      className={cn("rounded-xl border border-[#1A2234] bg-[#0E131F] text-card-foreground shadow-md", className)}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }) {
  return <div className={cn("flex flex-col gap-1 p-6 pb-4", className)} {...props} />;
}

function CardTitle({ className, ...props }) {
  return <h3 className={cn("font-display text-[16.5px] font-bold tracking-tight text-white", className)} {...props} />;
}

function CardDescription({ className, ...props }) {
  return <p className={cn("text-[13px] text-[#8F97A6]", className)} {...props} />;
}

function CardContent({ className, ...props }) {
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}

function CardFooter({ className, ...props }) {
  return <div className={cn("flex items-center p-6 pt-0", className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
