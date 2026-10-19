/**
 * Cross-Platform Keyboard Shortcut Utilities (Frontend)
 *
 * Provides robust platform detection and keyboard event normalization
 * for Windows, Linux, and macOS.
 *
 * On macOS, Option (⌥ / Alt) generates diacritics / ligatures (e.g. Option+Q => 'œ',
 * Option+R => '®', Option+D => '∂', Option+C => 'ç', Option+U => '¨').
 * This module checks standard physical codes (e.g. 'KeyQ') as well as character fallbacks.
 */

/**
 * Detect whether client platform is macOS using modern Client Hints with safe fallbacks.
 */
export function isMacPlatform(customNavigator) {
  const nav = customNavigator || (typeof navigator !== 'undefined' ? navigator : null);
  if (!nav) return false;

  // 1. Modern User-Agent Client Hints API
  if (nav.userAgentData?.platform) {
    return /^mac/i.test(nav.userAgentData.platform);
  }

  // 2. Standard navigator.platform
  const platform = nav.platform || '';
  if (/Mac|iPhone|iPod|iPad/i.test(platform)) {
    return true;
  }

  // 3. Fallback userAgent inspection
  const userAgent = nav.userAgent || '';
  return /Macintosh|Mac OS X/i.test(userAgent);
}

/**
 * Get the platform modifier display name:
 * - macOS: "Option"
 * - Windows / Linux: "Alt"
 */
export function getShortcutModifierLabel(customNavigator) {
  return isMacPlatform(customNavigator) ? 'Option' : 'Alt';
}

/**
 * Format standard shortcut display string:
 * e.g. "Option + Q" on macOS, "Alt + Q" on Windows/Linux
 */
export function formatShortcutLabel(keyLetter, customNavigator, separator = ' + ') {
  const modifier = getShortcutModifierLabel(customNavigator);
  return `${modifier}${separator}${String(keyLetter).toUpperCase()}`;
}

/**
 * Determine if an event target is an interactive or text-editable element
 * where global shortcuts must be suppressed.
 */
export function isEditableElement(target) {
  if (!target) return false;

  // Direct element type check
  const tagName = target.tagName ? target.tagName.toUpperCase() : '';
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
    return true;
  }

  if (target.isContentEditable || target.contentEditable === 'true') {
    return true;
  }

  // Check parent tree for contenteditable or form inputs
  if (typeof target.closest === 'function') {
    return !!target.closest('input, textarea, select, [contenteditable="true"]');
  }

  return false;
}

/**
 * Mac Option Key Ligature mapping for standard US/macOS layouts
 */
export const MAC_OPTION_LIGATURES = {
  KeyQ: 'œ',
  KeyR: '®',
  KeyD: '∂',
  KeyC: 'ç',
  KeyU: '¨'
};

/**
 * Robust cross-platform shortcut matcher for Alt/Option + key combinations.
 *
 * Requirements:
 * - altKey must be true
 * - ctrlKey and metaKey must be false (avoid conflict with system shortcuts like Cmd+Opt+...)
 * - repeat must be false (prevent duplicate trigger on key hold)
 * - matches event.code (physical key) OR event.key (character / Mac ligature)
 */
export function isActionShortcut(event, expectedCode, expectedKey, macLigature = null) {
  if (!event) return false;

  // Must have Alt/Option pressed and no Ctrl or Command/Meta
  if (!event.altKey || event.ctrlKey || event.metaKey) {
    return false;
  }

  // Prevent duplicate execution while key is held down
  if (event.repeat) {
    return false;
  }

  // Primary: Match by physical key code (consistent across all OSes and keyboard layouts)
  if (expectedCode && event.code === expectedCode) {
    return true;
  }

  const rawKey = event.key || '';
  const normKey = rawKey.toLowerCase();

  // Secondary: Match by standard key character
  if (expectedKey && normKey === expectedKey.toLowerCase()) {
    return true;
  }

  // Tertiary: Match by macOS ligature if produced by Option key
  const ligature = macLigature || MAC_OPTION_LIGATURES[expectedCode];
  if (ligature && (rawKey === ligature || normKey === ligature.toLowerCase())) {
    return true;
  }

  return false;
}
