const { test, describe } = require('node:test');
const assert = require('node:assert');

const {
  isMacPlatform,
  getShortcutModifierLabel,
  formatShortcutLabel,
  isEditableElement,
  isActionShortcut,
  MAC_OPTION_LIGATURES
} = require('../src/utils/shortcutUtils');

describe('Phase 3: Cross-Platform Keyboard Shortcut Suite (macOS Option+Q & Windows/Linux Alt+Q)', () => {

  describe('1. Platform Detection & Modifier Labeling', () => {
    test('detects macOS via modern navigator.userAgentData.platform', () => {
      const mockNav = { userAgentData: { platform: 'macOS' } };
      assert.strictEqual(isMacPlatform(mockNav), true);
      assert.strictEqual(getShortcutModifierLabel(mockNav), 'Option');
      assert.strictEqual(formatShortcutLabel('Q', mockNav), 'Option + Q');
    });

    test('detects macOS via legacy navigator.platform (MacIntel)', () => {
      const mockNav = { platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
      assert.strictEqual(isMacPlatform(mockNav), true);
      assert.strictEqual(getShortcutModifierLabel(mockNav), 'Option');
      assert.strictEqual(formatShortcutLabel('Q', mockNav), 'Option + Q');
      assert.strictEqual(formatShortcutLabel('R', mockNav, '+'), 'Option+R');
    });

    test('detects Windows via navigator.userAgentData.platform', () => {
      const mockNav = { userAgentData: { platform: 'Windows' }, platform: 'Win32' };
      assert.strictEqual(isMacPlatform(mockNav), false);
      assert.strictEqual(getShortcutModifierLabel(mockNav), 'Alt');
      assert.strictEqual(formatShortcutLabel('Q', mockNav), 'Alt + Q');
    });

    test('detects Linux via navigator.platform', () => {
      const mockNav = { platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' };
      assert.strictEqual(isMacPlatform(mockNav), false);
      assert.strictEqual(getShortcutModifierLabel(mockNav), 'Alt');
      assert.strictEqual(formatShortcutLabel('Q', mockNav), 'Alt + Q');
    });

    test('safely defaults to Alt when navigator is missing or empty', () => {
      assert.strictEqual(isMacPlatform(null), false);
      assert.strictEqual(getShortcutModifierLabel(null), 'Alt');
      assert.strictEqual(formatShortcutLabel('Q', null), 'Alt + Q');
    });
  });

  describe('2. macOS Option + Q Shortcut Handling', () => {
    test('Option + Q on macOS (with physical code KeyQ and character ligature œ) is recognized', () => {
      // Standard macOS US layout emits code: 'KeyQ', key: 'œ' under Option key
      const macEvent = {
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        repeat: false,
        code: 'KeyQ',
        key: 'œ'
      };

      assert.strictEqual(isActionShortcut(macEvent, 'KeyQ', 'q', 'œ'), true);
    });

    test('Option + Q on macOS is recognized even if code is missing but ligature œ is present', () => {
      const macEvent = {
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        repeat: false,
        code: '',
        key: 'œ'
      };

      assert.strictEqual(isActionShortcut(macEvent, 'KeyQ', 'q', 'œ'), true);
    });

    test('Option + Q on macOS is recognized when key is lowercase q or uppercase Q', () => {
      const macEvent1 = { altKey: true, ctrlKey: false, metaKey: false, repeat: false, code: 'KeyQ', key: 'q' };
      const macEvent2 = { altKey: true, ctrlKey: false, metaKey: false, repeat: false, code: 'KeyQ', key: 'Q' };

      assert.strictEqual(isActionShortcut(macEvent1, 'KeyQ', 'q', 'œ'), true);
      assert.strictEqual(isActionShortcut(macEvent2, 'KeyQ', 'q', 'œ'), true);
    });
  });

  describe('3. Windows & Linux Alt + Q Shortcut Handling', () => {
    test('Alt + Q on Windows/Linux (code: KeyQ, key: q) is recognized', () => {
      const winEvent = {
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        repeat: false,
        code: 'KeyQ',
        key: 'q'
      };

      assert.strictEqual(isActionShortcut(winEvent, 'KeyQ', 'q', 'œ'), true);
    });

    test('Alt + Q on Windows/Linux with uppercase key Q is recognized', () => {
      const winEvent = {
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        repeat: false,
        code: 'KeyQ',
        key: 'Q'
      };

      assert.strictEqual(isActionShortcut(winEvent, 'KeyQ', 'q', 'œ'), true);
    });
  });

  describe('4. Controlled ADB Device Operation Shortcuts (macOS Ligatures & Windows Codes)', () => {
    test('Relaunch (Alt/Option + R): matches KeyR and macOS ligature ®', () => {
      const macR = { altKey: true, ctrlKey: false, metaKey: false, repeat: false, code: 'KeyR', key: '®' };
      const winR = { altKey: true, ctrlKey: false, metaKey: false, repeat: false, code: 'KeyR', key: 'r' };

      assert.strictEqual(isActionShortcut(macR, 'KeyR', 'r', MAC_OPTION_LIGATURES.KeyR), true);
      assert.strictEqual(isActionShortcut(winR, 'KeyR', 'r', MAC_OPTION_LIGATURES.KeyR), true);
    });

    test('Clear App Data (Alt/Option + D): matches KeyD and macOS ligature ∂', () => {
      const macD = { altKey: true, ctrlKey: false, metaKey: false, repeat: false, code: 'KeyD', key: '∂' };
      const winD = { altKey: true, ctrlKey: false, metaKey: false, repeat: false, code: 'KeyD', key: 'd' };

      assert.strictEqual(isActionShortcut(macD, 'KeyD', 'd', MAC_OPTION_LIGATURES.KeyD), true);
      assert.strictEqual(isActionShortcut(winD, 'KeyD', 'd', MAC_OPTION_LIGATURES.KeyD), true);
    });

    test('Clear Cache (Alt/Option + C): matches KeyC and macOS ligature ç', () => {
      const macC = { altKey: true, ctrlKey: false, metaKey: false, repeat: false, code: 'KeyC', key: 'ç' };
      const winC = { altKey: true, ctrlKey: false, metaKey: false, repeat: false, code: 'KeyC', key: 'c' };

      assert.strictEqual(isActionShortcut(macC, 'KeyC', 'c', MAC_OPTION_LIGATURES.KeyC), true);
      assert.strictEqual(isActionShortcut(winC, 'KeyC', 'c', MAC_OPTION_LIGATURES.KeyC), true);
    });

    test('Uninstall App (Alt/Option + U): matches KeyU and macOS dead key ligature ¨', () => {
      const macU = { altKey: true, ctrlKey: false, metaKey: false, repeat: false, code: 'KeyU', key: '¨' };
      const winU = { altKey: true, ctrlKey: false, metaKey: false, repeat: false, code: 'KeyU', key: 'u' };

      assert.strictEqual(isActionShortcut(macU, 'KeyU', 'u', MAC_OPTION_LIGATURES.KeyU), true);
      assert.strictEqual(isActionShortcut(winU, 'KeyU', 'u', MAC_OPTION_LIGATURES.KeyU), true);
    });
  });

  describe('5. Duplicate Event & Key Repeat Prevention', () => {
    test('rejects repeated keydown event when key is held down (event.repeat = true)', () => {
      const repeatEvent = {
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        repeat: true, // Key held down
        code: 'KeyQ',
        key: 'œ'
      };

      assert.strictEqual(isActionShortcut(repeatEvent, 'KeyQ', 'q', 'œ'), false);
    });
  });

  describe('6. Modifier Exclusivity & Conflict Prevention', () => {
    test('rejects shortcut when Cmd / Meta key is also pressed (e.g. Cmd+Option+Q)', () => {
      const cmdOptQ = {
        altKey: true,
        ctrlKey: false,
        metaKey: true, // Cmd pressed
        repeat: false,
        code: 'KeyQ',
        key: 'œ'
      };

      assert.strictEqual(isActionShortcut(cmdOptQ, 'KeyQ', 'q', 'œ'), false);
    });

    test('rejects shortcut when Ctrl key is also pressed (e.g. Ctrl+Alt+Q)', () => {
      const ctrlAltQ = {
        altKey: true,
        ctrlKey: true, // Ctrl pressed
        metaKey: false,
        repeat: false,
        code: 'KeyQ',
        key: 'q'
      };

      assert.strictEqual(isActionShortcut(ctrlAltQ, 'KeyQ', 'q', 'œ'), false);
    });

    test('rejects shortcut when Alt/Option is NOT pressed', () => {
      const plainQ = {
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        repeat: false,
        code: 'KeyQ',
        key: 'q'
      };

      assert.strictEqual(isActionShortcut(plainQ, 'KeyQ', 'q', 'œ'), false);
    });

    test('rejects different physical keys (e.g. Option + W)', () => {
      const optW = {
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        repeat: false,
        code: 'KeyW',
        key: '∑'
      };

      assert.strictEqual(isActionShortcut(optW, 'KeyQ', 'q', 'œ'), false);
    });
  });

  describe('7. Editable Element Suppression', () => {
    test('suppresses shortcut when event target is an INPUT', () => {
      const targetInput = { tagName: 'INPUT' };
      assert.strictEqual(isEditableElement(targetInput), true);
    });

    test('suppresses shortcut when event target is a TEXTAREA', () => {
      const targetTextarea = { tagName: 'TEXTAREA' };
      assert.strictEqual(isEditableElement(targetTextarea), true);
    });

    test('suppresses shortcut when event target is a SELECT', () => {
      const targetSelect = { tagName: 'SELECT' };
      assert.strictEqual(isEditableElement(targetSelect), true);
    });

    test('suppresses shortcut when event target is contentEditable', () => {
      const targetEditable = { isContentEditable: true };
      assert.strictEqual(isEditableElement(targetEditable), true);
    });

    test('suppresses shortcut when event target is inside an editable container via closest()', () => {
      const targetChild = {
        tagName: 'SPAN',
        closest: (selector) => selector.includes('input') ? { tagName: 'INPUT' } : null
      };
      assert.strictEqual(isEditableElement(targetChild), true);
    });

    test('allows shortcut when target is a button or body or div', () => {
      const targetDiv = { tagName: 'DIV', isContentEditable: false, closest: () => null };
      const targetButton = { tagName: 'BUTTON', isContentEditable: false, closest: () => null };

      assert.strictEqual(isEditableElement(targetDiv), false);
      assert.strictEqual(isEditableElement(targetButton), false);
    });
  });

  describe('8. Single Execution and preventDefault Verification', () => {
    test('invokes action exactly once and prevents default only when shortcut matches', () => {
      let actionCalls = 0;
      let preventDefaultCalls = 0;

      const runPadAction = () => { actionCalls++; };

      const simulateKeyDown = (event) => {
        if (!event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
        if (isEditableElement(event.target)) return;

        if (isActionShortcut(event, 'KeyQ', 'q', 'œ')) {
          if (typeof event.preventDefault === 'function') event.preventDefault();
          runPadAction();
        }
      };

      const matchedEvent = {
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        repeat: false,
        code: 'KeyQ',
        key: 'œ',
        target: { tagName: 'BODY', closest: () => null },
        preventDefault: () => { preventDefaultCalls++; }
      };

      simulateKeyDown(matchedEvent);

      assert.strictEqual(actionCalls, 1, 'Action should be called exactly once');
      assert.strictEqual(preventDefaultCalls, 1, 'preventDefault should be called on match');

      // Unrelated key should not call action or preventDefault
      const unrelatedEvent = {
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        repeat: false,
        code: 'KeyZ',
        key: 'Ω',
        target: { tagName: 'BODY', closest: () => null },
        preventDefault: () => { preventDefaultCalls++; }
      };

      simulateKeyDown(unrelatedEvent);
      assert.strictEqual(actionCalls, 1, 'Action must NOT be called for unrelated key');
      assert.strictEqual(preventDefaultCalls, 1, 'preventDefault must NOT be called for unmatched event');
    });
  });
});
