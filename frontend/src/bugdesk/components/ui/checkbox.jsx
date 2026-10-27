import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "../../lib/utils";

const Checkbox = React.forwardRef(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer h-[18px] w-[18px] shrink-0 rounded-[5px] border border-slate-300 dark:border-[#2E3A52] bg-white dark:bg-[#080B12] shadow-sm transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#7c6cf6] disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-[#7c6cf6] data-[state=checked]:border-[#7c6cf6] data-[state=checked]:text-white",
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
      <Check className="h-3.5 w-3.5 stroke-[3] text-white" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
