import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useId,
  isValidElement
} from 'react';
import { createPortal } from 'react-dom';
import { calculateTooltipPosition } from '../../utils/tooltipPosition';
import { mergeTooltipTriggerProps } from '../../utils/tooltipProps';

/**
 * Standardized, portal-rendered QA Platform Tooltip.
 * Escapes ancestor stacking contexts, backdrop filters, and overflow clipping.
 *
 * @param {Object} props
 * @param {React.ReactNode} props.content - Tooltip text or node
 * @param {React.ReactElement} props.children - Single child trigger element
 * @param {'top'|'bottom'|'left'|'right'} [props.side='top'] - Desired side
 * @param {'start'|'center'|'end'} [props.align='center'] - Alignment
 * @param {number} [props.sideOffset=8] - Distance from trigger
 * @param {number} [props.alignOffset=0] - Alignment offset
 * @param {number} [props.delay=120] - Hover debounce in ms
 * @param {boolean} [props.disabled=false] - Disable tooltip
 * @param {boolean} [props.arrow=true] - Render pointer arrow
 * @param {string} [props.className=''] - Custom styling
 */
export default function Tooltip({
  content,
  children,
  side = 'top',
  align = 'center',
  sideOffset = 8,
  alignOffset = 0,
  delay = 120,
  disabled = false,
  arrow = true,
  className = ''
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, actualSide: side });
  const triggerRef = useRef(null);
  const tooltipRef = useRef(null);
  const showTimeoutRef = useRef(null);
  const isEscapePressedRef = useRef(false);
  const tooltipId = useId();

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const triggerRect = triggerRef.current.getBoundingClientRect();

    // Check if trigger is detached or completely outside the viewport
    if (
      triggerRect.width === 0 && triggerRect.height === 0 ||
      triggerRect.bottom < 0 ||
      triggerRect.top > window.innerHeight ||
      triggerRect.right < 0 ||
      triggerRect.left > window.innerWidth
    ) {
      setIsOpen(false);
      return;
    }

    const tooltipRect = tooltipRef.current
      ? tooltipRef.current.getBoundingClientRect()
      : { width: 120, height: 32 };

    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight
    };

    const calculated = calculateTooltipPosition(triggerRect, tooltipRect, viewport, {
      side,
      align,
      sideOffset,
      alignOffset
    });

    setCoords(calculated);
  }, [side, align, sideOffset, alignOffset]);

  const showTooltip = useCallback((immediate = false) => {
    if (disabled || !content || isEscapePressedRef.current) return;
    if (showTimeoutRef.current) clearTimeout(showTimeoutRef.current);

    if (immediate || delay <= 0) {
      setIsOpen(true);
    } else {
      showTimeoutRef.current = setTimeout(() => {
        setIsOpen(true);
      }, delay);
    }
  }, [disabled, content, delay]);

  const hideTooltip = useCallback(() => {
    if (showTimeoutRef.current) {
      clearTimeout(showTimeoutRef.current);
      showTimeoutRef.current = null;
    }
    setIsOpen(false);
    isEscapePressedRef.current = false;
  }, []);

  // Update position when opened or when trigger/window changes
  useEffect(() => {
    if (!isOpen) return;

    updatePosition();

    const handleScrollOrResize = () => {
      updatePosition();
    };

    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        isEscapePressedRef.current = true;
        hideTooltip();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, updatePosition, hideTooltip]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (showTimeoutRef.current) clearTimeout(showTimeoutRef.current);
    };
  }, []);

  // If content is empty or invalid, return children directly
  if (!content || disabled || !isValidElement(children)) {
    return children;
  }

  // Clone child trigger to merge event handlers, refs, and accessible attributes
  const triggerElement = mergeTooltipTriggerProps(children, {
    triggerRef,
    showTooltip,
    hideTooltip,
    isOpen,
    content,
    tooltipId
  });

  // Render Portal Tooltip to document.body
  const tooltipPortal = isOpen && typeof document !== 'undefined'
    ? createPortal(
        <div
          id={tooltipId}
          ref={tooltipRef}
          role="tooltip"
          className={`fixed pointer-events-none z-[99999] px-2.5 py-1.5 rounded-lg text-xs font-semibold shadow-xl whitespace-nowrap flex items-center transition-opacity duration-150 animate-fadeIn ${
            // Light & Dark theme token styling
            'bg-white/95 text-[#1F2544] border border-[rgba(99,102,241,0.2)] backdrop-blur-md ' +
            'dark:bg-[#0D111A]/95 dark:text-slate-100 dark:border-[#1E2638] dark:shadow-2xl'
          } ${className}`}
          style={{
            top: `${coords.top}px`,
            left: `${coords.left}px`
          }}
        >
          {arrow && (
            <span
              className={`absolute w-2 h-2 rotate-45 pointer-events-none ${
                coords.actualSide === 'top'
                  ? 'bottom-[-4px] left-1/2 -translate-x-1/2 border-r border-b bg-white dark:bg-[#0D111A] border-[rgba(99,102,241,0.2)] dark:border-[#1E2638]'
                  : coords.actualSide === 'bottom'
                  ? 'top-[-4px] left-1/2 -translate-x-1/2 border-l border-t bg-white dark:bg-[#0D111A] border-[rgba(99,102,241,0.2)] dark:border-[#1E2638]'
                  : coords.actualSide === 'left'
                  ? 'right-[-4px] top-1/2 -translate-y-1/2 border-r border-t bg-white dark:bg-[#0D111A] border-[rgba(99,102,241,0.2)] dark:border-[#1E2638]'
                  : 'left-[-4px] top-1/2 -translate-y-1/2 border-l border-b bg-white dark:bg-[#0D111A] border-[rgba(99,102,241,0.2)] dark:border-[#1E2638]'
              }`}
            />
          )}
          <span className="relative z-10 leading-tight">{content}</span>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      {triggerElement}
      {tooltipPortal}
    </>
  );
}
