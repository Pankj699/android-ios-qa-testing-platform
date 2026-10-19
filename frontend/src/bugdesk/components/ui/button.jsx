import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-[13.5px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background cursor-pointer",
  {
    variants: {
      variant: {
        default: "bg-[#F59E0B] text-[#0A0D14] hover:bg-[#E58E00] font-bold shadow-sm",
        destructive: "bg-rose-600 text-white hover:bg-rose-700 shadow-sm",
        outline: "border border-[#1E2638] bg-transparent hover:bg-[#141B28] text-slate-200",
        secondary: "bg-[#141B28] text-slate-200 hover:bg-[#1E2638]",
        ghost: "hover:bg-[#141B28] text-slate-200 hover:text-white",
        link: "text-[#F59E0B] underline-offset-4 hover:underline",
        accent: "bg-[#F59E0B] text-[#0A0D14] hover:bg-[#E58E00] font-bold shadow-sm",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8.5 rounded-lg px-3 text-[13px]",
        lg: "h-11 rounded-lg px-6 text-[14px]",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

const Button = React.forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
});
Button.displayName = "Button";

export { Button, buttonVariants };
