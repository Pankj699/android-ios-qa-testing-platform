const { describe, test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

describe('BugDesk Platform Selection Persistence Across Bug Reports Test Suite', () => {
  let scopedStorage;
  let pmsIntegration;
  let reportFormat;
  let mockStorage = {};
  let dispatchedEvents = [];

  // Helper simulating BugReportPreview's resolvePlatform function
  function resolvePlatform({ userId, initialPlatform, reportContext }) {
    // 1. Authenticated user's saved platform preference
    if (userId) {
      const saved = scopedStorage.getSelectedPlatform(userId);
      if (saved === 'android' || saved === 'ios') {
        return saved;
      }
    }

    // 2. Explicit initialPlatform prop if valid (when no saved preference exists)
    if (initialPlatform === 'android' || initialPlatform === 'ios') {
      return initialPlatform;
    }

    // 3. Existing context detection behavior
    const detected = pmsIntegration.detectPlatformFromContext(reportContext);
    if (detected === 'android' || detected === 'ios') {
      return detected;
    }

    // 4. Default fallback placeholder
    return '';
  }

  // Component lifecycle simulator mirroring BugReportPreview.jsx
  class BugReportPreviewSimulator {
    constructor({ userId, report, initialPlatform = null }) {
      this.currentUserId = userId || null;
      this.lastUserId = this.currentUserId;
      this.isManualSelection = false;
      this.report = report;
      this.initialPlatform = initialPlatform;
      this.platform = resolvePlatform({
        userId: this.currentUserId,
        initialPlatform: this.initialPlatform,
        reportContext: { project: report?.project, module: report?.module },
      });
    }

    handlePlatformChange(val) {
      if (val !== 'android' && val !== 'ios') return;
      this.isManualSelection = true;
      this.platform = val;
      if (this.currentUserId) {
        scopedStorage.saveSelectedPlatform(this.currentUserId, val);
      }
    }

    updateUser(newUserId) {
      if (newUserId !== this.lastUserId) {
        this.currentUserId = newUserId || null;
        this.lastUserId = this.currentUserId;
        this.isManualSelection = false;
        this.platform = resolvePlatform({
          userId: this.currentUserId,
          initialPlatform: this.initialPlatform,
          reportContext: { project: this.report?.project, module: this.report?.module },
        });
      }
    }

    updateReport(newReport) {
      this.report = newReport;
      // Context changes: NEVER override if user has manually selected or saved a preference
      const saved = this.currentUserId ? scopedStorage.getSelectedPlatform(this.currentUserId) : null;
      if (this.isManualSelection || saved === 'android' || saved === 'ios') {
        return;
      }
      const detected = pmsIntegration.detectPlatformFromContext({
        project: newReport?.project,
        module: newReport?.module,
      });
      this.platform = detected || '';
    }
  }

  before(async () => {
    mockStorage = {};
    dispatchedEvents = [];
    global.window = {
      localStorage: {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(mockStorage, k) ? mockStorage[k] : null),
        setItem: (k, v) => { mockStorage[k] = String(v); },
        removeItem: (k) => { delete mockStorage[k]; },
        clear: () => { mockStorage = {}; },
      },
      dispatchEvent: (evt) => {
        dispatchedEvents.push(evt);
      },
    };
    global.CustomEvent = class CustomEvent {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
    };

    const storagePath = path.resolve(__dirname, '../../frontend/src/bugdesk/lib/scoped-storage.js');
    scopedStorage = await import(pathToFileURL(storagePath).href);

    const pmsPath = path.resolve(__dirname, '../../frontend/src/bugdesk/lib/pms-integration.js');
    pmsIntegration = await import(pathToFileURL(pmsPath).href);

    const formatPath = path.resolve(__dirname, '../../frontend/src/bugdesk/lib/report-format.js');
    reportFormat = await import(pathToFileURL(formatPath).href);
  });

  beforeEach(() => {
    mockStorage = {};
    dispatchedEvents = [];
  });

  describe('1. No saved preference: existing default / context detection', () => {
    test('1.1 When no preference exists and context is Android, defaults to android', () => {
      const comp = new BugReportPreviewSimulator({
        userId: 'tester-01',
        report: { project: 'Flyer Maker Android', module: 'Canvas' },
      });
      assert.strictEqual(comp.platform, 'android');
    });

    test('1.2 When no preference exists and context is iOS, defaults to ios', () => {
      const comp = new BugReportPreviewSimulator({
        userId: 'tester-01',
        report: { project: 'IHA iOS', module: 'Onboarding' },
      });
      assert.strictEqual(comp.platform, 'ios');
    });

    test('1.3 When no preference exists and context is ambiguous, defaults to empty placeholder', () => {
      const comp = new BugReportPreviewSimulator({
        userId: 'tester-01',
        report: { project: 'Generic Backend API', module: 'Auth' },
      });
      assert.strictEqual(comp.platform, '');
    });
  });

  describe('2 & 3. Manual Platform Selection & Persistence (Android & iOS)', () => {
    test('2.1 Manually selecting Android saves and persists to scoped storage', () => {
      const comp = new BugReportPreviewSimulator({
        userId: 'tester-01',
        report: { project: 'Generic Project', module: 'Core' },
      });
      comp.handlePlatformChange('android');

      assert.strictEqual(comp.platform, 'android');
      assert.strictEqual(scopedStorage.getSelectedPlatform('tester-01'), 'android');
      assert.strictEqual(mockStorage['qabr:tester-01:selected-platform'], JSON.stringify('android'));
      assert.strictEqual(dispatchedEvents.length, 1);
      assert.strictEqual(dispatchedEvents[0].type, 'bugdesk:platform-updated');
      assert.deepStrictEqual(dispatchedEvents[0].detail, { userId: 'tester-01', platform: 'android' });
    });

    test('3.1 Manually selecting iOS saves and persists to scoped storage', () => {
      const comp = new BugReportPreviewSimulator({
        userId: 'tester-01',
        report: { project: 'Flyer Maker Android', module: 'Core' },
      });
      // Initially android from context
      assert.strictEqual(comp.platform, 'android');

      // User manually selects iOS
      comp.handlePlatformChange('ios');

      assert.strictEqual(comp.platform, 'ios');
      assert.strictEqual(scopedStorage.getSelectedPlatform('tester-01'), 'ios');
      assert.strictEqual(mockStorage['qabr:tester-01:selected-platform'], JSON.stringify('ios'));
    });
  });

  describe('4 & 5. Multiple Bug Generations & Clear / New Report Preservation', () => {
    test('4.1 Generating multiple bug reports preserves user-selected platform', () => {
      const userId = 'qa-lead';
      scopedStorage.saveSelectedPlatform(userId, 'ios');

      // First report generated
      const comp1 = new BugReportPreviewSimulator({
        userId,
        report: { id: 'rep-1', project: 'Android Project A', module: 'Module 1' },
      });
      assert.strictEqual(comp1.platform, 'ios');

      // Second report generated with different project context
      const comp2 = new BugReportPreviewSimulator({
        userId,
        report: { id: 'rep-2', project: 'Android Project B', module: 'Module 2' },
      });
      assert.strictEqual(comp2.platform, 'ios');
    });

    test('5.1 Resetting draft / clearing form does not erase selected platform', () => {
      const userId = 'qa-lead';
      scopedStorage.saveSelectedPlatform(userId, 'ios');
      scopedStorage.saveNewBugDraft(userId, { rawNotes: 'Test crash', report: null });

      // Ensure draft exists
      assert.notStrictEqual(scopedStorage.getNewBugDraft(userId), null);

      // User clicks "New Report" / handleClearDraft
      scopedStorage.clearNewBugDraft(userId);
      assert.strictEqual(scopedStorage.getNewBugDraft(userId), null);

      // Selected platform remains intact
      assert.strictEqual(scopedStorage.getSelectedPlatform(userId), 'ios');

      // Subsequent preview mounts with iOS
      const comp = new BugReportPreviewSimulator({
        userId,
        report: { id: 'rep-next', project: 'Android Module', module: 'Settings' },
      });
      assert.strictEqual(comp.platform, 'ios');
    });
  });

  describe('6. Context Changes Do Not Override Saved or Manual Selection', () => {
    test('6.1 Updating report with Android context does NOT overwrite saved iOS selection', () => {
      const userId = 'qa-dev';
      scopedStorage.saveSelectedPlatform(userId, 'ios');

      const comp = new BugReportPreviewSimulator({
        userId,
        report: { project: 'Initial Project', module: 'Main' },
      });
      assert.strictEqual(comp.platform, 'ios');

      // Context changes to an Android project
      comp.updateReport({ project: 'Explicit Android Suite', module: 'Camera' });

      // Must remain iOS
      assert.strictEqual(comp.platform, 'ios');
    });

    test('6.2 Updating report with iOS context does NOT overwrite saved Android selection', () => {
      const userId = 'qa-dev';
      scopedStorage.saveSelectedPlatform(userId, 'android');

      const comp = new BugReportPreviewSimulator({
        userId,
        report: { project: 'Initial Project', module: 'Main' },
      });
      assert.strictEqual(comp.platform, 'android');

      // Context changes to an iOS project
      comp.updateReport({ project: 'IHA iPhone App', module: 'Editor' });

      // Must remain Android
      assert.strictEqual(comp.platform, 'android');
    });
  });

  describe('7 & 8. Navigation & Browser Refresh Restoration', () => {
    test('7.1 Navigating away and returning to BugDesk restores the saved selection', () => {
      const userId = 'tester-session';
      // User selects iOS in BugDesk
      scopedStorage.saveSelectedPlatform(userId, 'ios');

      // Simulator: user navigates to "Run PAD Test" or "Builds & AAB" (component unmounts)
      // Later user returns to BugDesk (component remounts)
      const comp = new BugReportPreviewSimulator({
        userId,
        report: { project: 'Android Project', module: 'Canvas' },
      });

      assert.strictEqual(comp.platform, 'ios');
    });

    test('8.1 Browser reload restores the saved platform selection from localStorage', () => {
      const userId = 'tester-reload';
      scopedStorage.saveSelectedPlatform(userId, 'android');

      // Verify stored in localStorage
      assert.strictEqual(mockStorage['qabr:tester-reload:selected-platform'], JSON.stringify('android'));

      // New simulator instance simulates page reload
      const comp = new BugReportPreviewSimulator({
        userId,
        report: { project: 'IHA iOS Pro', module: 'Settings' },
      });

      assert.strictEqual(comp.platform, 'android');
    });
  });

  describe('9 & 11. Multi-User Isolation & User Switching', () => {
    test('9.1 User A and User B preferences remain completely isolated', () => {
      scopedStorage.saveSelectedPlatform('user-a', 'android');
      scopedStorage.saveSelectedPlatform('user-b', 'ios');

      assert.strictEqual(scopedStorage.getSelectedPlatform('user-a'), 'android');
      assert.strictEqual(scopedStorage.getSelectedPlatform('user-b'), 'ios');
    });

    test('11.1 Switching from User A to User B loads User B preference without leaking User A', () => {
      scopedStorage.saveSelectedPlatform('user-alice', 'ios');
      // User Bob has never set a preference
      const comp = new BugReportPreviewSimulator({
        userId: 'user-alice',
        report: { project: 'Android Project', module: 'Dashboard' },
      });
      assert.strictEqual(comp.platform, 'ios');

      // Switch active user to Bob
      comp.updateUser('user-bob');

      // Bob should get context detection (android), not Alice's ios
      assert.strictEqual(comp.platform, 'android');
    });

    test('11.2 Legacy migration claims unscoped platform exclusively and never leaks to another user', () => {
      // Simulate legacy unscoped key from standalone bugdesk
      mockStorage['qabr:selected-platform'] = JSON.stringify('ios');

      // First user logs in and claims it
      const p1 = scopedStorage.getSelectedPlatform('user-first');
      assert.strictEqual(p1, 'ios');

      // The unscoped key must have been removed so it cannot be claimed by a second user
      assert.strictEqual(mockStorage['qabr:selected-platform'], undefined);

      // Second user gets null (and thus falls back to context)
      const p2 = scopedStorage.getSelectedPlatform('user-second');
      assert.strictEqual(p2, null);
    });
  });

  describe('10. Invalid Stored Values & Corruption Recovery', () => {
    test('10.1 Returns null and falls back safely on invalid platform strings', () => {
      mockStorage['qabr:tester-corrupt:selected-platform'] = JSON.stringify('windows');
      assert.strictEqual(scopedStorage.getSelectedPlatform('tester-corrupt'), null);

      const comp = new BugReportPreviewSimulator({
        userId: 'tester-corrupt',
        report: { project: 'Android Build', module: 'Core' },
      });
      assert.strictEqual(comp.platform, 'android');
    });

    test('10.2 Returns null and falls back safely on malformed JSON in localStorage', () => {
      mockStorage['qabr:tester-bad-json:selected-platform'] = '{bad-json:::';
      assert.strictEqual(scopedStorage.getSelectedPlatform('tester-bad-json'), null);

      const comp = new BugReportPreviewSimulator({
        userId: 'tester-bad-json',
        report: { project: 'iOS App', module: 'Core' },
      });
      assert.strictEqual(comp.platform, 'ios');
    });

    test('10.3 Rejects saving invalid platforms and handles null/empty user gracefully', () => {
      assert.doesNotThrow(() => {
        scopedStorage.saveSelectedPlatform('user-1', 'windows');
        scopedStorage.saveSelectedPlatform('user-1', 123);
        scopedStorage.saveSelectedPlatform(null, 'android');
        scopedStorage.saveSelectedPlatform('', 'android');
      });

      assert.strictEqual(scopedStorage.getSelectedPlatform('user-1'), null);
      assert.strictEqual(scopedStorage.getSelectedPlatform(null), null);
      assert.strictEqual(scopedStorage.getSelectedPlatform(''), null);
    });
  });

  describe('12. Existing PMS, Copy, and Report Generation Functionality Intact', () => {
    test('12.1 buildPMSIssueUrl correctly builds URL with the persisted platform', () => {
      const report = {
        project: 'Flyer Maker',
        module: 'Editor',
        round: 'R1',
        title: 'Crash on tap',
        steps: ['Open app', 'Tap button'],
        actualResult: 'App crashes',
        expectedResult: 'Button responds',
      };

      const urlAndroid = pmsIntegration.buildPMSIssueUrl('android', {
        subject: reportFormat.buildHeading(report),
        description: reportFormat.buildBodyText(report),
      });
      assert.ok(urlAndroid.includes('projects/cp-photo-editor-suite/issues/new'));
      assert.ok(urlAndroid.includes('issue%5Bsubject%5D='));

      const urlIos = pmsIntegration.buildPMSIssueUrl('ios', {
        subject: reportFormat.buildHeading(report),
        description: reportFormat.buildBodyText(report),
      });
      assert.ok(urlIos.includes('projects/iha_ios/issues/new'));
      assert.ok(urlIos.includes('issue%5Bsubject%5D='));
    });
  });
});
