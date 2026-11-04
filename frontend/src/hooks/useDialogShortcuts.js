import { useEffect, useRef, useId } from 'react';
import { dialogShortcutManager } from '../utils/dialogShortcuts';

/**
 * Declarative React Hook for Dialog & Modal Keyboard Shortcuts
 *
 * @param {Object} options
 * @param {boolean} options.isOpen - Whether the dialog is currently visible
 * @param {Function} [options.onPrimaryAction] - Primary action to execute on Enter
 * @param {Function} [options.onSubmit] - Submit handler to execute on Ctrl+Enter / Cmd+Enter
 * @param {Function} [options.onClose] - Cancel/close handler to execute on Escape
 * @param {boolean} [options.disabled=false] - Whether primary/submit action is currently disabled
 * @param {boolean} [options.loading=false] - Whether an operation is currently in progress
 * @param {string} [options.id] - Optional custom identifier for dialog stack tracing
 */
export function useDialogShortcuts({
  isOpen = true,
  onPrimaryAction = null,
  onSubmit = null,
  onClose = null,
  disabled = false,
  loading = false,
  id: customId = null
} = {}) {
  const generatedId = useId();
  const dialogId = customId || generatedId;

  // Preserve latest handlers and flags in ref to prevent unnecessary re-subscriptions
  const configRef = useRef({ onPrimaryAction, onSubmit, onClose, disabled, loading });
  configRef.current = { onPrimaryAction, onSubmit, onClose, disabled, loading };

  useEffect(() => {
    if (!isOpen) {
      dialogShortcutManager.unregister(dialogId);
      return;
    }

    dialogShortcutManager.register({
      id: dialogId,
      onPrimaryAction: () => configRef.current.onPrimaryAction?.(),
      onSubmit: () => configRef.current.onSubmit?.(),
      onClose: () => configRef.current.onClose?.(),
      get disabled() { return !!configRef.current.disabled; },
      get loading() { return !!configRef.current.loading; }
    });

    return () => {
      dialogShortcutManager.unregister(dialogId);
    };
  }, [isOpen, dialogId]);
}

export default useDialogShortcuts;
