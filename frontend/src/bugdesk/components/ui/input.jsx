import * as React from "react";
import { cn } from "../../lib/utils";

const Input = React.forwardRef(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-lg border border-[#1E2638] bg-[#080B12] px-3.5 py-2 text-[13.5px] shadow-sm transition-colors text-white placeholder:text-[#525A6C] focus:outline-none focus:border-[#F59E0B] focus:ring-1 focus:ring-[#F59E0B] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
});
Input.displayName = "Input";

export { Input };
