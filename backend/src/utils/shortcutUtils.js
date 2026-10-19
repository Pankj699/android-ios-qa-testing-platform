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

module.exports = {
  isMacPlatform,
  getShortcutModifierLabel,
  formatShortcutLabel,
  isEditableElement,
  MAC_OPTION_LIGATURES,
  isActionShortcut
};
