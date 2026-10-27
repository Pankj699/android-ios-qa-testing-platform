/**
 * Cross-Platform Keyboard Shortcut Utilities (Backend / Shared)
 * CommonJS export for automated Node.js test runners.
 */

function isMacPlatform(customNavigator) {
  const nav = customNavigator || (typeof navigator !== 'undefined' ? navigator : null);
  if (!nav) return false;

  if (nav.userAgentData?.platform) {
    return /^mac/i.test(nav.userAgentData.platform);
  }

  const platform = nav.platform || '';
  if (/Mac|iPhone|iPod|iPad/i.test(platform)) {
    return true;
  }

  const userAgent = nav.userAgent || '';
  return /Macintosh|Mac OS X/i.test(userAgent);
}

function getShortcutModifierLabel(customNavigator) {
  return isMacPlatform(customNavigator) ? 'Option' : 'Alt';
}

function formatShortcutLabel(keyLetter, customNavigator, separator = ' + ') {
  const modifier = getShortcutModifierLabel(customNavigator);
  return `${modifier}${separator}${String(keyLetter).toUpperCase()}`;
}

function isEditableElement(target) {
  if (!target) return false;

  const tagName = target.tagName ? target.tagName.toUpperCase() : '';
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
    return true;
  }

  if (target.isContentEditable || target.contentEditable === 'true') {
    return true;
  }

  if (typeof target.closest === 'function') {
    return !!target.closest('input, textarea, select, [contenteditable="true"]');
  }

  return false;
}

const MAC_OPTION_LIGATURES = {
  KeyQ: 'œ',
  KeyR: '®',
  KeyD: '∂',
  KeyC: 'ç',
  KeyU: '¨'
};

function isActionShortcut(event, expectedCode, expectedKey, macLigature = null) {
  if (!event) return false;

  if (!event.altKey || event.ctrlKey || event.metaKey) {
    return false;
  }

  if (event.repeat) {
    return false;
  }

  if (expectedCode && event.code === expectedCode) {
    return true;
  }

  const rawKey = event.key || '';
  const normKey = rawKey.toLowerCase();

  if (expectedKey && normKey === expectedKey.toLowerCase()) {
    return true;
  }

  const ligature = macLigature || MAC_OPTION_LIGATURES[expectedCode];
  if (ligature && (rawKey === ligature || normKey === ligature.toLowerCase())) {
    return true;
  }

  return false;
}

function isModalDialogOpen(customDocument, options = {}) {
  const doc = customDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc) return false;

  const modalSelectors = [
    '[role="dialog"][data-state="open"]',
    '[role="dialog"]:not([data-state="closed"])',
    '[aria-modal="true"]',
    '.fixed.inset-0.z-50',
    '.fixed.inset-0.z-\\[100\\]',
    '.fixed.inset-0.z-\\[50\\]'
  ];

  const queryAll = doc.querySelectorAll
    ? (sel) => Array.from(doc.querySelectorAll(sel))
    : (sel) => {
        const single = doc.querySelector ? doc.querySelector(sel) : null;
        return single ? [single] : [];
      };

  for (const selector of modalSelectors) {
    const elements = queryAll(selector);
    for (const el of elements) {
      if (options.ignoreRemoteConfig) {
        if (el.hasAttribute && el.hasAttribute('data-remote-config-dialog')) continue;
        if (typeof el.closest === 'function' && el.closest('[data-remote-config-dialog]')) continue;
      }
      if (typeof window !== 'undefined' && window.getComputedStyle) {
        const style = window.getComputedStyle(el);
        if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) {
          continue;
        }
      }
      return true;
    }
  }

  const activeEl = doc.activeElement;
  if (activeEl && typeof activeEl.closest === 'function') {
    if (options.ignoreRemoteConfig && activeEl.closest('[data-remote-config-dialog]')) {
      return false;
    }
    if (activeEl.closest('[role="dialog"], [aria-modal="true"], .fixed.inset-0.z-50, .fixed.inset-0.z-\\[100\\]')) {
      return true;
    }
  }

  return false;
}

function isGenerateShortcut(event) {
  if (!event) return false;
  if (!event.ctrlKey && !event.metaKey) return false;
  if (event.altKey) return false;
  if (event.repeat) return false;

  return event.key === 'Enter' || event.code === 'Enter';
}

const isSubmitShortcut = isGenerateShortcut;

module.exports = {
  isMacPlatform,
  getShortcutModifierLabel,
  formatShortcutLabel,
  isEditableElement,
  MAC_OPTION_LIGATURES,
  isActionShortcut,
  isModalDialogOpen,
  isGenerateShortcut,
  isSubmitShortcut
};
