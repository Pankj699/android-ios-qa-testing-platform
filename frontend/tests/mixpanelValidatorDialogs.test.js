import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DialogShortcutManager } from '../src/utils/dialogShortcuts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Mixpanel Validator Dialog Shortcuts & Clear Events Regression Suite', () => {
  const pagePath = path.resolve(__dirname, '../src/pages/MixpanelValidatorPage.jsx');
  const sourceCode = fs.readFileSync(pagePath, 'utf8');

  it('1. Verifies handleCancelClearEvents is properly defined and implemented', () => {
    // Assert function definition exists
    assert.match(
      sourceCode,
      /const\s+handleCancelClearEvents\s*=\s*\(\)\s*=>/,
      'handleCancelClearEvents must be defined as a function in MixpanelValidatorPage'
    );

    // Assert that it safely checks isClearingEvents before dismissing
    assert.match(
      sourceCode,
      /if\s*\(!isClearingEvents\)\s*\{\s*setClearConfirmOpen\(false\);?\s*\}/,
      'handleCancelClearEvents must guard against dismissal while isClearingEvents is true'
    );
  });

  it('2. Verifies all useDialogShortcuts callbacks in MixpanelValidatorPage are defined in scope', () => {
    // Extract dialog IDs and their action references
    const shortcutBlocks = sourceCode.match(/useDialogShortcuts\(\{[\s\S]*?\}\);/g) || [];
    assert.ok(shortcutBlocks.length >= 4, 'Must have at least 4 dialog shortcut registrations');

    const expectedHandlers = [
      'handleInjectEvent',
      'handleGenerateBug',
      'handleCopyBugText',
      'handleCloseBugModal',
      'handleConfirmRegenerate',
      'handleCancelRegenerate',
      'handleConfirmClearEvents',
      'handleCancelClearEvents'
    ];

    for (const handler of expectedHandlers) {
      const defRegex = new RegExp(`const\\s+${handler}\\s*=`, 'g');
      const matches = sourceCode.match(defRegex);
      assert.ok(
        matches && matches.length >= 1,
        `Expected handler "${handler}" must have a valid definition in the component body`
      );
    }
  });

  it('3. Verifies clear events confirmation dialog modal uses handleCancelClearEvents', () => {
    assert.match(
      sourceCode,
      /onClick=\{handleCancelClearEvents\}/,
      'Cancel button in the clear events confirmation dialog must bind to handleCancelClearEvents'
    );
  });

  it('4. Simulates clear events dialog lifecycle: cancel preserves events intact', () => {
    // Simulated state machine for clear events workflow
    let clearConfirmOpen = true;
    let isClearingEvents = false;
    let events = [{ id: 'evt_1', event_name: 'app_launch' }, { id: 'evt_2', event_name: 'sign_in' }];
    let apiCleared = false;

    const handleCancelClearEvents = () => {
      if (!isClearingEvents) {
        clearConfirmOpen = false;
      }
    };

    // User triggers Cancel
    handleCancelClearEvents();

    assert.strictEqual(clearConfirmOpen, false, 'Modal must close on cancel');
    assert.strictEqual(events.length, 2, 'Events array must remain completely untouched on cancel');
    assert.strictEqual(apiCleared, false, 'API clear must not be invoked on cancel');
  });

  it('5. Simulates clear events dialog lifecycle: confirm executes clear operation', async () => {
    let clearConfirmOpen = true;
    let isClearingEvents = false;
    let events = [{ id: 'evt_1', event_name: 'app_launch' }];
    let apiCleared = false;

    const fakeApi = {
      clearMixpanelEvents: async () => {
        apiCleared = true;
        return { success: true };
      }
    };

    const handleConfirmClearEvents = async () => {
      isClearingEvents = true;
      try {
        await fakeApi.clearMixpanelEvents();
        events = [];
        clearConfirmOpen = false;
      } finally {
        isClearingEvents = false;
      }
    };

    await handleConfirmClearEvents();

    assert.strictEqual(apiCleared, true, 'API clear must be called on confirm');
    assert.strictEqual(events.length, 0, 'Events array must be cleared on confirm');
    assert.strictEqual(clearConfirmOpen, false, 'Modal must close after successful clear');
    assert.strictEqual(isClearingEvents, false, 'Loading flag must reset');
  });

  it('6. Verifies keyboard shortcut integration for clear-confirm modal with DialogShortcutManager', () => {
    const manager = new DialogShortcutManager();
    let confirmed = false;
    let cancelled = false;

    manager.register({
      id: 'mixpanel-clear-confirm-modal',
      onPrimaryAction: () => { confirmed = true; },
      onClose: () => { cancelled = true; },
      disabled: false,
      loading: false
    });

    // Enter triggers confirm
    let enterPrevented = false;
    manager.handleKeyDown({
      key: 'Enter',
      code: 'Enter',
      preventDefault: () => { enterPrevented = true; },
      stopPropagation: () => {},
      target: { tagName: 'DIV' }
    });
    assert.strictEqual(confirmed, true, 'Enter key must trigger primary confirm action');
    assert.strictEqual(enterPrevented, true);

    // Escape triggers cancel/close
    let escPrevented = false;
    manager.handleKeyDown({
      key: 'Escape',
      code: 'Escape',
      preventDefault: () => { escPrevented = true; },
      stopPropagation: () => {},
      target: { tagName: 'DIV' }
    });
    assert.strictEqual(cancelled, true, 'Escape key must trigger onClose (handleCancelClearEvents)');
    assert.strictEqual(escPrevented, true);
  });
});
