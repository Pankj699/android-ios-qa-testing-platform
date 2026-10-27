const { test, describe } = require('node:test');
const assert = require('node:assert');

const {
  isMacPlatform,
  getShortcutModifierLabel,
  formatShortcutLabel,
  isEditableElement,
  isActionShortcut,
  isModalDialogOpen,
  isGenerateShortcut,
  MAC_OPTION_LIGATURES
} = require('../src/utils/shortcutUtils');

describe('BugDesk & Platform Keyboard Shortcut Handling Suite', () => {

  describe('1. Generate Bug Report Shortcut Matching (Ctrl+Enter / Cmd+Enter)', () => {
    test('matches Ctrl + Enter on Windows/Linux', () => {
      const winEvent = {
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        repeat: false,
        key: 'Enter',
        code: 'Enter'
      };
      assert.strictEqual(isGenerateShortcut(winEvent), true);
    });

    test('matches Cmd/Meta + Enter on macOS', () => {
      const macEvent = {
        ctrlKey: false,
        metaKey: true,
        altKey: false,
        repeat: false,
        key: 'Enter',
        code: 'Enter'
      };
      assert.strictEqual(isGenerateShortcut(macEvent), true);
    });

    test('rejects plain Enter without Ctrl or Cmd', () => {
      const plainEnter = {
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        repeat: false,
        key: 'Enter',
        code: 'Enter'
      };
      assert.strictEqual(isGenerateShortcut(plainEnter), false);
    });

    test('rejects Ctrl + Enter when Alt/Option is also pressed (e.g. Ctrl+Alt+Enter)', () => {
      const ctrlAltEnter = {
        ctrlKey: true,
        metaKey: false,
        altKey: true,
        repeat: false,
        key: 'Enter',
        code: 'Enter'
      };
      assert.strictEqual(isGenerateShortcut(ctrlAltEnter), false);
    });

    test('rejects repeated Ctrl + Enter keydown events while held down', () => {
      const repeatEvent = {
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        repeat: true,
        key: 'Enter',
        code: 'Enter'
      };
      assert.strictEqual(isGenerateShortcut(repeatEvent), false);
    });

    test('rejects Ctrl + any key other than Enter', () => {
      const ctrlS = {
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        repeat: false,
        key: 's',
        code: 'KeyS'
      };
      assert.strictEqual(isGenerateShortcut(ctrlS), false);
    });
  });

  describe('2. Modal & Dialog Suppression (isModalDialogOpen)', () => {
    test('returns false when no dialog or modal overlay exists', () => {
      const mockDoc = {
        querySelector: () => null,
        activeElement: { tagName: 'TEXTAREA', closest: () => null }
      };
      assert.strictEqual(isModalDialogOpen(mockDoc), false);
    });

    test('returns true when a Radix dialog is open (role="dialog" data-state="open")', () => {
      const mockDoc = {
        querySelector: (sel) => {
          if (sel.includes('[role="dialog"][data-state="open"]')) {
            return { tagName: 'DIV' };
          }
          return null;
        },
        activeElement: { tagName: 'INPUT', closest: () => null }
      };
      assert.strictEqual(isModalDialogOpen(mockDoc), true);
    });

    test('returns true when a modal overlay is visible (.fixed.inset-0.z-50)', () => {
      const mockDoc = {
        querySelector: (sel) => {
          if (sel.includes('.fixed.inset-0.z-50')) {
            return { tagName: 'DIV' };
          }
          return null;
        },
        activeElement: { tagName: 'BODY', closest: () => null }
      };
      assert.strictEqual(isModalDialogOpen(mockDoc), true);
    });

    test('returns true when activeElement is inside a dialog container', () => {
      const mockDoc = {
        querySelector: () => null,
        activeElement: {
          tagName: 'INPUT',
          closest: (sel) => sel.includes('[role="dialog"]') ? { tagName: 'DIV' } : null
        }
      };
      assert.strictEqual(isModalDialogOpen(mockDoc), true);
    });
  });

  describe('3. BugDesk New Bug Event Simulation (Scoping, Newline Prevention, Validation, Loading)', () => {
    function simulateNewBugHandler({
      isActive,
      isModalOpen,
      loading,
      rawNotes,
      event
    }) {
      let preventDefaultCalls = 0;
      let stopPropagationCalls = 0;
      let generateCalls = 0;
      let errorMessage = '';

      const handleGenerate = () => {
        if (!rawNotes || !rawNotes.trim()) {
          errorMessage = 'Please describe the bug in raw notes before generating.';
          return;
        }
        generateCalls++;
      };

      const handleKeyDown = (e) => {
        if (!isActive) return;

        if (isGenerateShortcut(e)) {
          if (isModalOpen) return;

          e.preventDefault();
          e.stopPropagation();

          if (loading) return;

          handleGenerate();
        }
      };

      const mockEvent = {
        ...event,
        preventDefault: () => { preventDefaultCalls++; },
        stopPropagation: () => { stopPropagationCalls++; }
      };

      handleKeyDown(mockEvent);

      return {
        preventDefaultCalls,
        stopPropagationCalls,
        generateCalls,
        errorMessage
      };
    }

    test('triggers report generation and prevents newline when active on New Bug with valid notes', () => {
      const res = simulateNewBugHandler({
        isActive: true,
        isModalOpen: false,
        loading: false,
        rawNotes: 'App crashes on button click',
        event: { ctrlKey: true, metaKey: false, altKey: false, repeat: false, key: 'Enter', code: 'Enter' }
      });

      assert.strictEqual(res.preventDefaultCalls, 1, 'Should call preventDefault to stop newline');
      assert.strictEqual(res.stopPropagationCalls, 1, 'Should stop propagation');
      assert.strictEqual(res.generateCalls, 1, 'Should invoke handleGenerate');
      assert.strictEqual(res.errorMessage, '');
    });

    test('prevents newline and displays validation error when notes are empty without generating', () => {
      const res = simulateNewBugHandler({
        isActive: true,
        isModalOpen: false,
        loading: false,
        rawNotes: '   ',
        event: { ctrlKey: true, metaKey: false, altKey: false, repeat: false, key: 'Enter', code: 'Enter' }
      });

      assert.strictEqual(res.preventDefaultCalls, 1, 'Should call preventDefault to stop newline even on invalid form');
      assert.strictEqual(res.generateCalls, 0, 'Should not generate report on invalid form');
      assert.strictEqual(res.errorMessage, 'Please describe the bug in raw notes before generating.');
    });

    test('prevents duplicate submissions when loading is true but still prevents newline', () => {
      const res = simulateNewBugHandler({
        isActive: true,
        isModalOpen: false,
        loading: true,
        rawNotes: 'App crashes',
        event: { ctrlKey: true, metaKey: false, altKey: false, repeat: false, key: 'Enter', code: 'Enter' }
      });

      assert.strictEqual(res.preventDefaultCalls, 1, 'Should prevent newline even while loading');
      assert.strictEqual(res.generateCalls, 0, 'Should not submit when loading');
    });

    test('does NOT trigger when modal dialog is open', () => {
      const res = simulateNewBugHandler({
        isActive: true,
        isModalOpen: true,
        loading: false,
        rawNotes: 'App crashes',
        event: { ctrlKey: true, metaKey: false, altKey: false, repeat: false, key: 'Enter', code: 'Enter' }
      });

      assert.strictEqual(res.preventDefaultCalls, 0, 'Should not intercept event when modal dialog owns keyboard');
      assert.strictEqual(res.generateCalls, 0, 'Should not generate report');
    });

    test('does NOT trigger when New Bug is NOT active (e.g. Dashboard, History, Settings, or other routes)', () => {
      const res = simulateNewBugHandler({
        isActive: false,
        isModalOpen: false,
        loading: false,
        rawNotes: 'App crashes',
        event: { ctrlKey: true, metaKey: false, altKey: false, repeat: false, key: 'Enter', code: 'Enter' }
      });

      assert.strictEqual(res.preventDefaultCalls, 0);
      assert.strictEqual(res.generateCalls, 0);
    });
  });

  describe('4. Platform Shortcuts Throughout BugDesk vs Unrelated Routes', () => {
    function simulatePlatformHandler({
      currentTab,
      isModalOpen,
      eventTarget,
      event
    }) {
      let triggeredAction = null;
      let preventDefaultCalls = 0;
      let stopPropagationCalls = 0;

      const handleAdbAction = (act) => { triggeredAction = act; };
      const handleStartTest = () => { triggeredAction = 'start-test'; };

      const handleKeyDown = (e) => {
        if (!e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;

        const isApplicableRoute = currentTab === 'run-test' || currentTab === 'bug-desk';
        if (!isApplicableRoute) return;

        if (isModalOpen) return;

        const isBugDeskActive = currentTab === 'bug-desk';
        if (!isBugDeskActive && isEditableElement(e.target)) return;

        if (isActionShortcut(e, 'KeyQ', 'q', 'œ')) {
          e.preventDefault();
          e.stopPropagation();
          handleStartTest();
        } else if (isActionShortcut(e, 'KeyR', 'r', '®')) {
          e.preventDefault();
          e.stopPropagation();
          handleAdbAction('launch');
        } else if (isActionShortcut(e, 'KeyD', 'd', '∂')) {
          e.preventDefault();
          e.stopPropagation();
          handleAdbAction('clear-data');
        } else if (isActionShortcut(e, 'KeyC', 'c', 'ç')) {
          e.preventDefault();
          e.stopPropagation();
          handleAdbAction('clear-cache');
        } else if (isActionShortcut(e, 'KeyU', 'u', '¨')) {
          e.preventDefault();
          e.stopPropagation();
          handleAdbAction('uninstall');
        }
      };

      const mockEvent = {
        ...event,
        target: eventTarget,
        preventDefault: () => { preventDefaultCalls++; },
        stopPropagation: () => { stopPropagationCalls++; }
      };

      handleKeyDown(mockEvent);

      return { triggeredAction, preventDefaultCalls, stopPropagationCalls };
    }

    test('allows Alt/Option + R while focused inside BugDesk TEXTAREA and prevents character insertion', () => {
      const res = simulatePlatformHandler({
        currentTab: 'bug-desk',
        isModalOpen: false,
        eventTarget: { tagName: 'TEXTAREA' },
        event: { altKey: true, ctrlKey: false, metaKey: false, repeat: false, code: 'KeyR', key: 'r' }
      });

      assert.strictEqual(res.triggeredAction, 'launch', 'Should trigger launch action');
      assert.strictEqual(res.preventDefaultCalls, 1, 'Should call preventDefault to stop character insertion');
      assert.strictEqual(res.stopPropagationCalls, 1, 'Should call stopPropagation');
    });

    test('allows Alt/Option + D (clear-data) while focused inside BugDesk INPUT', () => {
      const res = simulatePlatformHandler({
        currentTab: 'bug-desk',
        isModalOpen: false,
        eventTarget: { tagName: 'INPUT' },
        event: { altKey: true, ctrlKey: false, metaKey: false, repeat: false, code: 'KeyD', key: 'd' }
      });

      assert.strictEqual(res.triggeredAction, 'clear-data');
      assert.strictEqual(res.preventDefaultCalls, 1);
    });

    test('allows Alt/Option + C (clear-cache) while focused inside BugDesk dropdown element', () => {
      const res = simulatePlatformHandler({
        currentTab: 'bug-desk',
        isModalOpen: false,
        eventTarget: { tagName: 'DIV', closest: () => ({ tagName: 'SELECT' }) },
        event: { altKey: true, ctrlKey: false, metaKey: false, repeat: false, code: 'KeyC', key: 'c' }
      });

      assert.strictEqual(res.triggeredAction, 'clear-cache');
      assert.strictEqual(res.preventDefaultCalls, 1);
    });

    test('allows Alt/Option + U (uninstall) on BugDesk non-editable area', () => {
      const res = simulatePlatformHandler({
        currentTab: 'bug-desk',
        isModalOpen: false,
        eventTarget: { tagName: 'BODY', closest: () => null },
        event: { altKey: true, ctrlKey: false, metaKey: false, repeat: false, code: 'KeyU', key: 'u' }
      });

      assert.strictEqual(res.triggeredAction, 'uninstall');
      assert.strictEqual(res.preventDefaultCalls, 1);
    });

    test('allows Alt/Option + Q (start test) on BugDesk', () => {
      const res = simulatePlatformHandler({
        currentTab: 'bug-desk',
        isModalOpen: false,
        eventTarget: { tagName: 'TEXTAREA' },
        event: { altKey: true, ctrlKey: false, metaKey: false, repeat: false, code: 'KeyQ', key: 'q' }
      });

      assert.strictEqual(res.triggeredAction, 'start-test');
      assert.strictEqual(res.preventDefaultCalls, 1);
    });

    test('suppresses platform shortcuts when user is on an unrelated route (e.g. devices, builds)', () => {
      const resDevices = simulatePlatformHandler({
        currentTab: 'devices',
        isModalOpen: false,
        eventTarget: { tagName: 'BODY', closest: () => null },
        event: { altKey: true, ctrlKey: false, metaKey: false, repeat: false, code: 'KeyR', key: 'r' }
      });
      assert.strictEqual(resDevices.triggeredAction, null, 'Should not trigger on devices route');

      const resBuilds = simulatePlatformHandler({
        currentTab: 'builds',
        isModalOpen: false,
        eventTarget: { tagName: 'BODY', closest: () => null },
        event: { altKey: true, ctrlKey: false, metaKey: false, repeat: false, code: 'KeyQ', key: 'q' }
      });
      assert.strictEqual(resBuilds.triggeredAction, null, 'Should not trigger on builds route');
    });

    test('suppresses platform shortcuts when a modal dialog is open on BugDesk', () => {
      const res = simulatePlatformHandler({
        currentTab: 'bug-desk',
        isModalOpen: true,
        eventTarget: { tagName: 'TEXTAREA' },
        event: { altKey: true, ctrlKey: false, metaKey: false, repeat: false, code: 'KeyR', key: 'r' }
      });

      assert.strictEqual(res.triggeredAction, null, 'Should not trigger when modal dialog is open');
      assert.strictEqual(res.preventDefaultCalls, 0);
    });

    test('preserves editable suppression on RunTestPage route', () => {
      const res = simulatePlatformHandler({
        currentTab: 'run-test',
        isModalOpen: false,
        eventTarget: { tagName: 'INPUT' },
        event: { altKey: true, ctrlKey: false, metaKey: false, repeat: false, code: 'KeyR', key: 'r' }
      });

      assert.strictEqual(res.triggeredAction, null, 'Should suppress on RunTestPage when typing in an input');
      assert.strictEqual(res.preventDefaultCalls, 0);
    });
  });
});
