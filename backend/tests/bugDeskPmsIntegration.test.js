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

    const reportFormatPath = path.resolve(__dirname, '../../frontend/src/bugdesk/lib/report-format.js');
    const reportFormatModule = await import(pathToFileURL(reportFormatPath).href);
    buildHeading = reportFormatModule.buildHeading;
    buildBodyText = reportFormatModule.buildBodyText;
    buildPMSReportText = reportFormatModule.buildPMSReportText;
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
});
