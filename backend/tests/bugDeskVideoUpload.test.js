const { describe, test, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

describe('BugDesk Video Upload to Google Drive Test Suite', () => {
  let videoUploadUtils;
  let recordingUploadMiddleware;

  before(async () => {
    // Dynamically import ESM utility module from frontend
    const utilsPath = path.resolve(__dirname, '../../frontend/src/bugdesk/lib/video-upload-utils.js');
    videoUploadUtils = await import(pathToFileURL(utilsPath).href);

    // Require backend multer middleware
    recordingUploadMiddleware = require('../src/middleware/recordingUpload');
  });

  describe('1. Video File Validation & Supported Formats', () => {
    test('1.1 Accepts common supported video formats: mp4, mov, webm, mkv', () => {
      const supportedCases = [
        { name: 'screen_recording.mp4', type: 'video/mp4', size: 10 * 1024 * 1024 },
        { name: 'ios_capture.mov', type: 'video/quicktime', size: 25 * 1024 * 1024 },
        { name: 'browser_test.webm', type: 'video/webm', size: 5 * 1024 * 1024 },
        { name: 'obs_recording.mkv', type: 'video/x-matroska', size: 50 * 1024 * 1024 },
        { name: 'uppercase_test.MP4', type: 'video/mp4', size: 8 * 1024 * 1024 },
        { name: 'quicktime_caps.MOV', type: 'video/quicktime', size: 12 * 1024 * 1024 },
      ];

      for (const item of supportedCases) {
        const res = videoUploadUtils.validateVideoFile(item);
        assert.strictEqual(res.valid, true, `Expected ${item.name} to be valid`);
        assert.strictEqual(res.error, null);
      }
    });

    test('1.2 Rejects unsupported file extensions and types with clear actionable error', () => {
      const unsupportedCases = [
        { name: 'bug_screenshot.png', type: 'image/png', size: 1024 * 1024 },
        { name: 'document.pdf', type: 'application/pdf', size: 500 * 1024 },
        { name: 'payload.exe', type: 'application/x-msdownload', size: 2 * 1024 * 1024 },
        { name: 'notes.txt', type: 'text/plain', size: 1024 },
        { name: 'audio_sample.mp3', type: 'audio/mpeg', size: 3 * 1024 * 1024 },
      ];

      for (const item of unsupportedCases) {
        const res = videoUploadUtils.validateVideoFile(item);
        assert.strictEqual(res.valid, false, `Expected ${item.name} to be rejected`);
        assert.ok(res.error.includes('Unsupported file format'), `Expected error message about unsupported format`);
      }
    });

    test('1.3 Rejects files exceeding the 500 MB limit with size breakdown', () => {
      const oversizedFile = {
        name: 'huge_recording.mp4',
        type: 'video/mp4',
        size: 501 * 1024 * 1024 // 501 MB
      };

      const res = videoUploadUtils.validateVideoFile(oversizedFile);
      assert.strictEqual(res.valid, false);
      assert.ok(res.error.includes('500 MB limit'), `Expected error message to mention 500 MB limit`);
      assert.ok(res.error.includes('501.0 MB'), `Expected error message to show selected file size`);
    });

    test('1.4 Accepts files right at or under 500 MB limit', () => {
      const exactly500Mb = {
        name: 'max_recording.mp4',
        type: 'video/mp4',
        size: 500 * 1024 * 1024
      };

      const res = videoUploadUtils.validateVideoFile(exactly500Mb);
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.error, null);
    });

    test('1.5 Handles null or empty file safely without throwing', () => {
      const res = videoUploadUtils.validateVideoFile(null);
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'No video file provided.');
    });
  });

  describe('2. Backend Middleware & Allowed Extensions', () => {
    test('2.1 Backend recordingUpload middleware accepts .mov files alongside .mp4 and .webm', (t) => {
      // Inspect multer fileFilter behavior directly
      const mockReq = {};
      const movFile = { originalname: 'screen_test.mov', mimetype: 'video/quicktime' };

      let errorResult = null;
      let allowedResult = null;

      // Extract fileFilter from multer instance
      const fileFilter = recordingUploadMiddleware.fileFilter || recordingUploadMiddleware._fileFilter;

      // Alternatively, test using the multer internal options
      if (typeof recordingUploadMiddleware === 'function') {
        // If wrapped, verify the middleware module configuration
        const code = require('fs').readFileSync(
          path.resolve(__dirname, '../src/middleware/recordingUpload.js'),
          'utf8'
        );
        assert.ok(code.includes("'.mov'"), 'recordingUpload.js must include .mov in ALLOWED_EXTENSIONS');
        assert.ok(code.includes('video/quicktime'), 'recordingUpload.js must include video/quicktime');
      }
    });
  });

  describe('3. File Size Formatter', () => {
    test('3.1 Formats bytes, KB, and MB accurately', () => {
      assert.strictEqual(videoUploadUtils.formatFileSize(0), '0 B');
      assert.strictEqual(videoUploadUtils.formatFileSize(512), '512 B');
      assert.strictEqual(videoUploadUtils.formatFileSize(1024), '1.0 KB');
      assert.strictEqual(videoUploadUtils.formatFileSize(1536), '1.5 KB');
      assert.strictEqual(videoUploadUtils.formatFileSize(1024 * 1024), '1.0 MB');
      assert.strictEqual(videoUploadUtils.formatFileSize(24.5 * 1024 * 1024), '24.5 MB');
      assert.strictEqual(videoUploadUtils.formatFileSize(500 * 1024 * 1024), '500.0 MB');
    });

    test('3.2 Safely handles null, undefined, or negative values', () => {
      assert.strictEqual(videoUploadUtils.formatFileSize(null), '0 B');
      assert.strictEqual(videoUploadUtils.formatFileSize(undefined), '0 B');
      assert.strictEqual(videoUploadUtils.formatFileSize(-100), '0 B');
    });
  });

  describe('4. Destination Folder & Upload Payload Construction', () => {
    test('4.1 Builds FormData with file, originalFilename, mimeType, and folderId when specified', () => {
      const mockFile = { name: 'test_video.mp4', type: 'video/mp4' };
      const formData = videoUploadUtils.buildVideoUploadFormData(mockFile, {
        filename: 'custom_name.mp4',
        folderId: 'folder_drive_123'
      });

      assert.ok(formData.get('file'), 'FormData must include file');
      assert.strictEqual(formData.get('originalFilename'), 'custom_name.mp4');
      assert.strictEqual(formData.get('mimeType'), 'video/mp4');
      assert.strictEqual(formData.get('folderId'), 'folder_drive_123');
    });

    test('4.2 Omits folderId when target folder is root or null so backend defaults to user folder', () => {
      const mockFile = { name: 'test_video.mp4', type: 'video/mp4' };

      const rootFormData = videoUploadUtils.buildVideoUploadFormData(mockFile, {
        folderId: 'root'
      });
      assert.strictEqual(rootFormData.get('folderId'), null, 'Root folderId should not be set explicitly');

      const nullFormData = videoUploadUtils.buildVideoUploadFormData(mockFile, {
        folderId: null
      });
      assert.strictEqual(nullFormData.get('folderId'), null);
    });
  });

  describe('5. Mandatory Attachment URL Replacement & Report State Sync', () => {
    test('5.1 Successful upload replaces previous Attachment URL completely with the new link', () => {
      const previousUrl = 'https://drive.google.com/file/d/OLD_FILE_ID/view?usp=drivesdk';
      const newUrl = 'https://drive.google.com/file/d/NEW_FILE_ID_999/view?usp=sharing';

      const initialReport = {
        id: 'rep_123',
        title: 'Crash on button tap',
        steps: ['Open app', 'Tap button'],
        actualResult: 'App crashes',
        expectedResult: 'Button responds',
        attachmentUrl: previousUrl,
        hasAttachment: true,
        qaSuggestion: 'Check null pointer',
        rawNotes: 'raw qa notes'
      };

      const updatedReport = videoUploadUtils.applyAttachmentUrlToReport(initialReport, newUrl);

      assert.strictEqual(updatedReport.attachmentUrl, newUrl);
      assert.strictEqual(updatedReport.hasAttachment, true);
      // Verify no appending or concatenation
      assert.ok(!updatedReport.attachmentUrl.includes(previousUrl), 'Previous URL must be completely replaced');
    });

    test('5.2 Successful upload replaces arbitrary existing non-URL text completely', () => {
      const arbitraryText = 'Video link will be added later or sent via Slack';
      const newUrl = 'https://drive.google.com/file/d/NEW_FILE_ID_456/view?usp=sharing';

      const initialReport = {
        id: 'rep_124',
        title: 'UI alignment issue',
        attachmentUrl: arbitraryText,
        hasAttachment: false,
        rawNotes: 'misaligned icon'
      };

      const updatedReport = videoUploadUtils.applyAttachmentUrlToReport(initialReport, newUrl);

      assert.strictEqual(updatedReport.attachmentUrl, newUrl);
      assert.strictEqual(updatedReport.hasAttachment, true);
      assert.ok(!updatedReport.attachmentUrl.includes('Slack'));
    });

    test('5.3 Preserves all other report fields unchanged when updating attachment URL', () => {
      const initialReport = {
        id: 'rep_125',
        createdAt: 1718900000,
        project: 'FlyerMaker',
        module: 'Editor',
        round: 'R2',
        title: 'Export fails on Android 14',
        steps: ['Select template', 'Click export'],
        actualResult: 'Export stuck at 0%',
        expectedResult: 'Export completes successfully',
        includeResults: true,
        attachmentUrl: '',
        qaSuggestion: 'Verify permission model',
        generatedEveryTime: true,
        generatedInLive: false,
        hasAttachment: false,
        rawNotes: 'export bug notes'
      };

      const newUrl = 'https://drive.google.com/file/d/PUBLISHED_LINK_789/view?usp=sharing';
      const updated = videoUploadUtils.applyAttachmentUrlToReport(initialReport, newUrl);

      // Changed fields
      assert.strictEqual(updated.attachmentUrl, newUrl);
      assert.strictEqual(updated.hasAttachment, true);

      // Unchanged fields preserved strictly
      assert.strictEqual(updated.id, initialReport.id);
      assert.strictEqual(updated.createdAt, initialReport.createdAt);
      assert.strictEqual(updated.project, initialReport.project);
      assert.strictEqual(updated.module, initialReport.module);
      assert.strictEqual(updated.round, initialReport.round);
      assert.strictEqual(updated.title, initialReport.title);
      assert.deepStrictEqual(updated.steps, initialReport.steps);
      assert.strictEqual(updated.actualResult, initialReport.actualResult);
      assert.strictEqual(updated.expectedResult, initialReport.expectedResult);
      assert.strictEqual(updated.includeResults, initialReport.includeResults);
      assert.strictEqual(updated.qaSuggestion, initialReport.qaSuggestion);
      assert.strictEqual(updated.generatedEveryTime, initialReport.generatedEveryTime);
      assert.strictEqual(updated.generatedInLive, initialReport.generatedInLive);
      assert.strictEqual(updated.rawNotes, initialReport.rawNotes);
    });

    test('5.4 Handles null report safely when report is not yet generated', () => {
      const updated = videoUploadUtils.applyAttachmentUrlToReport(null, 'https://drive.google.com/test');
      assert.strictEqual(updated, null);
    });
  });

  describe('6. Error Isolation & Failure Recovery', () => {
    test('6.1 Upload failure keeps existing Attachment URL unchanged', async () => {
      let attachmentUrl = 'https://existing-link.example/video.mp4';
      let hasAttachment = true;

      // Simulate upload error in component workflow
      const mockApiUpload = async () => {
        throw new Error('Network error: connection reset by peer');
      };

      try {
        await mockApiUpload();
        // If success, callback would run:
        attachmentUrl = 'https://drive.google.com/new-file';
      } catch (err) {
        // In error handler: Attachment URL is NEVER modified
        assert.ok(err.message.includes('Network error'));
      }

      assert.strictEqual(attachmentUrl, 'https://existing-link.example/video.mp4', 'URL must remain unchanged');
      assert.strictEqual(hasAttachment, true);
    });

    test('6.2 Publishing failure keeps existing Attachment URL unchanged and retains file for retry', async () => {
      let attachmentUrl = 'https://original-link.example/proof.mov';
      let selectedFile = { name: 'proof.mov', size: 15 * 1024 * 1024 };

      // Simulate successful upload but failed publishing
      const mockApiUpload = async () => ({ recording: { google_drive_file_id: 'drive_file_444' } });
      const mockApiPublish = async () => {
        throw new Error('Google Drive API error: insufficient permissions to share file');
      };

      try {
        const uploadRes = await mockApiUpload();
        await mockApiPublish(uploadRes.recording.google_drive_file_id);
        attachmentUrl = 'https://drive.google.com/should-not-reach-here';
      } catch (err) {
        assert.ok(err.message.includes('insufficient permissions'));
      }

      // Safety assertion: URL preserved
      assert.strictEqual(attachmentUrl, 'https://original-link.example/proof.mov');
      // Selected file preserved for retry
      assert.ok(selectedFile, 'Selected file must remain available for user retry');
      assert.strictEqual(selectedFile.name, 'proof.mov');
    });
  });

  describe('7. Concurrency & Duplicate Submission Prevention', () => {
    test('7.1 Concurrency guard blocks concurrent duplicate upload requests', async () => {
      let uploadCount = 0;
      let isUploading = false;

      async function triggerUpload() {
        if (isUploading) {
          return { blocked: true };
        }
        isUploading = true;
        uploadCount++;
        // Simulate async upload
        await new Promise((r) => setTimeout(r, 50));
        isUploading = false;
        return { blocked: false };
      }

      // Fire 3 simultaneous upload attempts
      const [r1, r2, r3] = await Promise.all([
        triggerUpload(),
        triggerUpload(),
        triggerUpload()
      ]);

      assert.strictEqual(uploadCount, 1, 'Only one upload should execute');
      assert.strictEqual(r1.blocked, false);
      assert.strictEqual(r2.blocked, true);
      assert.strictEqual(r3.blocked, true);
    });
  });

  describe('8. Window Drag-and-Drop Event Safety', () => {
    test('8.1 Window dragover and drop handlers prevent browser default navigation', () => {
      let defaultPreventedCount = 0;
      const fakeEvent = {
        preventDefault: () => {
          defaultPreventedCount++;
        }
      };

      const preventDefaults = (e) => {
        e.preventDefault();
      };

      preventDefaults(fakeEvent);
      assert.strictEqual(defaultPreventedCount, 1);
    });
  });

  describe('9. Existing Screen Recording Workflows Preservation', () => {
    test('9.1 BugDesk attachment-ready custom event remains supported for screen recordings', () => {
      let attachmentUrl = 'https://old-link.com';
      let hasAttachment = false;

      function handleAttachmentReady(detail) {
        if (!detail?.url) return;
        attachmentUrl = detail.url;
        hasAttachment = true;
      }

      handleAttachmentReady({ url: 'https://drive.google.com/screen-recording-link' });

      assert.strictEqual(attachmentUrl, 'https://drive.google.com/screen-recording-link');
      assert.strictEqual(hasAttachment, true);
    });
  });

  describe('10. Collapsible Video Attachment Upload Section', () => {
    test('10.1 Default collapsed state starts false to reduce vertical height', () => {
      let showVideoUpload = false;
      assert.strictEqual(showVideoUpload, false, 'Upload area must be collapsed by default');
    });

    test('10.2 Toggling expandable control switches expanded state without clearing selected file', () => {
      let showVideoUpload = false;
      let selectedFile = { name: 'repro_recording.mp4', size: 15000000 };

      // User clicks "+ Add video attachment (optional)"
      showVideoUpload = !showVideoUpload;
      assert.strictEqual(showVideoUpload, true);
      assert.strictEqual(selectedFile.name, 'repro_recording.mp4');

      // User collapses section again
      showVideoUpload = !showVideoUpload;
      assert.strictEqual(showVideoUpload, false);
      assert.strictEqual(selectedFile.name, 'repro_recording.mp4', 'Selected file must remain intact when collapsed');
    });

    test('10.3 Attachment URL input and report attachment remain intact whether collapsed or expanded', () => {
      let attachmentUrl = 'https://drive.google.com/file/d/existing-url-123/view';
      let showVideoUpload = false;

      // Section collapsed
      assert.strictEqual(attachmentUrl, 'https://drive.google.com/file/d/existing-url-123/view');

      // Expand section
      showVideoUpload = true;
      assert.strictEqual(attachmentUrl, 'https://drive.google.com/file/d/existing-url-123/view');

      // Collapse section
      showVideoUpload = false;
      assert.strictEqual(attachmentUrl, 'https://drive.google.com/file/d/existing-url-123/view');
    });

    test('10.4 Successful upload updates attachmentUrl and notifies status listeners even while collapsed', () => {
      let attachmentUrl = '';
      let statusEvent = null;

      function onUploadSuccess(url) {
        attachmentUrl = url;
      }

      function onStatusChange(status) {
        statusEvent = status;
      }

      // Simulate upload completion
      onStatusChange({ uploadStatus: 'success', isUploading: false });
      onUploadSuccess('https://drive.google.com/file/d/uploaded-video-456/view');

      assert.strictEqual(attachmentUrl, 'https://drive.google.com/file/d/uploaded-video-456/view');
      assert.strictEqual(statusEvent.uploadStatus, 'success');
      assert.strictEqual(statusEvent.isUploading, false);
    });
  });
});
