// Centralized Version Configuration for Android PAD / ORD QA Platform
// Generated automatically by scripts/version-manager.js — DO NOT EDIT MANUALLY
export const APP_VERSION = '1.1.2';
export const APP_NAME = 'Android PAD / ORD Testing Platform';
export const VERSION_STAGE = 'QA';
export const GIT_COMMIT_HASH = typeof __GIT_COMMIT_HASH__ !== 'undefined' ? __GIT_COMMIT_HASH__ : '';

/**
 * Format a semver string (e.g. "1.0.0" or "1.1.0") into UI display format (e.g. "v1.0 QA" or "v1.1 QA")
 * @param {string} semver 
 * @param {string} stage 
 * @returns {string}
 */
export function formatDisplayVersion(semver = APP_VERSION, stage = VERSION_STAGE) {
  if (!semver || typeof semver !== 'string') return 'v1.0 ' + stage;
  const parts = semver.split('.');
  const major = parts[0] || '1';
  const minor = parts[1] || '0';
  return `v${major}.${minor} ${stage}`;
}

export const DISPLAY_VERSION = formatDisplayVersion(APP_VERSION, VERSION_STAGE);

/**
 * Format system version label for sidebar branding (e.g. "SYS.VER.1.1 (65b2efe)" or "SYS.VER.1.1")
 * @param {string} semver 
 * @param {string} commit 
 * @returns {string}
 */
export function formatSysVersion(semver = APP_VERSION, commit = GIT_COMMIT_HASH) {
  const parts = (semver || '1.1').split('.');
  const major = parts[0] || '1';
  const minor = parts[1] || '1';
  const base = `SYS.VER.${major}.${minor}`;
  return commit ? `${base} (${commit})` : base;
}

export const SYS_VERSION = formatSysVersion(APP_VERSION, GIT_COMMIT_HASH);

