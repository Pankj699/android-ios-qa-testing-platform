import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp, Search } from "lucide-react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

const Select = SelectPrimitive.Root;
const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-9 w-full items-center justify-between rounded-xl border border-[var(--line)] bg-white/70 px-3 py-1.5 text-xs font-medium text-[#1F2544] shadow-xs transition-colors hover:border-[#7c6cf6]/40 focus:outline-none focus:ring-1 focus:ring-[#7c6cf6]/50 focus:border-[#7c6cf6] dark:border-[#1E2638] dark:bg-[#080B12] dark:text-white dark:hover:border-[#263248] dark:focus:ring-[#7c6cf6]/50 dark:focus:border-[#7c6cf6] disabled:cursor-not-allowed disabled:opacity-50 [&>span]:truncate [&[data-placeholder]]:text-[#6B7194] dark:[&[data-placeholder]]:text-[#8F97A6]",
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 shrink-0 text-[#6B7194] dark:text-[#8F97A6] opacity-70 ml-2" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectContent = React.forwardRef(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        "relative z-[70] min-w-[8rem] max-h-60 overflow-hidden rounded-2xl border border-[rgba(99,102,241,0.18)] bg-white/95 text-[#1F2544] shadow-2xl backdrop-blur-xl dark:border-[#1E2638] dark:bg-[#0D111A]/95 dark:text-slate-200 animate-in fade-in-80",
        position === "popper" && "translate-y-1",
        className
      )}
      position={position}
      {...props}
    >
      <SelectPrimitive.ScrollUpButton className="flex items-center justify-center py-1 text-slate-400">
        <ChevronUp className="h-4 w-4" />
      </SelectPrimitive.ScrollUpButton>
      <SelectPrimitive.Viewport className="p-1 max-h-56 overflow-y-auto">{children}</SelectPrimitive.Viewport>
      <SelectPrimitive.ScrollDownButton className="flex items-center justify-center py-1 text-slate-400">
        <ChevronDown className="h-4 w-4" />
      </SelectPrimitive.ScrollDownButton>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectItem = React.forwardRef(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-pointer select-none items-center rounded-xl py-2 pl-8 pr-3 text-xs font-medium outline-none transition-colors hover:bg-violet-50/70 focus:bg-violet-50/70 focus:text-[#7c6cf6] dark:hover:bg-[#141B28] dark:focus:bg-[#141B28] dark:focus:text-white data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute left-2.5 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4 text-[#7c6cf6] dark:text-violet-400" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

// Sentinel to avoid Radix Select runtime error with empty string value ("")
const EMPTY_SENTINEL = "__EMPTY__";

/**
 * CustomSelect - High-level custom dropdown matching BugDesk Status selector.
 * Drop-in replacement for native <select>.
 */
export function CustomSelect({
  value,
  onChange,
  onValueChange,
  options = [],
  placeholder = "Select an option",
  disabled = false,
  className = "",
  contentClassName = "",
  title,
  ariaLabel,
  searchable = false,
  children,
  id
}) {
  const [searchQuery, setSearchQuery] = React.useState("");

  // Normalize options array
  const normalizedOptions = React.useMemo(() => {
    if (!options || options.length === 0) return [];
    return options.map((opt) => {
      if (typeof opt === "string" || typeof opt === "number") {
        return {
          value: String(opt),
          label: String(opt),
          internalValue: opt === "" ? EMPTY_SENTINEL : String(opt)
        };
      }
      return {
        ...opt,
        value: opt.value !== undefined ? String(opt.value) : "",
        label: opt.label !== undefined ? opt.label : String(opt.value),
        internalValue: (opt.value === "" || opt.value === null || opt.value === undefined)
          ? EMPTY_SENTINEL
          : String(opt.value)
      };
    });
  }, [options]);

  const hasEmptyOption = React.useMemo(() => {
    return normalizedOptions.some((o) => o.internalValue === EMPTY_SENTINEL);
  }, [normalizedOptions]);

  // Map incoming value (handle null/undefined/"" seamlessly)
  const normalizedValue = React.useMemo(() => {
    if (value === "" || value === null || value === undefined) {
      return hasEmptyOption ? EMPTY_SENTINEL : undefined;
    }
    return String(value);
  }, [value, hasEmptyOption]);

  const handleValueChange = React.useCallback((selectedVal) => {
    const outputVal = selectedVal === EMPTY_SENTINEL ? "" : selectedVal;
    if (onValueChange) {
      onValueChange(outputVal);
    }
    if (onChange) {
      // Pass both outputVal and mock event object for full backward compatibility
      onChange({
        target: { value: outputVal, name: id },
        currentTarget: { value: outputVal, name: id },
        value: outputVal
      });
    }
  }, [onChange, onValueChange, id]);

  const filteredOptions = React.useMemo(() => {
    if (!searchable || !searchQuery.trim()) return normalizedOptions;
    const q = searchQuery.toLowerCase();
    return normalizedOptions.filter((opt) =>
      String(opt.label).toLowerCase().includes(q) || String(opt.value).toLowerCase().includes(q)
    );
  }, [normalizedOptions, searchable, searchQuery]);

  // Find label of currently selected option if children not passed
  const selectedLabel = React.useMemo(() => {
    if (normalizedValue === EMPTY_SENTINEL) {
      const emptyOpt = normalizedOptions.find((o) => o.internalValue === EMPTY_SENTINEL);
      return emptyOpt ? emptyOpt.label : null;
    }
    const found = normalizedOptions.find((o) => o.internalValue === normalizedValue);
    return found ? found.label : null;
  }, [normalizedValue, normalizedOptions]);

  return (
    <Select
      value={normalizedValue}
      onValueChange={handleValueChange}
      disabled={disabled}
    >
      <SelectTrigger
        className={className}
        title={title}
        aria-label={ariaLabel || title || placeholder}
        id={id}
      >
        <SelectValue placeholder={placeholder}>
          {selectedLabel || undefined}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className={contentClassName}>
        {searchable && (
          <div className="p-1.5 border-b border-slate-100 dark:border-[#1E2638] sticky top-0 bg-white dark:bg-[#0E131F] z-10">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="w-full pl-7 pr-2 py-1 text-xs rounded bg-slate-50 dark:bg-[#080B12] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-[#1E2638] focus:outline-none focus:border-violet-500"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
          </div>
        )}
        {children ? (
          children
        ) : filteredOptions.length === 0 ? (
          <div className="px-3 py-2 text-xs text-slate-400 text-center">No options available</div>
        ) : (
          filteredOptions.map((opt) => (
            <SelectItem
              key={opt.internalValue}
              value={opt.internalValue}
              disabled={opt.disabled}
              className={opt.className}
            >
              {opt.label}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}

export { Select, SelectGroup, SelectValue, SelectTrigger, SelectContent, SelectItem, EMPTY_SENTINEL };
export default CustomSelect;
