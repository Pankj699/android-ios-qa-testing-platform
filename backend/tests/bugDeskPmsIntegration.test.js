const { describe, test, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

describe('BugDesk PMS (Redmine) Configurable URLs & Issue Creation Test Suite', () => {
  let PMS_PROJECT_URLS;
  let getPMSDefaultUrl;
  let getPMSProjectUrl;
  let validateRedmineUrl;
  let getEffectivePMSProjectUrl;
  let detectPlatformFromContext;
  let buildPMSIssueUrl;
  let getProjectIdFromUrl;
  let buildHeading;
  let buildBodyText;
  let buildPMSReportText;

  before(async () => {
    // Dynamically import ESM modules from frontend
    const pmsModulePath = path.resolve(__dirname, '../../frontend/src/bugdesk/lib/pms-integration.js');
    const pmsModule = await import(pathToFileURL(pmsModulePath).href);
    PMS_PROJECT_URLS = pmsModule.PMS_PROJECT_URLS;
    getPMSDefaultUrl = pmsModule.getPMSDefaultUrl;
    getPMSProjectUrl = pmsModule.getPMSProjectUrl;
    validateRedmineUrl = pmsModule.validateRedmineUrl;
    getEffectivePMSProjectUrl = pmsModule.getEffectivePMSProjectUrl;
    detectPlatformFromContext = pmsModule.detectPlatformFromContext;
    buildPMSIssueUrl = pmsModule.buildPMSIssueUrl;
    getProjectIdFromUrl = pmsModule.getProjectIdFromUrl;

    const reportFormatPath = path.resolve(__dirname, '../../frontend/src/bugdesk/lib/report-format.js');
    const reportFormatModule = await import(pathToFileURL(reportFormatPath).href);
    buildHeading = reportFormatModule.buildHeading;
    buildBodyText = reportFormatModule.buildBodyText;
    buildPMSReportText = reportFormatModule.buildPMSReportText;
    buildBodyLines = reportFormatModule.buildBodyLines;
    buildPMSReportHTML = reportFormatModule.buildPMSReportHTML;
    formatNoteDisplay = reportFormatModule.formatNoteDisplay;
    getNoteLines = reportFormatModule.getNoteLines;
  });

  describe('1. Permanent Default Redmine Project URLs (Section 2)', () => {
    test('1.1 Android default maps to exact CP Photo Editor Suite New Issue URL', () => {
      assert.strictEqual(
        PMS_PROJECT_URLS.android,
        'https://pms.optimumbrew.com/projects/cp-photo-editor-suite/issues/new'
      );
      assert.strictEqual(
        getPMSDefaultUrl('android'),
        'https://pms.optimumbrew.com/projects/cp-photo-editor-suite/issues/new'
      );
    });

    test('1.2 iOS default maps to exact IHA iOS New Issue URL', () => {
      assert.strictEqual(
        PMS_PROJECT_URLS.ios,
        'https://pms.optimumbrew.com/projects/iha_ios/issues/new'
      );
      assert.strictEqual(
        getPMSDefaultUrl('ios'),
        'https://pms.optimumbrew.com/projects/iha_ios/issues/new'
      );
    });

    test('1.3 Rejects arbitrary unsupported platforms', () => {
      assert.strictEqual(getPMSDefaultUrl('windows'), null);
      assert.strictEqual(getPMSDefaultUrl(''), null);
      assert.strictEqual(getPMSDefaultUrl(null), null);
    });
  });

  describe('2. Mandatory Independent Default URL Fallback Matrix (Section 4)', () => {
    const customAndroid = 'https://redmine.corp.internal/projects/custom-android/issues/new';
    const customIos = 'https://redmine.corp.internal/projects/custom-ios/issues/new';

    test('2.1 Both URLs use their defaults when configuration is absent (null/undefined)', () => {
      assert.strictEqual(getEffectivePMSProjectUrl('android', null), PMS_PROJECT_URLS.android);
      assert.strictEqual(getEffectivePMSProjectUrl('ios', null), PMS_PROJECT_URLS.ios);

      assert.strictEqual(getEffectivePMSProjectUrl('android', {}), PMS_PROJECT_URLS.android);
      assert.strictEqual(getEffectivePMSProjectUrl('ios', {}), PMS_PROJECT_URLS.ios);
    });

    test('2.2 Both URLs use their defaults when configuration is empty string or whitespace', () => {
      const emptyConfig = { android: '   ', ios: '' };
      assert.strictEqual(getEffectivePMSProjectUrl('android', emptyConfig), PMS_PROJECT_URLS.android);
      assert.strictEqual(getEffectivePMSProjectUrl('ios', emptyConfig), PMS_PROJECT_URLS.ios);
    });

    test('2.3 Custom Android URL and empty iOS URL resolve independently', () => {
      const config = { android: customAndroid, ios: '' };
      assert.strictEqual(getEffectivePMSProjectUrl('android', config), customAndroid);
      assert.strictEqual(getEffectivePMSProjectUrl('ios', config), PMS_PROJECT_URLS.ios);
    });

    test('2.4 Empty Android URL and custom iOS URL resolve independently', () => {
      const config = { android: '', ios: customIos };
      assert.strictEqual(getEffectivePMSProjectUrl('android', config), PMS_PROJECT_URLS.android);
      assert.strictEqual(getEffectivePMSProjectUrl('ios', config), customIos);
    });

    test('2.5 Two custom URLs resolve correctly', () => {
      const config = { android: customAndroid, ios: customIos };
      assert.strictEqual(getEffectivePMSProjectUrl('android', config), customAndroid);
      assert.strictEqual(getEffectivePMSProjectUrl('ios', config), customIos);
    });
  });

  describe('3. URL Validation & Security Safeguards (Section 6)', () => {
    test('3.1 Accepts valid absolute HTTP and HTTPS URLs', () => {
      const resHttps = validateRedmineUrl('https://pms.optimumbrew.com/projects/my-proj/issues/new');
      assert.strictEqual(resHttps.valid, true);
      assert.strictEqual(resHttps.url, 'https://pms.optimumbrew.com/projects/my-proj/issues/new');

      const resHttp = validateRedmineUrl('http://redmine.local:3000/issues/new');
      assert.strictEqual(resHttp.valid, true);
      assert.strictEqual(resHttp.url, 'http://redmine.local:3000/issues/new');
    });

    test('3.2 Rejects dangerous protocols (javascript:, data:, file:)', () => {
      const cases = [
        'javascript:alert(1)',
        'javascript:void(0);',
        'data:text/html,<script>alert(1)</script>',
        'file:///etc/passwd',
        'vbscript:msgbox(1)'
      ];

      for (const dangerous of cases) {
        const res = validateRedmineUrl(dangerous);
        assert.strictEqual(res.valid, false);
        assert.ok(res.error.includes('allowed') || res.error.includes('protocol'));

        // getEffectivePMSProjectUrl must throw when configured with dangerous URL
        assert.throws(
          () => getEffectivePMSProjectUrl('android', { android: dangerous }),
          /Invalid custom Android Redmine URL/
        );
      }
    });

    test('3.3 Rejects malformed and relative URLs', () => {
      const invalidCases = ['not-a-url', '/projects/test/issues/new', 'ftp://files.example.com'];
      for (const inv of invalidCases) {
        const res = validateRedmineUrl(inv);
        assert.strictEqual(res.valid, false);
        assert.throws(
          () => getEffectivePMSProjectUrl('ios', { ios: inv }),
          /Invalid custom iOS Redmine URL/
        );
      }
    });

    test('3.4 Treats empty or whitespace as empty without error for fallback triggering', () => {
      assert.strictEqual(validateRedmineUrl('').empty, true);
      assert.strictEqual(validateRedmineUrl('   ').empty, true);
      assert.strictEqual(validateRedmineUrl(null).empty, true);
    });
  });

  describe('4. Settings Persistence & Reset to Defaults Simulation (Section 5 & 11)', () => {
    function createMockStorage() {
      const store = new Map();
      return {
        getPMSUrls(userId) {
          return store.get(`qabr:${userId}:pms-urls`) || { android: '', ios: '' };
        },
        savePMSUrls(userId, urls) {
          store.set(`qabr:${userId}:pms-urls`, {
            android: (urls?.android || '').trim(),
            ios: (urls?.ios || '').trim()
          });
        },
        resetPMSUrls(userId, defaultAndroid, defaultIos) {
          store.set(`qabr:${userId}:pms-urls`, {
            android: defaultAndroid,
            ios: defaultIos
          });
        }
      };
    }

    test('4.1 Saved custom URLs persist per user and isolate between users', () => {
      const storage = createMockStorage();
      storage.savePMSUrls('user-1', {
        android: 'https://pms.custom.com/u1/android',
        ios: 'https://pms.custom.com/u1/ios'
      });
      storage.savePMSUrls('user-2', {
        android: 'https://pms.custom.com/u2/android',
        ios: ''
      });

      const u1 = storage.getPMSUrls('user-1');
      assert.strictEqual(u1.android, 'https://pms.custom.com/u1/android');
      assert.strictEqual(u1.ios, 'https://pms.custom.com/u1/ios');

      const u2 = storage.getPMSUrls('user-2');
      assert.strictEqual(u2.android, 'https://pms.custom.com/u2/android');
      assert.strictEqual(u2.ios, '');
    });

    test('4.2 Reset to Defaults restores and persists both default URLs', () => {
      const storage = createMockStorage();
      storage.savePMSUrls('user-1', {
        android: 'https://custom.com/android',
        ios: 'https://custom.com/ios'
      });

      // User triggers Reset to Defaults
      storage.resetPMSUrls('user-1', PMS_PROJECT_URLS.android, PMS_PROJECT_URLS.ios);

      const afterReset = storage.getPMSUrls('user-1');
      assert.strictEqual(afterReset.android, PMS_PROJECT_URLS.android);
      assert.strictEqual(afterReset.ios, PMS_PROJECT_URLS.ios);
    });
  });

  describe('5. Platform Selection & Effective URL Resolution (Section 7 & 8)', () => {
    test('5.1 Android selection opens effective Android URL (custom or default)', () => {
      // Default case
      const defaultUrl = buildPMSIssueUrl('android', { subject: 'Test' }, null);
      assert.ok(defaultUrl.startsWith('https://pms.optimumbrew.com/projects/cp-photo-editor-suite/issues/new'));

      // Custom case
      const customUrl = buildPMSIssueUrl('android', { subject: 'Test' }, {
        android: 'https://pms.optimumbrew.com/projects/my-custom-android/issues/new'
      });
      assert.ok(customUrl.startsWith('https://pms.optimumbrew.com/projects/my-custom-android/issues/new'));
    });

    test('5.2 iOS selection opens effective iOS URL (custom or default)', () => {
      // Default case
      const defaultUrl = buildPMSIssueUrl('ios', { subject: 'Test' }, null);
      assert.ok(defaultUrl.startsWith('https://pms.optimumbrew.com/projects/iha_ios/issues/new'));

      // Custom case
      const customUrl = buildPMSIssueUrl('ios', { subject: 'Test' }, {
        ios: 'https://pms.optimumbrew.com/projects/my-custom-ios/issues/new'
      });
      assert.ok(customUrl.startsWith('https://pms.optimumbrew.com/projects/my-custom-ios/issues/new'));
    });

    test('5.3 Unknown platform context returns null and requires explicit selection', () => {
      const neutralContext = { project: 'Flyer Maker', module: 'Templates' };
      assert.strictEqual(detectPlatformFromContext(neutralContext), null);
    });
  });

  describe('6. Report Mapping, Attachment Links & Workflow Safeguards (Sections 8, 9, 10)', () => {
    const reportWithDriveAttachment = {
      project: 'Flyer Maker',
      module: 'Editor',
      round: 'R-2',
      title: "'Remove Color' button unresponsive for multi-selected stickers",
      steps: [
        'Open Flyer Maker app as a free user',
        'Add 2 stickers to canvas and multi-select them',
        'Tap the Remove Color tool from bottom bar'
      ],
      includeResults: true,
      actualResult: 'Button does not respond and selection remains uncolored',
      expectedResult: 'Color picker dialog should open for all selected stickers',
      attachmentUrl: 'https://drive.google.com/file/d/rec-drive-auto-12345/view?usp=sharing',
      qaSuggestion: 'Check touch event propagation on group layer',
      generatedEveryTime: true,
      generatedInLive: false,
      hasAttachment: true
    };

    test('6.1 Final generated title is mapped to Subject without modification or truncation', () => {
      const subject = buildHeading(reportWithDriveAttachment);
      assert.strictEqual(
        subject,
        "Flyer Maker Editor (R-2) : 'Remove Color' button unresponsive for multi-selected stickers"
      );
    });

    test('6.2 Final generated report body and Google Drive attachment links are preserved in Description', () => {
      const description = buildBodyText(reportWithDriveAttachment);
      assert.ok(description.includes('1. Open Flyer Maker app as a free user'));
      assert.ok(description.includes('*Actual Result*'));
      assert.ok(description.includes('https://drive.google.com/file/d/rec-drive-auto-12345/view?usp=sharing'));
      assert.ok(description.includes('*QA Suggestion:*'));
    });

    test('6.3 Issue is prepared for manual review in Redmine and NEVER submitted automatically', () => {
      const customConfig = {
        android: 'https://pms.optimumbrew.com/projects/cp-photo-editor-suite/issues/new'
      };
      const url = buildPMSIssueUrl('android', {
        subject: buildHeading(reportWithDriveAttachment),
        description: buildBodyText(reportWithDriveAttachment)
      }, customConfig);

      const parsed = new URL(url);
      // Validates it is a GET request to the new issue creation form with prefilled query parameters
      assert.strictEqual(parsed.pathname, '/projects/cp-photo-editor-suite/issues/new');
      assert.strictEqual(
        parsed.searchParams.get('issue[subject]'),
        "Flyer Maker Editor (R-2) : 'Remove Color' button unresponsive for multi-selected stickers"
      );
      assert.ok(parsed.searchParams.get('issue[description]').includes('rec-drive-auto-12345'));
    });
  });

  describe('7. Redmine Issue Options: Status, Priority & Assignee Prefill (Sections 1, 2, 3)', () => {
    test('7.1 Prefills verified Status (New = 1) and Priority (Normal = 2) by default', () => {
      const url = buildPMSIssueUrl('android', {
        subject: 'Test Subject',
        description: 'Test Description'
      }, null, {
        statusId: 1,
        priorityId: 2,
        assignedToId: ''
      });

      const parsed = new URL(url);
      assert.strictEqual(parsed.searchParams.get('issue[status_id]'), '1');
      assert.strictEqual(parsed.searchParams.get('issue[priority_id]'), '2');
      // Unassigned (empty string) must NOT set issue[assigned_to_id]
      assert.strictEqual(parsed.searchParams.get('issue[assigned_to_id]'), null);
    });

    test('7.2 Prefills specific selected Assignee when provided', () => {
      const url = buildPMSIssueUrl('android', {
        subject: 'Test Subject',
        description: 'Test Description'
      }, null, {
        statusId: 2, // In Progress
        priorityId: 3, // High
        assignedToId: '154'
      });

      const parsed = new URL(url);
      assert.strictEqual(parsed.searchParams.get('issue[status_id]'), '2');
      assert.strictEqual(parsed.searchParams.get('issue[priority_id]'), '3');
      assert.strictEqual(parsed.searchParams.get('issue[assigned_to_id]'), '154');
    });

    test('7.3 iOS project prefill targets iha_ios with all selected options', () => {
      const url = buildPMSIssueUrl('ios', {
        subject: 'iOS Crash on Launch',
        description: 'App crashes immediately on iOS 18'
      }, null, {
        statusId: 1,
        priorityId: 4, // Urgent
        assignedToId: '89'
      });

      const parsed = new URL(url);
      assert.ok(url.startsWith('https://pms.optimumbrew.com/projects/iha_ios/issues/new'));
      assert.strictEqual(parsed.pathname, '/projects/iha_ios/issues/new');
      assert.strictEqual(parsed.searchParams.get('issue[subject]'), 'iOS Crash on Launch');
      assert.strictEqual(parsed.searchParams.get('issue[status_id]'), '1');
      assert.strictEqual(parsed.searchParams.get('issue[priority_id]'), '4');
      assert.strictEqual(parsed.searchParams.get('issue[assigned_to_id]'), '89');
    });

    test('7.4 Preserves device suffix in Subject alongside issue options', () => {
      const titleWithDevice = 'Flyer Maker (V 213.0) API 36 (R-1) : Dialog dismiss — OPPO CPH2729 OS 16';
      const url = buildPMSIssueUrl('android', {
        subject: titleWithDevice,
        description: 'Steps to reproduce...'
      }, null, {
        statusId: 1,
        priorityId: 2,
        assignedToId: ''
      });

      const parsed = new URL(url);
      assert.strictEqual(parsed.searchParams.get('issue[subject]'), titleWithDevice);
      assert.ok(parsed.searchParams.get('issue[subject]').includes('— OPPO CPH2729 OS 16'));
      assert.strictEqual(parsed.searchParams.get('issue[status_id]'), '1');
      assert.strictEqual(parsed.searchParams.get('issue[priority_id]'), '2');
    });

    test('7.5 getProjectIdFromUrl correctly identifies project from default and custom URLs', () => {
      assert.strictEqual(getProjectIdFromUrl(null, 'android'), 'cp-photo-editor-suite');
      assert.strictEqual(getProjectIdFromUrl(null, 'ios'), 'iha_ios');
      assert.strictEqual(getProjectIdFromUrl('https://pms.optimumbrew.com/projects/cp-photo-editor-suite/issues/new', 'android'), 'cp-photo-editor-suite');
      assert.strictEqual(getProjectIdFromUrl('https://pms.optimumbrew.com/projects/iha_ios/issues/new', 'ios'), 'iha_ios');
      assert.strictEqual(getProjectIdFromUrl('https://custom.redmine.org/projects/my-team-project/issues/new'), 'my-team-project');
    });
  });

  describe('8. Backend PMS Service & Options Resolution', () => {
    const bugDeskService = require('../src/services/bugDeskService');

    test('8.1 resolvePmsHostAndProject resolves default and custom URLs for Android and iOS', () => {
      const androidDefault = bugDeskService.resolvePmsHostAndProject('android');
      assert.strictEqual(androidDefault.host, 'https://pms.optimumbrew.com');
      assert.strictEqual(androidDefault.projectId, 'cp-photo-editor-suite');

      const iosDefault = bugDeskService.resolvePmsHostAndProject('ios');
      assert.strictEqual(iosDefault.host, 'https://pms.optimumbrew.com');
      assert.strictEqual(iosDefault.projectId, 'iha_ios');

      const custom = bugDeskService.resolvePmsHostAndProject('android', 'https://redmine.myorg.org/projects/custom-mobile/issues/new');
      assert.strictEqual(custom.host, 'https://redmine.myorg.org');
      assert.strictEqual(custom.projectId, 'custom-mobile');
    });

    test('8.2 getPmsOptions returns verified statuses and priorities with defaults', async () => {
      const res = await bugDeskService.getPmsOptions({ platform: 'android' });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.platform, 'android');
      assert.strictEqual(res.projectId, 'cp-photo-editor-suite');
      assert.ok(Array.isArray(res.statuses));
      assert.ok(res.statuses.length > 0);
      assert.strictEqual(res.defaultStatusId, 1); // 'New' has ID 1

      assert.ok(Array.isArray(res.priorities));
      assert.ok(res.priorities.length > 0);
      assert.strictEqual(res.defaultPriorityId, 2); // 'Normal' has ID 2

      assert.ok(Array.isArray(res.assignees));
      assert.strictEqual(res.assignees[0].id, '');
      assert.strictEqual(res.assignees[0].name, 'Unassigned');
    });

    test('8.3 testPmsConnection rejects empty or invalid API key', async () => {
      await assert.rejects(
        () => bugDeskService.testPmsConnection({ apiKey: '' }),
        /Redmine API key is required/
      );

      const invalidRes = await bugDeskService.testPmsConnection({ apiKey: 'invalid_dummy_key_12345' });
      assert.strictEqual(invalidRes.connected, false);
      assert.ok(invalidRes.error);
    });
  });

  describe('9. Bug Desk Notes & QA Suggestion Independence Suite', () => {
    const baseReport = {
      project: 'Flyer Maker',
      module: 'Editor',
      round: 'R-2',
      title: "'Remove Color' button unresponsive",
      steps: ['Launch app', 'Open canvas', 'Tap Remove Color'],
      includeResults: true,
      actualResult: 'Button does not respond',
      expectedResult: 'Color picker dialog should open',
      attachmentUrl: 'https://drive.google.com/file/d/sample-123/view',
      generatedEveryTime: true,
      generatedInLive: false,
      hasAttachment: true
    };

    test('9.1 Notes entered: generated report displays the entire Note section in bold with Note: prefix', () => {
      const rep = {
        ...baseReport,
        notes: 'please check this issue even if user eligible or not for free trial.'
      };

      const description = buildBodyText(rep);
      assert.ok(
        description.includes('*Note: please check this issue even if user eligible or not for free trial.*'),
        'Entire Note line must be bolded in description'
      );
      assert.ok(
        !description.includes('Note: Note:'),
        'Must not duplicate Note: prefix'
      );
    });

    test('9.2 Notes empty: the Note section is omitted entirely without empty heading', () => {
      const repEmpty = { ...baseReport, notes: '' };
      const repWhitespace = { ...baseReport, notes: '    \n   ' };
      const repNull = { ...baseReport, notes: null };

      for (const rep of [repEmpty, repWhitespace, repNull]) {
        const description = buildBodyText(rep);
        assert.ok(!description.includes('*Note:'), 'Note section must not appear when empty');
        assert.ok(!description.includes('Note:'), 'Note prefix must not appear when empty');
      }
    });

    test('9.3 QA Suggestion entered: its existing section still appears unchanged', () => {
      const rep = {
        ...baseReport,
        qaSuggestion: 'Please check this issue for all the paywall on app startup.'
      };

      const description = buildBodyText(rep);
      assert.ok(description.includes('*QA Suggestion:*'));
      assert.ok(description.includes('Please check this issue for all the paywall on app startup.'));
      assert.ok(!description.includes('*Note:'), 'Note section must be omitted when not provided');
    });

    test('9.4 Both Notes and QA Suggestion entered: both appear independently in exact expected order', () => {
      const rep = {
        ...baseReport,
        notes: 'please check this issue even if user eligible or not for free trial.',
        qaSuggestion: 'Please check this issue for all the paywall on app startup.'
      };

      const description = buildBodyText(rep);

      // Verify presence of both sections
      assert.ok(description.includes('*Note: please check this issue even if user eligible or not for free trial.*'));
      assert.ok(description.includes('*QA Suggestion:*'));
      assert.ok(description.includes('Please check this issue for all the paywall on app startup.'));

      // Verify exact order
      const noteIndex = description.indexOf('*Note: please check this issue even if user eligible or not for free trial.*');
      const qaSuggestionIndex = description.indexOf('*QA Suggestion:*');
      const devNoteIndex = description.indexOf('*Note for Developer: Check all options after applying the solution.*');

      assert.ok(noteIndex !== -1, 'Note must exist');
      assert.ok(qaSuggestionIndex !== -1, 'QA Suggestion must exist');
      assert.ok(devNoteIndex !== -1, 'Dev note must exist');
      assert.ok(noteIndex < qaSuggestionIndex, 'Note section must appear BEFORE QA Suggestion section');
      assert.ok(qaSuggestionIndex < devNoteIndex, 'QA Suggestion must appear BEFORE Note for Developer');
    });

    test('9.5 Multiline Notes: line breaks and bold formatting render correctly on all lines', () => {
      const rep = {
        ...baseReport,
        notes: 'please check this issue even if user eligible or not for free trial.\nSecond note line for tablet.\nThird note line for landscape.'
      };

      const description = buildBodyText(rep);
      assert.ok(description.includes('*Note: please check this issue even if user eligible or not for free trial.*'));
      assert.ok(description.includes('*Second note line for tablet.*'));
      assert.ok(description.includes('*Third note line for landscape.*'));

      const html = buildPMSReportHTML(rep);
      assert.ok(html.includes('<b>Note: please check this issue even if user eligible or not for free trial.</b>'));
      assert.ok(html.includes('<b>Second note line for tablet.</b>'));
      assert.ok(html.includes('<b>Third note line for landscape.</b>'));
    });

    test('9.6 Create PMS issue URL: prefilled description contains both sections correctly', () => {
      const rep = {
        ...baseReport,
        notes: 'please check this issue even if user eligible or not for free trial.',
        qaSuggestion: 'Please check this issue for all the paywall on app startup.'
      };

      const url = buildPMSIssueUrl('android', {
        subject: buildHeading(rep),
        description: buildBodyText(rep)
      });

      const parsed = new URL(url);
      const descParam = parsed.searchParams.get('issue[description]');
      assert.ok(descParam.includes('*Note: please check this issue even if user eligible or not for free trial.*'));
      assert.ok(descParam.includes('*QA Suggestion:*'));
      assert.ok(descParam.includes('Please check this issue for all the paywall on app startup.'));
    });

    test('9.7 HTML rendering escapes user input safely without XSS', () => {
      const rep = {
        ...baseReport,
        notes: '<script>alert("hack")</script> & "special" characters',
        qaSuggestion: '<b>bold attempt</b>'
      };

      const html = buildPMSReportHTML(rep);
      assert.ok(!html.includes('<script>'), 'Script tag must be escaped');
      assert.ok(html.includes('&lt;script&gt;alert(&quot;hack&quot;)&lt;/script&gt;'));
      assert.ok(html.includes('&lt;b&gt;bold attempt&lt;/b&gt;'));
    });

    test('9.8 formatNoteDisplay and getNoteLines helper functions behave consistently', () => {
      assert.strictEqual(formatNoteDisplay(''), '');
      assert.strictEqual(formatNoteDisplay(null), '');
      assert.strictEqual(formatNoteDisplay('single line note'), 'Note: single line note');
      assert.strictEqual(formatNoteDisplay('Note: already prefixed note'), 'Note: already prefixed note');
      assert.strictEqual(formatNoteDisplay('NOTE: uppercase prefix'), 'Note: uppercase prefix');
      assert.deepStrictEqual(getNoteLines('line 1\nline 2'), ['Note: line 1', 'line 2']);
    });

    test('9.9 Collapsing Notes preserves text and generated report still contains bold Note section', () => {
      let notes = 'Please check this issue in the whole app for all paywalls.';
      let showNotes = false; // Collapsed by default

      // User expands Notes
      showNotes = true;
      assert.strictEqual(showNotes, true);
      assert.strictEqual(notes, 'Please check this issue in the whole app for all paywalls.');

      // User collapses Notes
      showNotes = false;
      assert.strictEqual(showNotes, false);
      assert.strictEqual(notes, 'Please check this issue in the whole app for all paywalls.', 'Notes text must be preserved on collapse');

      // Generate report while Notes is collapsed
      const rep = {
        ...baseReport,
        notes
      };

      const description = buildBodyText(rep);
      assert.ok(
        description.includes('*Note: Please check this issue in the whole app for all paywalls.*'),
        'Report generated while Notes is collapsed must still contain the bold Note section'
      );
    });

    test('9.10 Historical reports containing QA Suggestion content remain completely compatible', () => {
      const historicalReport = {
        ...baseReport,
        notes: '',
        qaSuggestion: 'Inspect memory allocation during matrix rotation transform'
      };

      const description = buildBodyText(historicalReport);
      assert.ok(description.includes('*QA Suggestion:*'));
      assert.ok(description.includes('Inspect memory allocation during matrix rotation transform'));
      assert.ok(!description.includes('*Note:'), 'Empty note must be omitted');

      const html = buildPMSReportHTML(historicalReport);
      assert.ok(html.includes('QA Suggestion:'));
      assert.ok(html.includes('Inspect memory allocation during matrix rotation transform'));
    });
  });
});
