/**
 * Navigation titles and route-to-tab mappings for QA Platform.
 * Formats dynamic browser tab title as: "QA Platform | {Active Tab Title}"
 */

export const QA_PLATFORM_BASE_TITLE = 'QA Platform';

export const TAB_TITLES = {
  'dashboard': 'Dashboard',
  'devices': 'Devices',
  'screen-mirror': 'Screen Mirror',
  'ui-inspector': 'UI Inspector',
  'builds': 'Builds & AAB',
  'google-drive': 'Google Drive',
  'bug-desk': 'Bug Desk',
  'run-test': 'Run PAD Test',
  'robo-test': 'Robo Test',
  'mixpanel-validator': 'Mixpanel Validator',
  'history': 'Test History',
  'adb-ops': 'ADB Operations',
  'remote-config': 'Remote Config',
  'sop': 'SOP Guide',
  'diagnostics': 'System Diagnostics',
  'admin-users': 'User Management',
  'admin-devices': 'Device Management',
  'ai-documents': 'AI Documents',
  'ai-requirements': 'Requirements Analysis',
  'ai-test-writer': 'Test Case Generation'
};

export const ROUTE_PATH_TO_TAB = {
  '/': 'dashboard',
  '/dashboard': 'dashboard',
  '/devices': 'devices',
  '/screen-mirror': 'screen-mirror',
  '/screenmirror': 'screen-mirror',
  '/mirror': 'screen-mirror',
  '/ui-inspector': 'ui-inspector',
  '/uiinspector': 'ui-inspector',
  '/inspector': 'ui-inspector',
  '/builds': 'builds',
  '/builds-aab': 'builds',
  '/aab': 'builds',
  '/google-drive': 'google-drive',
  '/drive': 'google-drive',
  '/bug-desk': 'bug-desk',
  '/bugdesk': 'bug-desk',
  '/ai-documents': 'ai-documents',
  '/ai-docs': 'ai-documents',
  '/documents': 'ai-documents',
  '/ai-requirements': 'ai-requirements',
  '/requirements': 'ai-requirements',
  '/ai-test-writer': 'ai-test-writer',
  '/test-cases': 'ai-test-writer',
  '/test-suites': 'ai-test-writer',
  '/run-test': 'run-test',
  '/run-pad-test': 'run-test',
  '/robo-test': 'robo-test',
  '/robotest': 'robo-test',
  '/robo': 'robo-test',
  '/mixpanel-validator': 'mixpanel-validator',
  '/mixpanel': 'mixpanel-validator',
  '/history': 'history',
  '/test-history': 'history',
  '/adb-ops': 'adb-ops',
  '/adb-operations': 'adb-ops',
  '/adb': 'adb-ops',
  '/remote-config': 'remote-config',
  '/remoteconfig': 'remote-config',
  '/sop': 'sop',
  '/sop-guide': 'sop',
  '/diagnostics': 'diagnostics',
  '/system-diagnostics': 'diagnostics',
  '/admin-users': 'admin-users',
  '/user-management': 'admin-users',
  '/admin-devices': 'admin-devices',
  '/device-management': 'admin-devices'
};

/**
 * Extracts and normalizes the clean path from a pathname or URL,
 * stripping query strings, hashes, and trailing slashes.
 */
export function extractCleanPath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return '/';
  try {
    const pathOnly = rawPath.split(/[?#]/)[0];
    const trimmed = pathOnly.trim().toLowerCase();
    if (!trimmed || trimmed === '/') return '/';
    return trimmed.replace(/\/+$/, '');
  } catch (e) {
    return '/';
  }
}

/**
 * Resolves a tab identifier from a URL pathname.
 * Returns null if the pathname is an unrecognized/unknown route.
 */
export function getTabFromPathname(pathname) {
  if (!pathname || typeof pathname !== 'string') return null;
  const clean = extractCleanPath(pathname);

  // Exact route match
  if (ROUTE_PATH_TO_TAB[clean]) {
    return ROUTE_PATH_TO_TAB[clean];
  }

  // Nested routes with subpaths
  if (clean.startsWith('/bug-desk/') || clean.startsWith('/bugdesk/')) {
    return 'bug-desk';
  }
  if (clean.startsWith('/remote-config/') || clean.startsWith('/remoteconfig/')) {
    return 'remote-config';
  }
  if (clean.startsWith('/devices/')) {
    return 'devices';
  }
  if (clean.startsWith('/builds/')) {
    return 'builds';
  }
  if (clean.startsWith('/history/')) {
    return 'history';
  }
  if (clean.startsWith('/admin-users/')) {
    return 'admin-users';
  }
  if (clean.startsWith('/admin-devices/')) {
    return 'admin-devices';
  }

  return null;
}

/**
 * Checks if a given pathname maps to a recognized application route.
 */
export function isKnownRoutePath(pathname) {
  return getTabFromPathname(pathname) !== null;
}

/**
 * Formats the browser document title according to the QA Platform convention:
 * "QA Platform | {Active Tab Title}"
 * Returns fallback "QA Platform" if no title is provided.
 */
export function formatDocumentTitle(tabTitle) {
  if (tabTitle && typeof tabTitle === 'string' && tabTitle.trim()) {
    return `${QA_PLATFORM_BASE_TITLE} | ${tabTitle.trim()}`;
  }
  return QA_PLATFORM_BASE_TITLE;
}

/**
 * Resolves the appropriate document title based on the active tab and/or route pathname.
 * - If on an unknown route path, returns the fallback "QA Platform".
 * - If on a recognized tab/route, returns "QA Platform | {Active Tab Title}".
 */
export function getDocumentTitle(currentTab, pathname = '') {
  // If a non-root pathname is provided and is an unknown route, use fallback "QA Platform"
  if (pathname) {
    const clean = extractCleanPath(pathname);
    if (clean !== '/' && !isKnownRoutePath(clean)) {
      return QA_PLATFORM_BASE_TITLE;
    }
  }

  if (currentTab && TAB_TITLES[currentTab]) {
    return formatDocumentTitle(TAB_TITLES[currentTab]);
  }

  if (pathname) {
    const tabFromPath = getTabFromPathname(pathname);
    if (tabFromPath && TAB_TITLES[tabFromPath]) {
      return formatDocumentTitle(TAB_TITLES[tabFromPath]);
    }
  }

  return QA_PLATFORM_BASE_TITLE;
}
