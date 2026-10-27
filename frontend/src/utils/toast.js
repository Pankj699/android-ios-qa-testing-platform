import { toast as sonnerToast } from 'sonner';

/**
 * Standardized global toast notification utility for the QA Platform.
 * Enforces standard durations, message normalization, and consistent styling.
 */
export const toast = {
  ...sonnerToast,

  /**
   * Success toast with green theme styling.
   * Default duration: 4000ms.
   */
  success: (message, options = {}) => {
    const text = typeof message === 'string' ? message : message?.message || 'Operation completed successfully.';
    return sonnerToast.success(text, {
      duration: 4000,
      ...options,
    });
  },

  /**
   * Error toast with red theme styling.
   * Default duration: 6000ms to allow sufficient reading time.
   */
  error: (error, options = {}) => {
    let text = 'An unexpected error occurred.';
    if (typeof error === 'string') {
      text = error;
    } else if (error instanceof Error) {
      text = error.message;
    } else if (error?.error) {
      text = typeof error.error === 'string' ? error.error : error.error.message || text;
    } else if (error?.message) {
      text = error.message;
    }

    return sonnerToast.error(text, {
      duration: 6000,
      ...options,
    });
  },

  /**
   * Information toast.
   * Default duration: 4000ms.
   */
  info: (message, options = {}) => {
    const text = typeof message === 'string' ? message : message?.message || String(message);
    return sonnerToast.info(text, {
      duration: 4000,
      ...options,
    });
  },

  /**
   * Warning toast.
   * Default duration: 5000ms.
   */
  warning: (message, options = {}) => {
    const text = typeof message === 'string' ? message : message?.message || String(message);
    return sonnerToast.warning(text, {
      duration: 5000,
      ...options,
    });
  },

  /**
   * Dismiss a specific toast or all active toasts.
   */
  dismiss: (id) => sonnerToast.dismiss(id),
};

export default toast;
