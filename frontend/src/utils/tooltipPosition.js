/**
 * Pure positioning and viewport boundary calculation for QA Platform Tooltips.
 * Computes top/left coordinates, edge clamping, and automatic flip behavior.
 */

export const TOOLTIP_PADDING = 8;
export const DEFAULT_SIDE_OFFSET = 8;

/**
 * Calculates optimal tooltip coordinates relative to viewport.
 *
 * @param {Object} triggerRect - getBoundingClientRect() of trigger element
 * @param {Object} tooltipRect - getBoundingClientRect() or dimensions of tooltip element
 * @param {Object} viewport - { width: number, height: number }
 * @param {Object} options - { side: 'top'|'bottom'|'left'|'right', align: 'start'|'center'|'end', sideOffset: number, alignOffset: number }
 * @returns {Object} { top: number, left: number, actualSide: string, actualAlign: string }
 */
export function calculateTooltipPosition(triggerRect, tooltipRect, viewport, options = {}) {
  const side = options.side || 'top';
  const align = options.align || 'center';
  const sideOffset = typeof options.sideOffset === 'number' ? options.sideOffset : DEFAULT_SIDE_OFFSET;
  const alignOffset = typeof options.alignOffset === 'number' ? options.alignOffset : 0;
  const padding = TOOLTIP_PADDING;

  const vpWidth = viewport.width || 1024;
  const vpHeight = viewport.height || 768;

  const tWidth = tooltipRect.width || 120;
  const tHeight = tooltipRect.height || 32;

  let actualSide = side;

  // 1. Flip logic if overflowing opposite edge and opposite side has room
  if (side === 'top') {
    const topPos = triggerRect.top - sideOffset - tHeight;
    if (topPos < padding && triggerRect.bottom + sideOffset + tHeight <= vpHeight - padding) {
      actualSide = 'bottom';
    }
  } else if (side === 'bottom') {
    const bottomPos = triggerRect.bottom + sideOffset + tHeight;
    if (bottomPos > vpHeight - padding && triggerRect.top - sideOffset - tHeight >= padding) {
      actualSide = 'top';
    }
  } else if (side === 'left') {
    const leftPos = triggerRect.left - sideOffset - tWidth;
    if (leftPos < padding && triggerRect.right + sideOffset + tWidth <= vpWidth - padding) {
      actualSide = 'right';
    }
  } else if (side === 'right') {
    const rightPos = triggerRect.right + sideOffset + tWidth;
    if (rightPos > vpWidth - padding && triggerRect.left - sideOffset - tWidth >= padding) {
      actualSide = 'left';
    }
  }

  // 2. Base positioning calculation based on actualSide
  let top = 0;
  let left = 0;

  if (actualSide === 'top') {
    top = triggerRect.top - sideOffset - tHeight;
    left = calculateAlign(triggerRect.left, triggerRect.width, tWidth, align, alignOffset);
  } else if (actualSide === 'bottom') {
    top = triggerRect.bottom + sideOffset;
    left = calculateAlign(triggerRect.left, triggerRect.width, tWidth, align, alignOffset);
  } else if (actualSide === 'left') {
    left = triggerRect.left - sideOffset - tWidth;
    top = calculateAlign(triggerRect.top, triggerRect.height, tHeight, align, alignOffset);
  } else if (actualSide === 'right') {
    left = triggerRect.right + sideOffset;
    top = calculateAlign(triggerRect.top, triggerRect.height, tHeight, align, alignOffset);
  }

  // 3. Viewport boundary clamping to ensure tooltip is fully on-screen
  const maxLeft = Math.max(padding, vpWidth - tWidth - padding);
  const maxTop = Math.max(padding, vpHeight - tHeight - padding);

  left = Math.min(Math.max(padding, left), maxLeft);
  top = Math.min(Math.max(padding, top), maxTop);

  return {
    top: Math.round(top),
    left: Math.round(left),
    actualSide,
    actualAlign: align
  };
}

/**
 * Calculates aligned cross-axis coordinate.
 */
function calculateAlign(start, triggerDim, tooltipDim, align, offset) {
  if (align === 'start') {
    return start + offset;
  }
  if (align === 'end') {
    return start + triggerDim - tooltipDim + offset;
  }
  // Default 'center'
  return start + triggerDim / 2 - tooltipDim / 2 + offset;
}
