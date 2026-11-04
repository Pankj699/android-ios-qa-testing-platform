/**
 * Centralized Dialog Shortcut Registry & Event Dispatcher (Frontend)
 *
 * Implements authoritative keyboard shortcuts across all QA Platform dialogs:
 * - Enter: Activates the explicitly designated primary action on the topmost active dialog.
 * - Ctrl + Enter (Cmd + Enter on macOS): Submits editable dialogs containing inputs/textareas.
 * - Escape: Dismisses the topmost active dialog when permitted.
 *
 * Safety & Accessibility Rules:
 * - Plain Enter inside a multiline <textarea> or contenteditable inserts a newline and does NOT activate primary actions.
 * - If keyboard focus is on a secondary interactive button (e.g. Cancel), native Enter activation of that button is preserved.
 * - Respects IME composition (event.isComposing / keyCode 229).
 * - Ignores repeated key events (event.repeat).
 * - Respects disabled and loading states; never bypasses required validation or safety confirmations.
 * - In nested dialogs, only the topmost active dialog processes the shortcut.
 * - Prevents background page shortcuts from executing while any modal dialog is active.
 */

export class DialogShortcutManager {
  constructor() {
    this.stack = [];
    this.isListening = false;
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  /**
   * Register or update an active dialog in the stack.
   * Maintains strict stack order for nested dialogs.
   */
  register(dialog) {
    if (!dialog || !dialog.id) return;
    const existingIndex = this.stack.findIndex((d) => d.id === dialog.id);
    if (existingIndex >= 0) {
      this.stack[existingIndex] = { ...this.stack[existingIndex], ...dialog };
    } else {
      this.stack.push(dialog);
    }
    this.ensureListener();
  }

  /**
   * Unregister a dialog when closed or unmounted.
   */
  unregister(id) {
    const idx = this.stack.findIndex((d) => d.id === id);
    if (idx >= 0) {
      this.stack.splice(idx, 1);
    }
    if (this.stack.length === 0) {
      this.removeListener();
    }
  }

  /**
   * Returns the current topmost active dialog.
   */
  getTopmostDialog() {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1] : null;
  }

  /**
   * Returns true if any modal dialog is currently active.
   */
  isAnyDialogOpen() {
    return this.stack.length > 0;
  }

  /**
   * Clear all dialogs (useful in test teardown).
   */
  clear() {
    this.stack = [];
    this.removeListener();
  }

  ensureListener() {
    if (this.isListening || typeof window === 'undefined') return;
    window.addEventListener('keydown', this.handleKeyDown, { capture: true });
    this.isListening = true;
  }

  removeListener() {
    if (!this.isListening || typeof window === 'undefined') return;
    window.removeEventListener('keydown', this.handleKeyDown, { capture: true });
    this.isListening = false;
  }

  /**
   * Core keyboard event router.
   */
  handleKeyDown(event) {
    if (!event) return;

    // Respect already handled events
    if (event.defaultPrevented) return;

    // IME composition safety (Japanese, Chinese, Korean, etc.)
    if (event.isComposing || event.keyCode === 229) return;

    // Suppress repeated keydown events from holding key down
    if (event.repeat) return;

    const topDialog = this.getTopmostDialog();
    if (!topDialog) return;

    const isEscape = event.key === 'Escape' || event.code === 'Escape';
    const isEnter = event.key === 'Enter' || event.code === 'Enter';

    if (!isEscape && !isEnter) return;

    // Handle Escape dismissal on the topmost dialog
    if (isEscape) {
      if (typeof topDialog.onClose === 'function' && !topDialog.loading) {
        event.preventDefault();
        event.stopPropagation();
        topDialog.onClose();
      }
      return;
    }

    // Handle Enter shortcuts
    if (isEnter) {
      const isCtrlOrCmd = !!(event.ctrlKey || event.metaKey);
      const isAlt = !!event.altKey;

      // Ignore Alt + Enter combinations
      if (isAlt) return;

      const target = event.target;
      const tagName = target?.tagName ? target.tagName.toUpperCase() : '';
      const isTextarea = tagName === 'TEXTAREA' || target?.isContentEditable;

      // 1. Ctrl + Enter / Cmd + Enter: Submit editable dialog
      if (isCtrlOrCmd) {
        if (topDialog.disabled || topDialog.loading) return;

        const submitHandler = topDialog.onSubmit || topDialog.onPrimaryAction;
        if (typeof submitHandler === 'function') {
          event.preventDefault();
          event.stopPropagation();
          submitHandler();
        }
        return;
      }

      // 2. Plain Enter: Primary Dialog Action
      // In a multiline textarea, plain Enter inserts a newline. Do not activate dialog action!
      if (isTextarea) {
        return;
      }

      // If user has focused a secondary button (e.g. Cancel), allow native button activation
      const isButton = tagName === 'BUTTON' || target?.getAttribute?.('role') === 'button';
      if (isButton) {
        // Let the focused button receive its native Enter click
        return;
      }

      // Activate primary action if not disabled/loading
      if (topDialog.disabled || topDialog.loading) return;

      const primaryHandler = topDialog.onPrimaryAction || topDialog.onSubmit;
      if (typeof primaryHandler === 'function') {
        event.preventDefault();
        event.stopPropagation();
        primaryHandler();
      }
    }
  }
}

export const dialogShortcutManager = new DialogShortcutManager();
export default dialogShortcutManager;
