import * as React from "react";
import { cn } from "../../lib/utils";

const Input = React.forwardRef(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-xl border border-[rgba(99,102,241,0.18)] bg-white/90 px-3.5 py-2 text-[13.5px] shadow-xs transition-colors text-[#1f2544] placeholder:text-[#a3a8c3] focus:outline-none focus:border-[#7c6cf6] focus:ring-2 focus:ring-[#7c6cf6]/25 dark:border-[#1E2638] dark:bg-[#080B12] dark:text-white dark:placeholder:text-[#525A6C] dark:focus:border-[#7c6cf6] dark:focus:ring-[#7c6cf6]/25 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
});
Input.displayName = "Input";

export { Input };
