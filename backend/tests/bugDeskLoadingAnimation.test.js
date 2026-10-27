const { describe, test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

describe('BugDesk Report Generation Loading Animation Suite', () => {
  const jsxPath = path.resolve(__dirname, '../../frontend/src/bugdesk/pages/BugDeskNewBug.jsx');
  const cssPath = path.resolve(__dirname, '../../frontend/src/index.css');

  const jsxContent = fs.readFileSync(jsxPath, 'utf8');
  const cssContent = fs.readFileSync(cssPath, 'utf8');

  test('1. Loading indicator is rendered in the right column when loading is true', () => {
    assert.ok(jsxContent.includes('loading ? ('), 'Should check loading state in preview area');
    assert.ok(
      jsxContent.includes('data-testid="bugdesk-generating-loader"'),
      'Should include test id for loading container'
    );
    assert.ok(
      jsxContent.includes('role="status"'),
      'Should have role="status" for accessibility'
    );
    assert.ok(
      jsxContent.includes('aria-live="polite"'),
      'Should have aria-live="polite" for screen readers'
    );
    assert.ok(
      jsxContent.includes('aria-busy="true"'),
      'Should have aria-busy="true" during report generation'
    );
  });

  test('2. Displays exact required heading and supporting message', () => {
    assert.ok(
      jsxContent.includes('Generating your bug report'),
      'Must display the heading "Generating your bug report"'
    );
    assert.ok(
      jsxContent.includes('Analyzing QA notes and preparing reproduction steps...'),
      'Must display supporting message "Analyzing QA notes and preparing reproduction steps..."'
    );
  });

  test('3. Features animated icon with subtle glow and indeterminate progress bar', () => {
    assert.ok(
      jsxContent.includes('bg-gradient-to-r from-violet-500/20 via-fuchsia-500/20 to-pink-500/20'),
      'Glow should use purple/pink gradient accents'
    );
    assert.ok(
      jsxContent.includes('Sparkles className="h-7 w-7 text-violet-500 dark:text-violet-400'),
      'Should render Sparkles icon with violet theme colors'
    );
    assert.ok(
      jsxContent.includes('bugdesk-progress-bar'),
      'Must contain the indeterminate progress bar indicator class'
    );
    assert.ok(
      jsxContent.includes('bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-500'),
      'Progress bar must use smooth violet-to-pink gradient'
    );
  });

  test('4. Preserves identical container dimensions and layout classes to prevent jumping', () => {
    const commonClasses = 'h-full rounded-card border border-[var(--line)] glass p-8 flex flex-col items-center justify-center text-center shadow-sm';
    const matches = jsxContent.split(commonClasses).length - 1;
    assert.ok(
      matches >= 2,
      `Expected at least 2 instances of container classes (${commonClasses}) for loader and empty state, found ${matches}`
    );
  });

  test('5. Lifecycle: Prevents duplicate submissions while loading is true', () => {
    // 1. Guard inside handleGenerate
    assert.ok(
      jsxContent.includes('if (loading) return;'),
      'handleGenerate must guard against duplicate submissions when loading is true'
    );
    // 2. Button is disabled when loading is true
    assert.ok(
      jsxContent.includes('disabled={loading}'),
      'Submit button must be disabled when loading'
    );
    // 3. Keyboard shortcut ignores invocation when loading is true
    assert.ok(
      jsxContent.includes('if (loading) return;'),
      'Keyboard shortcut listener must check loading state'
    );
  });

  test('6. CSS defines GPU-accelerated indeterminate animation and prefers-reduced-motion fallback', () => {
    assert.ok(
      cssContent.includes('@keyframes bugdeskIndeterminate'),
      'CSS must define @keyframes bugdeskIndeterminate'
    );
    assert.ok(
      cssContent.includes('transform: translateX(-100%)'),
      'Keyframes should start before visible edge'
    );
    assert.ok(
      cssContent.includes('transform: translateX(200%)'),
      'Keyframes should translate across'
    );
    assert.ok(
      cssContent.includes('.bugdesk-progress-bar'),
      'CSS must define .bugdesk-progress-bar'
    );
    assert.ok(
      cssContent.includes('@media (prefers-reduced-motion: reduce)'),
      'CSS must support @media (prefers-reduced-motion: reduce)'
    );
    assert.ok(
      cssContent.includes('animation: none !important'),
      'Reduced motion must disable animation'
    );
    assert.ok(
      cssContent.includes('width: 100% !important'),
      'Reduced motion must display a full static indicator'
    );
  });

  test('7. JSX markup respects prefers-reduced-motion with motion-safe and motion-reduce variants', () => {
    assert.ok(
      jsxContent.includes('motion-safe:animate-pulse motion-reduce:hidden'),
      'Ambient glow should be hidden when reduced motion is preferred'
    );
    assert.ok(
      jsxContent.includes('motion-safe:animate-pulse motion-reduce:animate-none'),
      'Icon pulse animation should be disabled when reduced motion is preferred'
    );
  });

  test('8. Matches preview panel height to Bug Details form with items-stretch and dynamic height sync', () => {
    assert.ok(
      jsxContent.includes('grid-cols-1 gap-6 px-8 pb-8 lg:grid-cols-2 items-stretch'),
      'Grid container must use items-stretch so both columns match heights by default'
    );
    assert.ok(
      jsxContent.includes('ref={leftCardRef}'),
      'Left Bug Details card must attach leftCardRef to observe dynamic form height'
    );
    assert.ok(
      jsxContent.includes('isLgScreen && formHeight ? { maxHeight: `${formHeight}px` } : undefined'),
      'Right column must cap maxHeight to left form height on desktop to keep cards aligned'
    );
    assert.ok(
      !jsxContent.includes('min-h-[580px]'),
      'Hardcoded min-h-[580px] must be removed from BugDeskNewBug.jsx'
    );
  });

  test('9. Generated report supports internal scrolling without clipping controls', () => {
    const previewPath = path.resolve(__dirname, '../../frontend/src/bugdesk/components/BugReportPreview.jsx');
    const previewContent = fs.readFileSync(previewPath, 'utf8');

    assert.ok(
      previewContent.includes('overflow-y-auto'),
      'Report preview parchment area must be scrollable with overflow-y-auto'
    );
    assert.ok(
      previewContent.includes('shrink-0'),
      'Toolbars and action headers in preview must use shrink-0 to prevent clipping'
    );
    assert.ok(
      jsxContent.includes('className="flex-1 min-h-0 flex flex-col"'),
      'BugReportPreview in New Bug page must receive flex-1 min-h-0'
    );
  });
});

