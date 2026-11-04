/**
 * Feature Flags Management for QA Platform
 * 
 * Controls feature rollouts between development and production environments.
 * By default, AI Test Writer is HIDDEN on production.
 * 
 * Priority order for resolution:
 * 1. URL Query Parameter: `?ai=true` or `?ai=1` (persists to localStorage)
 *                         `?ai=false` or `?ai=0` (persists to localStorage)
 * 2. Browser LocalStorage: `qa_feature_ai_writer` ('true' | 'false')
 * 3. Vite Build/Environment Variable: `VITE_ENABLE_AI_TEST_WRITER` ('true' | 'false')
 * 4. Default: `false` (SAFE: Completely hidden on production pulls)
 */

const STORAGE_KEY = 'qa_feature_ai_writer';

export const isAiTestWriterEnabled = () => {
  if (typeof window !== 'undefined') {
    // 1. Check URL parameters
    try {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.has('ai')) {
        const val = urlParams.get('ai')?.trim().toLowerCase();
        const enabled = val === 'true' || val === '1' || val === 'yes' || val === 'on';
        localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
        return enabled;
      }
    } catch (e) {
      // URL parsing failed, fall through to localStorage
    }

    // 2. Check localStorage
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored !== null) {
        return stored === 'true';
      }
    } catch (e) {
      // localStorage unavailable, fall through to environment
    }
  }

  // 3. Check Vite build-time environment variable
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_ENABLE_AI_TEST_WRITER !== undefined) {
      return String(import.meta.env.VITE_ENABLE_AI_TEST_WRITER).trim().toLowerCase() === 'true';
    }
  } catch (e) {
    // Environment check fallback
  }

  // 4. Default: Safe fallback (hidden)
  return false;
};

export const setAiTestWriterEnabled = (enabled) => {
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
      window.location.reload();
    }
  } catch (e) {
    console.error('Failed to persist AI Test Writer feature flag:', e);
  }
};

// Expose devtools helpers on window object for convenience
if (typeof window !== 'undefined') {
  window.__QA_FLAGS__ = {
    isAiEnabled: () => isAiTestWriterEnabled(),
    enableAi: () => setAiTestWriterEnabled(true),
    disableAi: () => setAiTestWriterEnabled(false)
  };
}
