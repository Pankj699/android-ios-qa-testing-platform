import * as React from "react";
import { cn } from "../../lib/utils";

const Textarea = React.forwardRef(({ className, ...props }, ref) => {
  return (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-[80px] w-full rounded-lg border border-[#1E2638] bg-[#080B12] p-3.5 text-[13.5px] leading-relaxed shadow-sm transition-colors text-white placeholder:text-[#525A6C] focus:outline-none focus:border-[#F59E0B] focus:ring-1 focus:ring-[#F59E0B] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
