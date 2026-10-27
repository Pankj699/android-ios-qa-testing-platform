import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-[13.5px] font-semibold transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-[#7c6cf6] cursor-pointer",
  {
    variants: {
      variant: {
        default:
          "btn-magic text-white font-bold shadow-magic active:scale-[0.99] rounded-xl",
        magic:
          "btn-magic text-white font-bold shadow-magic active:scale-[0.99] rounded-2xl",
        soft:
          "btn-soft rounded-xl",
        idea:
          "idea rounded-full",
        destructive: "bg-rose-600 text-white hover:bg-rose-700 shadow-sm rounded-xl",
        outline:
          "btn-soft rounded-xl",
        secondary:
          "bg-violet-50/80 hover:bg-violet-100 text-[#7c6cf6] border border-violet-200/50 dark:bg-[#141B28] dark:text-slate-200 dark:hover:bg-[#1E2638] rounded-xl font-semibold",
        ghost:
          "hover:bg-violet-50/70 text-[#6b7194] hover:text-[#1f2544] dark:hover:bg-[#141B28] dark:text-slate-200 dark:hover:text-white rounded-xl",
        link: "text-[#7c6cf6] hover:underline dark:text-[#F59E0B]",
        accent:
          "btn-magic text-white font-bold shadow-magic active:scale-[0.99] rounded-xl",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8.5 rounded-xl px-3 text-[13px]",
        lg: "h-11 rounded-2xl px-6 text-[14px]",
        icon: "h-9 w-9 rounded-xl",
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
