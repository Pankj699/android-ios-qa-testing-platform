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
  isSubmitShortcut,
  MAC_OPTION_LIGATURES
} = require('../src/utils/shortcutUtils');

describe('Remote Config Manager Keyboard Shortcuts & Ctrl+Enter Suite', () => {

  describe('1. isModalDialogOpen Scoping & Remote Config Dialog Filtering', () => {
    test('returns false when only Remote Config dialog is open and ignoreRemoteConfig is true', () => {
      const mockDoc = {
        querySelectorAll: (sel) => {
          if (sel.includes('.fixed.inset-0.z-50')) {
            return [{
              tagName: 'DIV',
              hasAttribute: (attr) => attr === 'data-remote-config-dialog'
            }];
          }
          return [];
        },
        activeElement: {
          tagName: 'BUTTON',
          closest: (sel) => sel.includes('[data-remote-config-dialog]') ? { tagName: 'DIV' } : null
        }
      };
      assert.strictEqual(isModalDialogOpen(mockDoc, { ignoreRemoteConfig: true }), false);
    });

    test('returns true when Remote Config dialog is open if ignoreRemoteConfig is omitted or false', () => {
      const mockDoc = {
        querySelectorAll: (sel) => {
          if (sel.includes('.fixed.inset-0.z-50')) {
            return [{
              tagName: 'DIV',
              hasAttribute: (attr) => attr === 'data-remote-config-dialog'
            }];
          }
          return [];
        },
        activeElement: { tagName: 'BUTTON', closest: () => null }
      };
      assert.strictEqual(isModalDialogOpen(mockDoc), true);
      assert.strictEqual(isModalDialogOpen(mockDoc, { ignoreRemoteConfig: false }), true);
    });

    test('returns true when a non-Remote Config modal (e.g. AuthModal) is open even if ignoreRemoteConfig is true', () => {
      const mockDoc = {
        querySelectorAll: (sel) => {
          if (sel.includes('.fixed.inset-0.z-50')) {
            return [
              { tagName: 'DIV', hasAttribute: (attr) => attr === 'data-remote-config-dialog' },
              { tagName: 'DIV', hasAttribute: () => false } // AuthModal
            ];
          }
          return [];
        },
        activeElement: { tagName: 'BODY', closest: () => null }
      };
      assert.strictEqual(isModalDialogOpen(mockDoc, { ignoreRemoteConfig: true }), true);
    });

    test('returns false when activeElement is inside Remote Config dialog and ignoreRemoteConfig is true', () => {
      const mockDoc = {
        querySelectorAll: () => [],
        activeElement: {
          tagName: 'TEXTAREA',
          closest: (sel) => sel.includes('[data-remote-config-dialog]') ? { tagName: 'DIV' } : null
        }
      };
      assert.strictEqual(isModalDialogOpen(mockDoc, { ignoreRemoteConfig: true }), false);
    });

    test('returns true when activeElement is inside a global modal and ignoreRemoteConfig is true', () => {
      const mockDoc = {
        querySelectorAll: () => [],
        activeElement: {
          tagName: 'INPUT',
          closest: (sel) => sel.includes('[role="dialog"]') ? { tagName: 'DIV' } : null
        }
      };
      assert.strictEqual(isModalDialogOpen(mockDoc, { ignoreRemoteConfig: true }), true);
    });
  });

  describe('2. Global Platform Shortcuts on Remote Config Manager', () => {
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

        // Scoping: shortcuts apply when active on Run Test, BugDesk, or Remote Config Manager
        const isApplicableRoute = currentTab === 'run-test' || currentTab === 'bug-desk' || currentTab === 'remote-config';
        if (!isApplicableRoute) return;

        // Modal suppression with Remote Config exclusion
        if (isModalOpen) return;

        // On RunTestPage and Remote Config, suppress if typing in an editable field.
        // On BugDesk, allow shortcuts even when focus is in textarea/input/dropdown.
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

    test('allows Alt/Option + R (relaunch) when active on Remote Config Manager', () => {
      const res = simulatePlatformHandler({
        currentTab: 'remote-config',
        isModalOpen: false,
        eventTarget: { tagName: 'BUTTON' },
        event: { altKey: true, ctrlKey: false, metaKey: false, repeat: false, code: 'KeyR', key: 'r' }
      });
      assert.strictEqual(res.triggeredAction, 'launch');
      assert.strictEqual(res.preventDefaultCalls, 1);
      assert.strictEqual(res.stopPropagationCalls, 1);
    });

    test('allows Alt/Option + Q (start test) when active on Remote Config Manager', () => {
      const res = simulatePlatformHandler({
        currentTab: 'remote-config',
        isModalOpen: false,
        eventTarget: { tagName: 'DIV' },
        event: { altKey: true, ctrlKey: false, metaKey: false, repeat: false, code: 'KeyQ', key: 'q' }
      });
      assert.strictEqual(res.triggeredAction, 'start-test');
      assert.strictEqual(res.preventDefaultCalls, 1);
    });

    test('allows Alt/Option + D (clear-data) when active on Remote Config Manager', () => {
      const res = simulatePlatformHandler({
        currentTab: 'remote-config',
        isModalOpen: false,
        eventTarget: { tagName: 'BODY' },
        event: { altKey: true, ctrlKey: false, metaKey: false, repeat: false, code: 'KeyD', key: 'd' }
      });
      assert.strictEqual(res.triggeredAction, 'clear-data');
      assert.strictEqual(res.preventDefaultCalls, 1);
    });

    test('allows Alt/Option + C (clear-cache) when active on Remote Config Manager', () => {
      const res = simulatePlatformHandler({
        currentTab: 'remote-config',
        isModalOpen: false,
        eventTarget: { tagName: 'BODY' },
        event: { altKey: true, ctrlKey: false, metaKey: false, repeat: false, code: 'KeyC', key: 'c' }
      });
      assert.strictEqual(res.triggeredAction, 'clear-cache');
      assert.strictEqual(res.preventDefaultCalls, 1);
    });

    test('allows Alt/Option + U (uninstall) when active on Remote Config Manager', () => {
      const res = simulatePlatformHandler({
        currentTab: 'remote-config',
        isModalOpen: false,
        eventTarget: { tagName: 'BODY' },
        event: { altKey: true, ctrlKey: false, metaKey: false, repeat: false, code: 'KeyU', key: 'u' }
      });
      assert.strictEqual(res.triggeredAction, 'uninstall');
      assert.strictEqual(res.preventDefaultCalls, 1);
    });

    test('suppresses global shortcuts when typing inside an editable field on Remote Config Manager (e.g. JSON editor or key input)', () => {
      const resTextarea = simulatePlatformHandler({
        currentTab: 'remote-config',
        isModalOpen: false,
        eventTarget: { tagName: 'TEXTAREA' },
        event: { altKey: true, ctrlKey: false, metaKey: false, repeat: false, code: 'KeyR', key: 'r' }
      });
      assert.strictEqual(resTextarea.triggeredAction, null, 'Must suppress Alt+R in JSON editor textarea');
      assert.strictEqual(resTextarea.preventDefaultCalls, 0);

      const resInput = simulatePlatformHandler({
        currentTab: 'remote-config',
        isModalOpen: false,
        eventTarget: { tagName: 'INPUT' },
        event: { altKey: true, ctrlKey: false, metaKey: false, repeat: false, code: 'KeyD', key: 'd' }
      });
      assert.strictEqual(resInput.triggeredAction, null, 'Must suppress Alt+D in input field');
      assert.strictEqual(resInput.preventDefaultCalls, 0);
    });

    test('allows global shortcuts when a dialog is open on Remote Config as long as focus is not in an editable field', () => {
      const resModalBackdrop = simulatePlatformHandler({
        currentTab: 'remote-config',
        isModalOpen: false, // In-page remote config dialog excluded by ignoreRemoteConfig
        eventTarget: { tagName: 'DIV', closest: () => null },
        event: { altKey: true, ctrlKey: false, metaKey: false, repeat: false, code: 'KeyR', key: 'r' }
      });
      assert.strictEqual(resModalBackdrop.triggeredAction, 'launch');
      assert.strictEqual(resModalBackdrop.preventDefaultCalls, 1);
    });

    test('suppresses global shortcuts when a blocking global modal (e.g. AuthModal) is open', () => {
      const resGlobalModal = simulatePlatformHandler({
        currentTab: 'remote-config',
        isModalOpen: true, // Non-remote-config modal is open
        eventTarget: { tagName: 'BODY' },
        event: { altKey: true, ctrlKey: false, metaKey: false, repeat: false, code: 'KeyR', key: 'r' }
      });
      assert.strictEqual(resGlobalModal.triggeredAction, null);
      assert.strictEqual(resGlobalModal.preventDefaultCalls, 0);
    });

    test('continues to suppress global shortcuts on unrelated tabs (e.g. devices, builds, dashboard)', () => {
      const resDevices = simulatePlatformHandler({
        currentTab: 'devices',
        isModalOpen: false,
        eventTarget: { tagName: 'BODY' },
        event: { altKey: true, ctrlKey: false, metaKey: false, repeat: false, code: 'KeyR', key: 'r' }
      });
      assert.strictEqual(resDevices.triggeredAction, null);

      const resBuilds = simulatePlatformHandler({
        currentTab: 'builds',
        isModalOpen: false,
        eventTarget: { tagName: 'BODY' },
        event: { altKey: true, ctrlKey: false, metaKey: false, repeat: false, code: 'KeyQ', key: 'q' }
      });
      assert.strictEqual(resBuilds.triggeredAction, null);
    });
  });

  describe('3. Edit Remote Config Ctrl+Enter Submission Handler', () => {
    function simulateEditFormHandler({
      isEditOpen,
      formKey,
      formType,
      formValue,
      formActive,
      submitting,
      event
    }) {
      let preventDefaultCalls = 0;
      let stopPropagationCalls = 0;
      let submittedPayload = null;
      let validationError = '';
      let isSubmitting = submitting;

      const handleSaveForm = (e) => {
        if (e && e.preventDefault) e.preventDefault();
        if (isSubmitting) return;

        if (!formKey.trim()) {
          validationError = 'Key name is required.';
          return;
        }

        if (formType === 'json') {
          try {
            JSON.parse(formValue);
          } catch (err) {
            validationError = `Invalid JSON syntax: ${err.message}`;
            return;
          }
        } else if (formType === 'number') {
          if (formValue.trim() === '' || isNaN(Number(formValue))) {
            validationError = 'Value must be a valid number.';
            return;
          }
        }

        isSubmitting = true;
        submittedPayload = {
          key: formKey.trim(),
          type: formType,
          value: formValue,
          active: formActive
        };
      };

      const handleKeyDown = (e) => {
        if (!isEditOpen) return;

        if (isSubmitShortcut(e)) {
          e.preventDefault();
          e.stopPropagation();
          if (isSubmitting) return;
          handleSaveForm();
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
        submittedPayload,
        validationError,
        isSubmitting
      };
    }

    test('submits valid JSON configuration via Ctrl + Enter on Windows/Linux', () => {
      const res = simulateEditFormHandler({
        isEditOpen: true,
        formKey: 'feature_checkout_v2',
        formType: 'json',
        formValue: '{"enabled": true, "max_retries": 3}',
        formActive: true,
        submitting: false,
        event: { ctrlKey: true, metaKey: false, altKey: false, repeat: false, key: 'Enter', code: 'Enter' }
      });

      assert.strictEqual(res.preventDefaultCalls, 1, 'Must call preventDefault to prevent textarea newline');
      assert.strictEqual(res.stopPropagationCalls, 1, 'Must stop event propagation');
      assert.strictEqual(res.validationError, '');
      assert.deepStrictEqual(res.submittedPayload, {
        key: 'feature_checkout_v2',
        type: 'json',
        value: '{"enabled": true, "max_retries": 3}',
        active: true
      });
      assert.strictEqual(res.isSubmitting, true);
    });

    test('submits valid configuration via Cmd + Enter on macOS', () => {
      const res = simulateEditFormHandler({
        isEditOpen: true,
        formKey: 'theme_accent_color',
        formType: 'string',
        formValue: '#8B5CF6',
        formActive: false,
        submitting: false,
        event: { ctrlKey: false, metaKey: true, altKey: false, repeat: false, key: 'Enter', code: 'Enter' }
      });

      assert.strictEqual(res.preventDefaultCalls, 1);
      assert.strictEqual(res.stopPropagationCalls, 1);
      assert.strictEqual(res.validationError, '');
      assert.deepStrictEqual(res.submittedPayload, {
        key: 'theme_accent_color',
        type: 'string',
        value: '#8B5CF6',
        active: false
      });
    });

    test('validates JSON syntax: rejects malformed JSON, halts submission, sets error message', () => {
      const res = simulateEditFormHandler({
        isEditOpen: true,
        formKey: 'broken_config',
        formType: 'json',
        formValue: '{"unclosed": "string',
        formActive: true,
        submitting: false,
        event: { ctrlKey: true, metaKey: false, altKey: false, repeat: false, key: 'Enter', code: 'Enter' }
      });

      assert.strictEqual(res.preventDefaultCalls, 1, 'Must prevent newline even when JSON is invalid');
      assert.strictEqual(res.submittedPayload, null, 'Must NOT submit invalid JSON');
      assert.match(res.validationError, /Invalid JSON syntax/);
      assert.strictEqual(res.isSubmitting, false);
    });

    test('validates number: rejects non-numeric string for number type', () => {
      const res = simulateEditFormHandler({
        isEditOpen: true,
        formKey: 'retry_count',
        formType: 'number',
        formValue: 'not-a-number',
        formActive: true,
        submitting: false,
        event: { ctrlKey: true, metaKey: false, altKey: false, repeat: false, key: 'Enter', code: 'Enter' }
      });

      assert.strictEqual(res.submittedPayload, null);
      assert.strictEqual(res.validationError, 'Value must be a valid number.');
    });

    test('prevents duplicate submissions when a save is already in progress', () => {
      const res = simulateEditFormHandler({
        isEditOpen: true,
        formKey: 'feature_flag',
        formType: 'boolean',
        formValue: '1',
        formActive: true,
        submitting: true, // Already saving
        event: { ctrlKey: true, metaKey: false, altKey: false, repeat: false, key: 'Enter', code: 'Enter' }
      });

      assert.strictEqual(res.preventDefaultCalls, 1, 'Must prevent newline even during in-flight save');
      assert.strictEqual(res.submittedPayload, null, 'Must NOT submit a second request');
    });

    test('does NOT trigger when Edit Remote Config is NOT open (editModalConfig is null)', () => {
      const res = simulateEditFormHandler({
        isEditOpen: false, // Dialog closed
        formKey: 'feature_flag',
        formType: 'string',
        formValue: 'abc',
        formActive: true,
        submitting: false,
        event: { ctrlKey: true, metaKey: false, altKey: false, repeat: false, key: 'Enter', code: 'Enter' }
      });

      assert.strictEqual(res.preventDefaultCalls, 0);
      assert.strictEqual(res.submittedPayload, null);
    });

    test('rejects plain Enter without Ctrl or Cmd', () => {
      const res = simulateEditFormHandler({
        isEditOpen: true,
        formKey: 'feature_flag',
        formType: 'json',
        formValue: '{}',
        formActive: true,
        submitting: false,
        event: { ctrlKey: false, metaKey: false, altKey: false, repeat: false, key: 'Enter', code: 'Enter' }
      });

      assert.strictEqual(res.preventDefaultCalls, 0, 'Plain enter in textarea inserts newline');
      assert.strictEqual(res.submittedPayload, null);
    });

    test('rejects Ctrl + Alt + Enter or repeated held-down keys', () => {
      const resCtrlAlt = simulateEditFormHandler({
        isEditOpen: true,
        formKey: 'test',
        formType: 'string',
        formValue: 'val',
        formActive: true,
        submitting: false,
        event: { ctrlKey: true, metaKey: false, altKey: true, repeat: false, key: 'Enter', code: 'Enter' }
      });
      assert.strictEqual(resCtrlAlt.submittedPayload, null);

      const resRepeat = simulateEditFormHandler({
        isEditOpen: true,
        formKey: 'test',
        formType: 'string',
        formValue: 'val',
        formActive: true,
        submitting: false,
        event: { ctrlKey: true, metaKey: false, altKey: false, repeat: true, key: 'Enter', code: 'Enter' }
      });
      assert.strictEqual(resRepeat.submittedPayload, null);
    });
  });
});
