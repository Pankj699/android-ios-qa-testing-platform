import test, { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { dialogShortcutManager, DialogShortcutManager } from '../src/utils/dialogShortcuts.js';

describe('Global Dialog Keyboard Shortcuts Suite', () => {
  let manager;

  beforeEach(() => {
    manager = new DialogShortcutManager();
  });

  // Mock KeyboardEvent factory
  function createKeyEvent(key, {
    ctrlKey = false,
    metaKey = false,
    altKey = false,
    shiftKey = false,
    repeat = false,
    isComposing = false,
    defaultPrevented = false,
    target = null
  } = {}) {
    let prevented = defaultPrevented;
    let stopped = false;
    return {
      key,
      code: key === 'Enter' ? 'Enter' : key === 'Escape' ? 'Escape' : key,
      ctrlKey,
      metaKey,
      altKey,
      shiftKey,
      repeat,
      isComposing,
      get defaultPrevented() { return prevented; },
      preventDefault: () => { prevented = true; },
      stopPropagation: () => { stopped = true; },
      get isPropagationStopped() { return stopped; },
      target: target || { tagName: 'DIV' }
    };
  }

  describe('1. Enter — Primary Action Activation', () => {
    it('activates onPrimaryAction when Enter is pressed on an open dialog', () => {
      let primaryInvoked = false;
      manager.register({
        id: 'test-dialog',
        onPrimaryAction: () => { primaryInvoked = true; }
      });

      const event = createKeyEvent('Enter');
      manager.handleKeyDown(event);

      assert.strictEqual(primaryInvoked, true, 'Primary action must be invoked on Enter');
      assert.strictEqual(event.defaultPrevented, true, 'Event default must be prevented');
    });

    it('falls back to onSubmit if onPrimaryAction is not explicitly provided', () => {
      let submitInvoked = false;
      manager.register({
        id: 'test-dialog',
        onSubmit: () => { submitInvoked = true; }
      });

      const event = createKeyEvent('Enter');
      manager.handleKeyDown(event);

      assert.strictEqual(submitInvoked, true, 'onSubmit should be called when onPrimaryAction is absent');
    });

    it('does NOT activate primary action if disabled: true', () => {
      let primaryInvoked = false;
      manager.register({
        id: 'test-dialog',
        onPrimaryAction: () => { primaryInvoked = true; },
        disabled: true
      });

      const event = createKeyEvent('Enter');
      manager.handleKeyDown(event);

      assert.strictEqual(primaryInvoked, false, 'Disabled dialog must not execute primary action');
      assert.strictEqual(event.defaultPrevented, false);
    });

    it('does NOT activate primary action if loading: true', () => {
      let primaryInvoked = false;
      manager.register({
        id: 'test-dialog',
        onPrimaryAction: () => { primaryInvoked = true; },
        loading: true
      });

      const event = createKeyEvent('Enter');
      manager.handleKeyDown(event);

      assert.strictEqual(primaryInvoked, false, 'Loading dialog must not execute primary action');
    });

    it('preserves native Enter in a textarea to insert a newline (no primary action)', () => {
      let primaryInvoked = false;
      manager.register({
        id: 'test-dialog',
        onPrimaryAction: () => { primaryInvoked = true; }
      });

      const textareaTarget = { tagName: 'TEXTAREA' };
      const event = createKeyEvent('Enter', { target: textareaTarget });
      manager.handleKeyDown(event);

      assert.strictEqual(primaryInvoked, false, 'Enter in textarea must NOT trigger primary action');
      assert.strictEqual(event.defaultPrevented, false, 'Textarea must retain native Enter behavior');
    });

    it('preserves native Enter when keyboard focus is on a secondary button (e.g. Cancel)', () => {
      let primaryInvoked = false;
      manager.register({
        id: 'test-dialog',
        onPrimaryAction: () => { primaryInvoked = true; }
      });

      const cancelButton = { tagName: 'BUTTON', textContent: 'Cancel' };
      const event = createKeyEvent('Enter', { target: cancelButton });
      manager.handleKeyDown(event);

      assert.strictEqual(primaryInvoked, false, 'Enter on focused button must not trigger primary action');
      assert.strictEqual(event.defaultPrevented, false, 'Focused button must receive native click');
    });
  });

  describe('2. Ctrl + Enter & Cmd + Enter — Form & Editable Dialog Submission', () => {
    it('executes onSubmit when Ctrl + Enter is pressed on Windows/Linux', () => {
      let submitInvoked = false;
      manager.register({
        id: 'test-form-dialog',
        onSubmit: () => { submitInvoked = true; }
      });

      const event = createKeyEvent('Enter', { ctrlKey: true });
      manager.handleKeyDown(event);

      assert.strictEqual(submitInvoked, true, 'Ctrl + Enter must invoke onSubmit');
      assert.strictEqual(event.defaultPrevented, true);
    });

    it('executes onSubmit when Cmd + Enter is pressed on macOS (metaKey)', () => {
      let submitInvoked = false;
      manager.register({
        id: 'test-form-dialog',
        onSubmit: () => { submitInvoked = true; }
      });

      const event = createKeyEvent('Enter', { metaKey: true });
      manager.handleKeyDown(event);

      assert.strictEqual(submitInvoked, true, 'Cmd + Enter must invoke onSubmit');
      assert.strictEqual(event.defaultPrevented, true);
    });

    it('submits form from inside a textarea on Ctrl + Enter', () => {
      let submitInvoked = false;
      manager.register({
        id: 'test-form-dialog',
        onSubmit: () => { submitInvoked = true; }
      });

      const textareaTarget = { tagName: 'TEXTAREA' };
      const event = createKeyEvent('Enter', { ctrlKey: true, target: textareaTarget });
      manager.handleKeyDown(event);

      assert.strictEqual(submitInvoked, true, 'Ctrl + Enter inside textarea must invoke onSubmit');
      assert.strictEqual(event.defaultPrevented, true);
    });

    it('does NOT submit if disabled: true or loading: true on Ctrl + Enter', () => {
      let submitInvoked = false;
      manager.register({
        id: 'test-form-dialog',
        onSubmit: () => { submitInvoked = true; },
        disabled: true
      });

      const event = createKeyEvent('Enter', { ctrlKey: true });
      manager.handleKeyDown(event);

      assert.strictEqual(submitInvoked, false, 'Disabled state must block Ctrl + Enter submission');
    });
  });

  describe('3. Escape Dismissal', () => {
    it('dismisses dialog on Escape keypress', () => {
      let closeInvoked = false;
      manager.register({
        id: 'test-dialog',
        onClose: () => { closeInvoked = true; }
      });

      const event = createKeyEvent('Escape');
      manager.handleKeyDown(event);

      assert.strictEqual(closeInvoked, true, 'Escape must invoke onClose');
      assert.strictEqual(event.defaultPrevented, true);
    });

    it('blocks Escape dismissal when loading is true (in-flight action protection)', () => {
      let closeInvoked = false;
      manager.register({
        id: 'test-dialog',
        onClose: () => { closeInvoked = true; },
        loading: true
      });

      const event = createKeyEvent('Escape');
      manager.handleKeyDown(event);

      assert.strictEqual(closeInvoked, false, 'Escape should not dismiss while loading');
    });
  });

  describe('4. Nested Dialog Scoping & Topmost Routing', () => {
    it('routes Enter shortcut ONLY to the topmost dialog in a nested stack', () => {
      const calls = [];
      manager.register({
        id: 'parent-dialog',
        onPrimaryAction: () => { calls.push('parent:primary'); }
      });

      manager.register({
        id: 'nested-confirm-dialog',
        onPrimaryAction: () => { calls.push('nested:primary'); }
      });

      const event = createKeyEvent('Enter');
      manager.handleKeyDown(event);

      assert.deepStrictEqual(calls, ['nested:primary'], 'Only the topmost nested dialog should respond');

      // Now close/unregister the nested dialog
      manager.unregister('nested-confirm-dialog');

      const secondEvent = createKeyEvent('Enter');
      manager.handleKeyDown(secondEvent);

      assert.deepStrictEqual(calls, ['nested:primary', 'parent:primary'], 'Parent dialog receives shortcut after nested closes');
    });
  });

  describe('5. Safety Guards: Repeat, IME, and defaultPrevented', () => {
    it('ignores repeat keydown events when key is held down', () => {
      let callCount = 0;
      manager.register({
        id: 'test-dialog',
        onPrimaryAction: () => { callCount++; }
      });

      const repeatEvent = createKeyEvent('Enter', { repeat: true });
      manager.handleKeyDown(repeatEvent);

      assert.strictEqual(callCount, 0, 'repeat: true must not trigger action');
    });

    it('ignores Enter when IME composition is active (isComposing: true)', () => {
      let callCount = 0;
      manager.register({
        id: 'test-dialog',
        onPrimaryAction: () => { callCount++; }
      });

      const imeEvent = createKeyEvent('Enter', { isComposing: true });
      manager.handleKeyDown(imeEvent);

      assert.strictEqual(callCount, 0, 'isComposing: true must not trigger action');
    });

    it('respects defaultPrevented: true', () => {
      let callCount = 0;
      manager.register({
        id: 'test-dialog',
        onPrimaryAction: () => { callCount++; }
      });

      const preventedEvent = createKeyEvent('Enter', { defaultPrevented: true });
      manager.handleKeyDown(preventedEvent);

      assert.strictEqual(callCount, 0, 'defaultPrevented must not be overwritten');
    });
  });
});
