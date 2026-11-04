import { describe, it } from 'node:test';
import assert from 'node:assert';
import React from 'react';
import { mergeTooltipTriggerProps } from '../src/utils/tooltipProps.js';

describe('Tooltip Trigger Props & Accessibility Merging Suite', () => {
  it('strips child native title attribute to prevent duplicate browser tooltips', () => {
    const trigger = React.createElement('button', {
      type: 'button',
      title: 'Old Native Browser Tooltip',
      'aria-label': 'Action'
    }, 'Trigger Button');

    const merged = mergeTooltipTriggerProps(trigger, {
      triggerRef: { current: null },
      showTooltip: () => {},
      hideTooltip: () => {},
      isOpen: false,
      content: 'Portal Tooltip',
      tooltipId: 'tooltip-1'
    });

    assert.strictEqual(merged.props.title, undefined, 'Native title attribute must be set to undefined');
    assert.strictEqual(merged.props['aria-label'], 'Action', 'Original aria-label must be preserved');
  });

  it('preserves existing event handlers and invokes both original handler and tooltip action', () => {
    let originalClickFired = false;
    let originalMouseEnterFired = false;
    let originalMouseLeaveFired = false;
    let originalFocusFired = false;
    let originalBlurFired = false;

    let tooltipShowCalled = false;
    let tooltipHideCalled = false;

    const trigger = React.createElement('button', {
      type: 'button',
      onClick: () => { originalClickFired = true; },
      onMouseEnter: () => { originalMouseEnterFired = true; },
      onMouseLeave: () => { originalMouseLeaveFired = true; },
      onFocus: () => { originalFocusFired = true; },
      onBlur: () => { originalBlurFired = true; }
    }, 'Interactive');

    const merged = mergeTooltipTriggerProps(trigger, {
      triggerRef: { current: null },
      showTooltip: () => { tooltipShowCalled = true; },
      hideTooltip: () => { tooltipHideCalled = true; },
      isOpen: false,
      content: 'Sample Content',
      tooltipId: 'tooltip-2'
    });

    // Simulate mouseEnter
    merged.props.onMouseEnter({ stopPropagation: () => {} });
    assert.strictEqual(originalMouseEnterFired, true, 'Original onMouseEnter must be called');
    assert.strictEqual(tooltipShowCalled, true, 'showTooltip must be called on mouseEnter');

    // Simulate mouseLeave
    merged.props.onMouseLeave({ stopPropagation: () => {} });
    assert.strictEqual(originalMouseLeaveFired, true, 'Original onMouseLeave must be called');
    assert.strictEqual(tooltipHideCalled, true, 'hideTooltip must be called on mouseLeave');

    // Simulate focus
    tooltipShowCalled = false;
    merged.props.onFocus({ stopPropagation: () => {} });
    assert.strictEqual(originalFocusFired, true, 'Original onFocus must be called');
    assert.strictEqual(tooltipShowCalled, true, 'showTooltip must be called on focus');

    // Simulate blur
    tooltipHideCalled = false;
    merged.props.onBlur({ stopPropagation: () => {} });
    assert.strictEqual(originalBlurFired, true, 'Original onBlur must be called');
    assert.strictEqual(tooltipHideCalled, true, 'hideTooltip must be called on blur');

    // Simulate click
    tooltipHideCalled = false;
    merged.props.onClick({ stopPropagation: () => {} });
    assert.strictEqual(originalClickFired, true, 'Original onClick must be called');
    assert.strictEqual(tooltipHideCalled, true, 'hideTooltip must be called on click');
  });

  it('merges functional refs without breaking child ref access', () => {
    let capturedNode = null;
    const triggerRef = { current: null };

    const trigger = React.createElement('button', {
      type: 'button',
      ref: (node) => { capturedNode = node; }
    }, 'Ref Button');

    const merged = mergeTooltipTriggerProps(trigger, {
      triggerRef,
      showTooltip: () => {},
      hideTooltip: () => {},
      isOpen: false,
      content: 'Ref Content',
      tooltipId: 'tooltip-3'
    });

    const mockDomNode = { getBoundingClientRect: () => ({ top: 10, left: 10, width: 50, height: 20 }) };
    merged.ref(mockDomNode);

    assert.strictEqual(capturedNode, mockDomNode, 'Original functional child ref must receive the DOM node');
    assert.strictEqual(triggerRef.current, mockDomNode, 'Internal triggerRef must also capture the DOM node');
  });

  it('merges object refs without breaking child ref access', () => {
    const childObjectRef = { current: null };
    const triggerRef = { current: null };

    const trigger = React.createElement('button', {
      type: 'button',
      ref: childObjectRef
    }, 'Object Ref Button');

    const merged = mergeTooltipTriggerProps(trigger, {
      triggerRef,
      showTooltip: () => {},
      hideTooltip: () => {},
      isOpen: false,
      content: 'Object Ref Content',
      tooltipId: 'tooltip-4'
    });

    const mockDomNode = { id: 'btn-1' };
    merged.ref(mockDomNode);

    assert.strictEqual(childObjectRef.current, mockDomNode, 'Original object child ref must receive the DOM node');
    assert.strictEqual(triggerRef.current, mockDomNode, 'Internal triggerRef must also capture the DOM node');
  });

  it('sets aria-describedby when isOpen=true and aria-label differs', () => {
    const trigger = React.createElement('button', {
      type: 'button',
      'aria-label': 'Short Label',
      'aria-describedby': 'existing-desc'
    }, 'Button');

    const merged = mergeTooltipTriggerProps(trigger, {
      triggerRef: { current: null },
      showTooltip: () => {},
      hideTooltip: () => {},
      isOpen: true,
      content: 'Detailed explanation text',
      tooltipId: 'tooltip-5'
    });

    assert.strictEqual(merged.props['aria-describedby'], 'existing-desc tooltip-5', 'Appends tooltipId to existing aria-describedby');
  });

  it('omits duplicate aria-describedby when aria-label matches tooltip text exactly', () => {
    const trigger = React.createElement('button', {
      type: 'button',
      'aria-label': 'Exact Label'
    }, 'Button');

    const merged = mergeTooltipTriggerProps(trigger, {
      triggerRef: { current: null },
      showTooltip: () => {},
      hideTooltip: () => {},
      isOpen: true,
      content: 'Exact Label',
      tooltipId: 'tooltip-6'
    });

    assert.strictEqual(merged.props['aria-describedby'], undefined, 'Must not duplicate identical accessible descriptions');
  });
});
