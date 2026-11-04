const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');

describe('Dynamic Browser Tab Document Title Suite', async () => {
  // Dynamically import the ES module from frontend/src/utils/navigationTitles.js
  const navModulePath = path.resolve(__dirname, '../../frontend/src/utils/navigationTitles.js');
  const navTitles = await import(`file://${navModulePath.replace(/\\/g, '/')}`);

  const {
    QA_PLATFORM_BASE_TITLE,
    TAB_TITLES,
    ROUTE_PATH_TO_TAB,
    extractCleanPath,
    getTabFromPathname,
    isKnownRoutePath,
    formatDocumentTitle,
    getDocumentTitle
  } = navTitles;

  describe('1. Active Tab Title Formatting (QA Platform | {Active Tab Title})', () => {
    const EXPECTED_MAPPINGS = [
      { tab: 'dashboard', expected: 'QA Platform | Dashboard' },
      { tab: 'devices', expected: 'QA Platform | Devices' },
      { tab: 'screen-mirror', expected: 'QA Platform | Screen Mirror' },
      { tab: 'ui-inspector', expected: 'QA Platform | UI Inspector' },
      { tab: 'builds', expected: 'QA Platform | Builds & AAB' },
      { tab: 'google-drive', expected: 'QA Platform | Google Drive' },
      { tab: 'bug-desk', expected: 'QA Platform | Bug Desk' },
      { tab: 'run-test', expected: 'QA Platform | Run PAD Test' },
      { tab: 'mixpanel-validator', expected: 'QA Platform | Mixpanel Validator' },
      { tab: 'history', expected: 'QA Platform | Test History' },
      { tab: 'adb-ops', expected: 'QA Platform | ADB Operations' },
      { tab: 'remote-config', expected: 'QA Platform | Remote Config' },
      { tab: 'sop', expected: 'QA Platform | SOP Guide' },
      { tab: 'diagnostics', expected: 'QA Platform | System Diagnostics' },
      { tab: 'admin-users', expected: 'QA Platform | User Management' },
      { tab: 'admin-devices', expected: 'QA Platform | Device Management' }
    ];

    EXPECTED_MAPPINGS.forEach(({ tab, expected }) => {
      it(`formats title correctly for tab "${tab}" -> "${expected}"`, () => {
        const title = getDocumentTitle(tab, '');
        assert.strictEqual(title, expected);
      });
    });

    it('formats raw string tab titles via formatDocumentTitle', () => {
      assert.strictEqual(formatDocumentTitle('Custom Page'), 'QA Platform | Custom Page');
      assert.strictEqual(formatDocumentTitle('  Spaced Title  '), 'QA Platform | Spaced Title');
    });
  });

  describe('2. Direct Route Loading & Path Normalization', () => {
    it('correctly maps standard paths to tab IDs', () => {
      assert.strictEqual(getTabFromPathname('/'), 'dashboard');
      assert.strictEqual(getTabFromPathname('/dashboard'), 'dashboard');
      assert.strictEqual(getTabFromPathname('/devices'), 'devices');
      assert.strictEqual(getTabFromPathname('/screen-mirror'), 'screen-mirror');
      assert.strictEqual(getTabFromPathname('/ui-inspector'), 'ui-inspector');
      assert.strictEqual(getTabFromPathname('/builds'), 'builds');
      assert.strictEqual(getTabFromPathname('/google-drive'), 'google-drive');
      assert.strictEqual(getTabFromPathname('/bug-desk'), 'bug-desk');
      assert.strictEqual(getTabFromPathname('/run-test'), 'run-test');
      assert.strictEqual(getTabFromPathname('/mixpanel-validator'), 'mixpanel-validator');
      assert.strictEqual(getTabFromPathname('/history'), 'history');
      assert.strictEqual(getTabFromPathname('/adb-ops'), 'adb-ops');
      assert.strictEqual(getTabFromPathname('/remote-config'), 'remote-config');
      assert.strictEqual(getTabFromPathname('/sop'), 'sop');
      assert.strictEqual(getTabFromPathname('/diagnostics'), 'diagnostics');
      assert.strictEqual(getTabFromPathname('/admin-users'), 'admin-users');
      assert.strictEqual(getTabFromPathname('/admin-devices'), 'admin-devices');
    });

    it('handles nested paths without displaying raw URLs in titles', () => {
      assert.strictEqual(getTabFromPathname('/bug-desk/new-bug'), 'bug-desk');
      assert.strictEqual(getTabFromPathname('/bug-desk/history'), 'bug-desk');
      assert.strictEqual(getTabFromPathname('/bug-desk/settings'), 'bug-desk');
      assert.strictEqual(getTabFromPathname('/remote-config/configs/123'), 'remote-config');
      assert.strictEqual(getTabFromPathname('/devices/R52X808W8QK'), 'devices');

      assert.strictEqual(getDocumentTitle(null, '/bug-desk/new-bug'), 'QA Platform | Bug Desk');
      assert.strictEqual(getDocumentTitle(null, '/remote-config/configs/123'), 'QA Platform | Remote Config');
    });

    it('strips query parameters and hashes when resolving titles', () => {
      assert.strictEqual(extractCleanPath('/remote-config?platform=android&app=flyer'), '/remote-config');
      assert.strictEqual(extractCleanPath('/devices?serial=R52X808W8QK#view'), '/devices');

      assert.strictEqual(
        getDocumentTitle(null, '/remote-config?platform=android&app=flyermaker'),
        'QA Platform | Remote Config'
      );
      assert.strictEqual(
        getDocumentTitle(null, '/devices?serial=R52X808W8QK'),
        'QA Platform | Devices'
      );
    });

    it('is case-insensitive and handles trailing slashes', () => {
      assert.strictEqual(getTabFromPathname('/Devices/'), 'devices');
      assert.strictEqual(getTabFromPathname('/RemoteConfig/'), 'remote-config');
      assert.strictEqual(getDocumentTitle(null, '/RemoteConfig/'), 'QA Platform | Remote Config');
    });
  });

  describe('3. Unknown Routes & Sensible Fallback (QA Platform)', () => {
    it('returns "QA Platform" fallback when route is unrecognized', () => {
      assert.strictEqual(isKnownRoutePath('/unknown-route-xyz'), false);
      assert.strictEqual(getTabFromPathname('/unknown-route-xyz'), null);
      assert.strictEqual(getDocumentTitle(null, '/unknown-route-xyz'), 'QA Platform');
    });

    it('returns fallback "QA Platform" if active tab is invalid and pathname is unknown', () => {
      assert.strictEqual(getDocumentTitle('invalid-tab-id', '/404'), 'QA Platform');
    });

    it('returns "QA Platform" if both tab and pathname are empty or null', () => {
      assert.strictEqual(getDocumentTitle(null, null), 'QA Platform');
      assert.strictEqual(formatDocumentTitle(null), 'QA Platform');
      assert.strictEqual(formatDocumentTitle(''), 'QA Platform');
    });
  });

  describe('4. Navigation State & Modal Non-Interference', () => {
    it('preserves tab title when non-navigation state changes occur (simulated)', () => {
      // Starting on Builds tab
      let activeTab = 'builds';
      let title = getDocumentTitle(activeTab, '/builds');
      assert.strictEqual(title, 'QA Platform | Builds & AAB');

      // Modal opens (e.g. AabUploadModal: modalOpen = true)
      let modalOpen = true;
      let modalTitle = getDocumentTitle(activeTab, '/builds');
      assert.strictEqual(modalTitle, 'QA Platform | Builds & AAB', 'Modal opening must not alter document title');

      // Dropdown selection (selectedBuild changed)
      let selectedBuild = { id: 1, name: 'flyermaker.aab' };
      let dropdownTitle = getDocumentTitle(activeTab, '/builds');
      assert.strictEqual(dropdownTitle, 'QA Platform | Builds & AAB', 'Dropdown selection must not alter document title');

      // User navigates to Test History
      activeTab = 'history';
      let navigatedTitle = getDocumentTitle(activeTab, '/');
      assert.strictEqual(navigatedTitle, 'QA Platform | Test History');
    });
  });
});
