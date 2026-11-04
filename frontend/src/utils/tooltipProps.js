import { cloneElement, isValidElement } from 'react';

/**
 * Merges child trigger props with tooltip handlers, refs, and accessibility attributes.
 * Preserves existing event handlers, strips native title to avoid duplicate tooltips,
 * and attaches aria-describedby without duplicating identical aria-labels.
 *
 * @param {import('react').ReactElement} child
 * @param {Object} options
 * @param {import('react').MutableRefObject} options.triggerRef
 * @param {Function} options.showTooltip
 * @param {Function} options.hideTooltip
 * @param {boolean} options.isOpen
 * @param {string|import('react').ReactNode} options.content
 * @param {string} options.tooltipId
 * @returns {import('react').ReactElement}
 */
export function mergeTooltipTriggerProps(child, {
  triggerRef,
  showTooltip,
  hideTooltip,
  isOpen,
  content,
  tooltipId
}) {
  if (!isValidElement(child)) {
    return child;
  }

  const childRef = child.ref;

  const mergedRef = (node) => {
    if (triggerRef) {
      triggerRef.current = node;
    }
    if (typeof childRef === 'function') {
      childRef(node);
    } else if (childRef && typeof childRef === 'object') {
      childRef.current = node;
    }
  };

  const handleMouseEnter = (e) => {
    child.props.onMouseEnter?.(e);
    showTooltip?.(false);
  };

  const handleMouseLeave = (e) => {
    child.props.onMouseLeave?.(e);
    hideTooltip?.();
  };

  const handleFocus = (e) => {
    child.props.onFocus?.(e);
    showTooltip?.(true);
  };

  const handleBlur = (e) => {
    child.props.onBlur?.(e);
    hideTooltip?.();
  };

  const handleClick = (e) => {
    child.props.onClick?.(e);
    hideTooltip?.();
  };

  // Determine accessible description: avoid duplicating if aria-label is identical
  const ariaLabel = child.props['aria-label'];
  const hasMatchingAriaLabel = typeof content === 'string' && ariaLabel === content.trim();
  const existingDescribedBy = child.props['aria-describedby'];
  const ariaDescribedBy = isOpen && !hasMatchingAriaLabel
    ? [existingDescribedBy, tooltipId].filter(Boolean).join(' ')
    : existingDescribedBy;

  return cloneElement(child, {
    ref: mergedRef,
    title: undefined, // Strip native title attribute to prevent duplicate browser tooltips
    'aria-describedby': ariaDescribedBy,
    onMouseEnter: handleMouseEnter,
    onMouseLeave: handleMouseLeave,
    onFocus: handleFocus,
    onBlur: handleBlur,
    onClick: handleClick
  });
}
