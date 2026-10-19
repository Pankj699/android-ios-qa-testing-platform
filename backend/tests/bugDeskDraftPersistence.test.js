const { describe, test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

describe('BugDesk Draft Persistence & Tab Navigation State Retention Test Suite', () => {
  let scopedStorage;
  let reportFormat;
  let mockStorage = {};

  before(async () => {
    // Setup mock window & localStorage before importing frontend modules
    mockStorage = {};
    global.window = {
      localStorage: {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(mockStorage, k) ? mockStorage[k] : null),
        setItem: (k, v) => { mockStorage[k] = String(v); },
        removeItem: (k) => { delete mockStorage[k]; },
        clear: () => { mockStorage = {}; },
      },
      dispatchEvent: () => {},
    };

    const storagePath = path.resolve(__dirname, '../../frontend/src/bugdesk/lib/scoped-storage.js');
    scopedStorage = await import(pathToFileURL(storagePath).href);

    const formatPath = path.resolve(__dirname, '../../frontend/src/bugdesk/lib/report-format.js');
    reportFormat = await import(pathToFileURL(formatPath).href);
  });

  beforeEach(() => {
    mockStorage = {};
  });

  describe('1. In-Progress Form Draft Saving, Retrieval, and Clearing', () => {
    test('1.1 Returns null when no draft exists for user', () => {
      const draft = scopedStorage.getNewBugDraft('tester-01');
      assert.strictEqual(draft, null);
    });

    test('1.2 Saves and retrieves complete in-progress form inputs and checkboxes', () => {
      const draftData = {
        rawNotes: 'Open flyer editor\nClick save button\nApp crashes immediately',
        attachmentUrl: 'https://drive.google.com/file/d/12345/view',
        qaSuggestion: 'Check null pointer in EditorExportController',
        includeResults: true,
        generatedEveryTime: false,
        generatedInLive: true,
        hasAttachment: true,
        projectContext: {
          project: 'Flyer Maker v4.2',
          module: 'Editor Canvas',
          round: 'R-3',
        },
        report: null,
        updatedAt: Date.now(),
      };

      scopedStorage.saveNewBugDraft('tester-01', draftData);
      const retrieved = scopedStorage.getNewBugDraft('tester-01');

      assert.deepStrictEqual(retrieved, draftData);
      assert.strictEqual(retrieved.rawNotes, draftData.rawNotes);
      assert.strictEqual(retrieved.attachmentUrl, draftData.attachmentUrl);
      assert.strictEqual(retrieved.qaSuggestion, draftData.qaSuggestion);
      assert.strictEqual(retrieved.includeResults, true);
      assert.strictEqual(retrieved.generatedEveryTime, false);
      assert.strictEqual(retrieved.generatedInLive, true);
      assert.strictEqual(retrieved.hasAttachment, true);
      assert.strictEqual(retrieved.projectContext.project, 'Flyer Maker v4.2');
    });

    test('1.3 Clears draft cleanly upon user reset action', () => {
      scopedStorage.saveNewBugDraft('tester-01', {
        rawNotes: 'Some in progress notes',
        report: null,
      });

      assert.notStrictEqual(scopedStorage.getNewBugDraft('tester-01'), null);

      scopedStorage.clearNewBugDraft('tester-01');
      assert.strictEqual(scopedStorage.getNewBugDraft('tester-01'), null);
    });

    test('1.4 Safely ignores save/clear when userId is empty or null', () => {
      assert.doesNotThrow(() => {
        scopedStorage.saveNewBugDraft(null, { rawNotes: 'test' });
        scopedStorage.saveNewBugDraft('', { rawNotes: 'test' });
        scopedStorage.clearNewBugDraft(null);
        scopedStorage.clearNewBugDraft('');
      });
      assert.strictEqual(scopedStorage.getNewBugDraft(null), null);
      assert.strictEqual(scopedStorage.getNewBugDraft(''), null);
    });
  });

  describe('2. Generated Report Object Preservation Without AI Re-execution', () => {
    test('2.1 Preserves exact generated report structure and content in draft', () => {
      const generatedReport = {
        id: 'rep_abc_123',
        createdAt: 1729324800000,
        project: 'Photo Editor Suite',
        module: 'Crop Tool',
        round: 'R-2',
        title: 'Crash when rotating cropped canvas 90 degrees',
        steps: [
          'Open Photo Editor Suite',
          'Import image and select Crop Tool',
          'Rotate image by 90 degrees clockwise',
          'Tap Apply button',
        ],
        actualResult: 'Application freezes and closes unexpectedly',
        expectedResult: 'Canvas should rotate smoothly without crashing',
        includeResults: true,
        attachmentUrl: 'https://drive.google.com/file/d/rec-789/view',
        qaSuggestion: 'Inspect memory allocation during matrix rotation transform',
        generatedEveryTime: true,
        generatedInLive: false,
        hasAttachment: true,
        rawNotes: 'rotate crop canvas 90 deg -> crash',
      };

      const fullDraft = {
        rawNotes: generatedReport.rawNotes,
        attachmentUrl: generatedReport.attachmentUrl,
        qaSuggestion: generatedReport.qaSuggestion,
        includeResults: generatedReport.includeResults,
        generatedEveryTime: generatedReport.generatedEveryTime,
        generatedInLive: generatedReport.generatedInLive,
        hasAttachment: generatedReport.hasAttachment,
        projectContext: {
          project: generatedReport.project,
          module: generatedReport.module,
          round: generatedReport.round,
        },
        report: generatedReport,
        updatedAt: Date.now(),
      };

      scopedStorage.saveNewBugDraft('tester-01', fullDraft);
      const restored = scopedStorage.getNewBugDraft('tester-01');

      assert.ok(restored.report, 'Restored draft must contain the generated report');
      assert.strictEqual(restored.report.id, 'rep_abc_123');
      assert.strictEqual(restored.report.title, 'Crash when rotating cropped canvas 90 degrees');
      assert.deepStrictEqual(restored.report.steps, generatedReport.steps);
      assert.strictEqual(restored.report.actualResult, 'Application freezes and closes unexpectedly');
      assert.strictEqual(restored.report.expectedResult, 'Canvas should rotate smoothly without crashing');
      assert.strictEqual(restored.report.attachmentUrl, 'https://drive.google.com/file/d/rec-789/view');
      assert.strictEqual(restored.report.qaSuggestion, 'Inspect memory allocation during matrix rotation transform');
      assert.strictEqual(restored.report.generatedEveryTime, true);
      assert.strictEqual(restored.report.generatedInLive, false);
      assert.strictEqual(restored.report.hasAttachment, true);
    });

    test('2.2 Restored report formats correctly with reportFormat utilities without AI call', () => {
      const restoredReport = {
        id: 'rep_xyz_456',
        project: 'Photo Editor Suite',
        module: 'Stickers',
        round: '', // Empty round test
        title: 'Selected sticker does not render on high-res canvas',
        steps: [
          'Open Stickers panel',
          'Tap any neon sticker',
          'Place onto canvas',
        ],
        actualResult: 'Sticker appears transparent or blank',
        expectedResult: 'Sticker renders with full opacity and colors',
        includeResults: true,
        attachmentUrl: 'https://drive.google.com/file/d/neon-stickers/view',
        qaSuggestion: 'Check bitmap mipmap resolution',
        generatedEveryTime: true,
        generatedInLive: false,
        hasAttachment: true,
      };

      const heading = reportFormat.buildHeading(restoredReport);
      assert.strictEqual(
        heading,
        'Photo Editor Suite Stickers : Selected sticker does not render on high-res canvas'
      );

      const bodyText = reportFormat.buildBodyText(restoredReport);
      assert.ok(bodyText.includes('Follow the following steps & generate the issue.'));
      assert.ok(bodyText.includes('1. Open Stickers panel'));
      assert.ok(bodyText.includes('2. Tap any neon sticker'));
      assert.ok(bodyText.includes('3. Place onto canvas'));
      assert.ok(bodyText.includes('Actual Result'));
      assert.ok(bodyText.includes('Sticker appears transparent or blank'));
      assert.ok(bodyText.includes('Expected Result'));
      assert.ok(bodyText.includes('Sticker renders with full opacity and colors'));
      assert.ok(bodyText.includes('https://drive.google.com/file/d/neon-stickers/view'));
      assert.ok(bodyText.includes('QA Suggestion:'));
      assert.ok(bodyText.includes('Check bitmap mipmap resolution'));
      assert.ok(bodyText.includes('Is it generated every time? => Yes'));
      assert.ok(bodyText.includes('is it generated in Live version? => No'));
      assert.ok(bodyText.includes('Did you attach a Image/Video of the issue? => Yes'));
    });
  });

  describe('3. Multi-User Draft Isolation (qabr:<userId>:new-bug-draft)', () => {
    test('3.1 User B cannot access User A draft', () => {
      scopedStorage.saveNewBugDraft('user_alice', {
        rawNotes: "Alice's private QA notes for Billing module",
        report: { title: "Alice's Report" },
      });

      scopedStorage.saveNewBugDraft('user_bob', {
        rawNotes: "Bob's separate QA notes for Auth module",
        report: { title: "Bob's Report" },
      });

      const aliceDraft = scopedStorage.getNewBugDraft('user_alice');
      const bobDraft = scopedStorage.getNewBugDraft('user_bob');

      assert.strictEqual(aliceDraft.rawNotes, "Alice's private QA notes for Billing module");
      assert.strictEqual(aliceDraft.report.title, "Alice's Report");

      assert.strictEqual(bobDraft.rawNotes, "Bob's separate QA notes for Auth module");
      assert.strictEqual(bobDraft.report.title, "Bob's Report");

      // Verify exact storage key separation
      assert.ok(mockStorage['qabr:user_alice:new-bug-draft']);
      assert.ok(mockStorage['qabr:user_bob:new-bug-draft']);
    });

    test('3.2 Clearing User B draft leaves User A draft unaffected', () => {
      scopedStorage.saveNewBugDraft('user_alice', { rawNotes: "Alice Notes" });
      scopedStorage.saveNewBugDraft('user_bob', { rawNotes: "Bob Notes" });

      scopedStorage.clearNewBugDraft('user_bob');

      assert.strictEqual(scopedStorage.getNewBugDraft('user_bob'), null);
      assert.strictEqual(scopedStorage.getNewBugDraft('user_alice').rawNotes, "Alice Notes");
    });
  });

  describe('4. Corruption Recovery and Edge Cases', () => {
    test('4.1 Safely returns fallback null when storage has corrupt JSON', () => {
      mockStorage['qabr:tester-corrupt:new-bug-draft'] = '{invalid-json: missing quotes and brackets';

      let retrieved;
      assert.doesNotThrow(() => {
        retrieved = scopedStorage.getNewBugDraft('tester-corrupt');
      });
      assert.strictEqual(retrieved, null);
    });

    test('4.2 Replaces corrupt draft when saved anew', () => {
      mockStorage['qabr:tester-corrupt:new-bug-draft'] = '{invalid-json';

      scopedStorage.saveNewBugDraft('tester-corrupt', { rawNotes: 'recovered' });
      const retrieved = scopedStorage.getNewBugDraft('tester-corrupt');

      assert.ok(retrieved);
      assert.strictEqual(retrieved.rawNotes, 'recovered');
    });
  });
});
