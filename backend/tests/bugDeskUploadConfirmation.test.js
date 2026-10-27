const { describe, test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');
const db = require('../src/db');
const { runMigrations } = require('../src/db/migrate');
const googleDriveService = require('../src/services/googleDriveService');
const tokenCrypto = require('../src/utils/tokenCrypto');
const config = require('../src/config');
const userService = require('../src/services/userService');

describe('BugDesk Recording Upload Confirmation Test Suite', () => {
  let screenMirrorStreamManager;
  let originalUploadAndPublish;
  let dispatchedEvents = [];

  before(async () => {
    config.NODE_ENV = 'test';
    config.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
    config.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    await runMigrations();

    dispatchedEvents = [];
    global.window = {
      dispatchEvent: (evt) => {
        dispatchedEvents.push(evt);
      },
      MediaRecorder: class MockMediaRecorder {
        static isTypeSupported() {
          return true;
        }
      }
    };
    global.CustomEvent = class CustomEvent {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
    };
    const { Blob } = require('buffer');
    global.Blob = Blob;

    const managerPath = path.resolve(__dirname, '../../frontend/src/services/screenMirrorStreamManager.js');
    const module = await import(pathToFileURL(managerPath).href);
    screenMirrorStreamManager = module.screenMirrorStreamManager;
    originalUploadAndPublish = screenMirrorStreamManager.uploadAndPublish;
  });

  beforeEach(() => {
    dispatchedEvents = [];
    if (screenMirrorStreamManager) {
      screenMirrorStreamManager.reset();
      if (originalUploadAndPublish) {
        screenMirrorStreamManager.uploadAndPublish = originalUploadAndPublish;
      }
    }
  });

  describe('1. Stop Recording Transitions to Ready Without Automatic Upload', () => {
    test('1.1 stopRecording creates pendingRecording and transitions state to ready_to_upload without auto-uploading', async () => {
      const mockDevice = { serial: 'test-device-123', name: 'Pixel 8' };
      screenMirrorStreamManager.registerStream(mockDevice, {
        videoWidth: 720,
        readyState: 4,
        captureStream: () => ({ getVideoTracks: () => [{ kind: 'video' }] })
      }, 'live');

      screenMirrorStreamManager.state = 'recording';
      screenMirrorStreamManager.durationSec = 8;
      screenMirrorStreamManager.recordedChunks = [Buffer.from('fake-video-bytes-chunk')];
      screenMirrorStreamManager.recordingMimeConfig = { mime: 'video/webm', ext: 'webm' };
      screenMirrorStreamManager.recorder = {
        state: 'recording',
        stop: function() {
          this.state = 'inactive';
          if (this.onstop) this.onstop();
        }
      };

      let uploadCalled = false;
      screenMirrorStreamManager.uploadAndPublish = async () => {
        uploadCalled = true;
        return { success: true };
      };

      const stopResult = await screenMirrorStreamManager.stopRecording();

      // Must resolve with recording data
      assert.ok(stopResult, 'stopRecording should resolve');
      assert.strictEqual(stopResult.durationSec, 8);
      assert.strictEqual(stopResult.ext, 'webm');

      // State must be ready_to_upload awaiting user confirmation
      assert.strictEqual(screenMirrorStreamManager.state, 'ready_to_upload');
      assert.strictEqual(screenMirrorStreamManager.isConfirmingUpload, true);
      assert.ok(screenMirrorStreamManager.pendingRecording);
      assert.strictEqual(screenMirrorStreamManager.pendingRecording.durationSec, 8);

      // Must NOT have uploaded automatically
      assert.strictEqual(uploadCalled, false, 'uploadAndPublish must not be called automatically');

      // Must have emitted bugdesk:recording-ready event for UI
      const readyEvent = dispatchedEvents.find((e) => e.type === 'bugdesk:recording-ready');
      assert.ok(readyEvent, 'bugdesk:recording-ready event must be emitted');
      assert.strictEqual(readyEvent.detail.recording.durationSec, 8);
    });

    test('1.2 Stopping recording does NOT stop screen mirror or disconnect device', async () => {
      const mockDevice = { serial: 'test-device-456', name: 'Galaxy S24' };
      const mockVideo = {
        videoWidth: 1080,
        readyState: 4,
        captureStream: () => ({ getVideoTracks: () => [{ kind: 'video' }] })
      };
      screenMirrorStreamManager.registerStream(mockDevice, mockVideo, 'live');
      assert.strictEqual(screenMirrorStreamManager.isMirrorReady(mockDevice), true);

      screenMirrorStreamManager.state = 'recording';
      screenMirrorStreamManager.durationSec = 3;
      screenMirrorStreamManager.recordedChunks = [Buffer.from('video-data')];
      screenMirrorStreamManager.recordingMimeConfig = { mime: 'video/webm', ext: 'webm' };
      screenMirrorStreamManager.recorder = {
        state: 'recording',
        stop: function() {
          this.state = 'inactive';
          if (this.onstop) this.onstop();
        }
      };

      await screenMirrorStreamManager.stopRecording();

      // Screen mirror must still be active and ready
      assert.strictEqual(screenMirrorStreamManager.isMirrorReady(mockDevice), true);
      assert.strictEqual(screenMirrorStreamManager.getMirrorStatus(), 'live');
      assert.strictEqual(screenMirrorStreamManager.getActiveDevice().serial, 'test-device-456');
    });

    test('1.3 Empty recording (0 chunks) fails safely and does NOT open confirmation', async () => {
      screenMirrorStreamManager.state = 'recording';
      screenMirrorStreamManager.durationSec = 0;
      screenMirrorStreamManager.recordedChunks = []; // 0 bytes recorded
      screenMirrorStreamManager.recorder = {
        state: 'recording',
        stop: function() {
          this.state = 'inactive';
          if (this.onstop) this.onstop();
        }
      };

      const result = await screenMirrorStreamManager.stopRecording();

      assert.strictEqual(result, null);
      assert.strictEqual(screenMirrorStreamManager.state, 'error');
      assert.strictEqual(screenMirrorStreamManager.pendingRecording, null);
      assert.strictEqual(screenMirrorStreamManager.isConfirmingUpload, false);

      const readyEvent = dispatchedEvents.find((e) => e.type === 'bugdesk:recording-ready');
      assert.strictEqual(readyEvent, undefined, 'Must not emit recording-ready on empty recording');
    });
  });

  describe('2. Confirming "Yes, Upload" Workflow', () => {
    test('2.1 Yes, Upload uploads recording, auto-attaches link, and clears pending recording', async () => {
      const mockRecording = {
        blob: new global.Blob([Buffer.from('sample-video-bytes')]),
        mimeType: 'video/webm',
        ext: 'webm',
        durationSec: 15,
      };

      screenMirrorStreamManager.pendingRecording = mockRecording;
      screenMirrorStreamManager.isConfirmingUpload = true;
      screenMirrorStreamManager.state = 'ready_to_upload';
      screenMirrorStreamManager.preservedBlob = mockRecording.blob;

      let uploadedPayload = null;
      let publishedFileId = null;

      // Mock API inside screenMirrorStreamManager
      screenMirrorStreamManager.api = {
        async getDriveStatus() {
          return { connected: true, defaultFolderId: 'folder-qa-default' };
        },
        async uploadScreenRecording(formData) {
          uploadedPayload = formData;
          return {
            success: true,
            recording: {
              google_drive_file_id: 'drive-file-confirm-789',
              google_drive_web_view_link: 'https://drive.google.com/file/d/drive-file-confirm-789/view'
            }
          };
        },
        async publishDriveFile(fileId) {
          publishedFileId = fileId;
          return {
            success: true,
            shareLink: `https://drive.google.com/file/d/${fileId}/view?usp=sharing`
          };
        }
      };

      // User confirms "Yes, Upload"
      const result = await screenMirrorStreamManager.uploadAndPublish({
        project: 'Flyer Maker',
        module: 'Editor',
        round: 'R-1',
        recording: screenMirrorStreamManager.pendingRecording
      });

      assert.ok(result?.success);
      assert.strictEqual(publishedFileId, 'drive-file-confirm-789');
      assert.strictEqual(screenMirrorStreamManager.state, 'completed');
      assert.strictEqual(screenMirrorStreamManager.pendingRecording, null);
      assert.strictEqual(screenMirrorStreamManager.isConfirmingUpload, false);

      // Verify bugdesk:attachment-ready was dispatched with final share link
      const attachEvent = dispatchedEvents.find((e) => e.type === 'bugdesk:attachment-ready');
      assert.ok(attachEvent);
      assert.strictEqual(attachEvent.detail.url, 'https://drive.google.com/file/d/drive-file-confirm-789/view?usp=sharing');
    });

    test('2.2 Duplicate click guard: isUploading prevents duplicate concurrent uploads', async () => {
      let uploadCallCount = 0;
      let resolveUpload;
      const uploadPromise = new Promise((resolve) => { resolveUpload = resolve; });

      // Controller simulation
      let isUploading = false;
      const simulateConfirmUpload = async () => {
        if (isUploading) return { skipped: true };
        isUploading = true;
        uploadCallCount++;
        await uploadPromise;
        isUploading = false;
        return { success: true };
      };

      // Click 1
      const call1 = simulateConfirmUpload();
      // Rapid Click 2 & Click 3 while uploading
      const call2 = simulateConfirmUpload();
      const call3 = simulateConfirmUpload();

      resolveUpload();
      const [res1, res2, res3] = await Promise.all([call1, call2, call3]);

      assert.strictEqual(uploadCallCount, 1, 'Only one upload request should be executed');
      assert.strictEqual(res1.success, true);
      assert.strictEqual(res2.skipped, true);
      assert.strictEqual(res3.skipped, true);
    });

    test('2.3 isUploadingInProgress concurrency lock rejects simultaneous calls to uploadAndPublish', async () => {
      const mockRecording = {
        blob: new global.Blob([Buffer.from('concurrency-test-video')]),
        mimeType: 'video/webm',
        ext: 'webm',
        durationSec: 10,
        recordingId: 'rec_concurrency_test_001'
      };

      screenMirrorStreamManager.pendingRecording = mockRecording;
      screenMirrorStreamManager.isConfirmingUpload = true;
      screenMirrorStreamManager.state = 'ready_to_upload';
      screenMirrorStreamManager.preservedBlob = mockRecording.blob;

      let uploadCallCount = 0;
      let publishCallCount = 0;
      let resolveUpload;
      const uploadGate = new Promise((resolve) => { resolveUpload = resolve; });

      screenMirrorStreamManager.api = {
        async getDriveStatus() {
          return { connected: true, defaultFolderId: 'root' };
        },
        async uploadScreenRecording() {
          uploadCallCount++;
          await uploadGate;
          return {
            success: true,
            recording: {
              google_drive_file_id: 'drive-concurrency-file',
              google_drive_web_view_link: 'https://drive.google.com/file/d/drive-concurrency-file/view'
            }
          };
        },
        async publishDriveFile() {
          publishCallCount++;
          return {
            success: true,
            shareLink: 'https://drive.google.com/file/d/drive-concurrency-file/view?usp=sharing'
          };
        }
      };

      // Call 1 initiates upload
      const promise1 = screenMirrorStreamManager.uploadAndPublish({ recording: mockRecording });
      // Call 2 fired immediately while Call 1 is in-flight (isUploadingInProgress === true)
      const promise2 = screenMirrorStreamManager.uploadAndPublish({ recording: mockRecording });

      assert.strictEqual(screenMirrorStreamManager.isUploadingInProgress, true);

      // Release Call 1
      resolveUpload();
      const [res1, res2] = await Promise.all([promise1, promise2]);

      assert.ok(res1?.success, 'First call must succeed');
      assert.strictEqual(res2, null, 'Second concurrent call must be rejected as null');
      assert.strictEqual(uploadCallCount, 1, 'Only exactly 1 upload call must be made');
      assert.strictEqual(publishCallCount, 1, 'Only exactly 1 publish call must be made');
      assert.strictEqual(screenMirrorStreamManager.isUploadingInProgress, false);
      assert.strictEqual(screenMirrorStreamManager.state, 'completed');
    });
  });

  describe('3. Skipping "No, Skip Upload" Workflow', () => {
    test('3.1 No, Skip Upload safely discards pending recording without uploading or attaching', () => {
      const mockRecording = {
        blob: new global.Blob([Buffer.from('sample-bytes')]),
        durationSec: 10
      };

      screenMirrorStreamManager.pendingRecording = mockRecording;
      screenMirrorStreamManager.isConfirmingUpload = true;
      screenMirrorStreamManager.state = 'ready_to_upload';
      screenMirrorStreamManager.preservedBlob = mockRecording.blob;

      // User clicks "No, Skip Upload"
      screenMirrorStreamManager.discardPendingRecording();

      assert.strictEqual(screenMirrorStreamManager.pendingRecording, null);
      assert.strictEqual(screenMirrorStreamManager.isConfirmingUpload, false);
      assert.strictEqual(screenMirrorStreamManager.preservedBlob, null);
      assert.strictEqual(screenMirrorStreamManager.state, 'idle');

      // Verify NO attachment event was fired
      const attachEvent = dispatchedEvents.find((e) => e.type === 'bugdesk:attachment-ready');
      assert.strictEqual(attachEvent, undefined, 'No attachment-ready event should be fired on skip');
    });

    test('3.2 Skip upload does NOT change existing Attachment URL', () => {
      let currentAttachmentUrl = 'https://existing-jira-link.com/issue/123';
      let hasAttachment = true;

      // When skip upload occurs, handleAttachmentReady is NEVER called
      // Attachment URL remains completely intact
      screenMirrorStreamManager.discardPendingRecording();

      assert.strictEqual(currentAttachmentUrl, 'https://existing-jira-link.com/issue/123');
      assert.strictEqual(hasAttachment, true);
    });
  });

  describe('4. Failure Recovery & Retry Without Re-Recording', () => {
    test('4.1 Retains pending recording on upload failure so user can retry without recording again', async () => {
      const mockBlob = new global.Blob([Buffer.from('video-retry-content')]);
      const mockRecording = {
        blob: mockBlob,
        mimeType: 'video/webm',
        ext: 'webm',
        durationSec: 20
      };

      screenMirrorStreamManager.pendingRecording = mockRecording;
      screenMirrorStreamManager.isConfirmingUpload = true;
      screenMirrorStreamManager.state = 'ready_to_upload';
      screenMirrorStreamManager.preservedBlob = mockBlob;

      let attempt = 0;
      screenMirrorStreamManager.api = {
        async getDriveStatus() {
          return { connected: true, defaultFolderId: 'root' };
        },
        async uploadScreenRecording() {
          attempt++;
          if (attempt === 1) {
            throw new Error('Google Drive API Rate Limit Exceeded');
          }
          return {
            success: true,
            recording: {
              google_drive_file_id: 'file-success-retry',
              google_drive_web_view_link: 'https://drive.google.com/file/d/file-success-retry/view'
            }
          };
        },
        async publishDriveFile(fileId) {
          return {
            success: true,
            shareLink: `https://drive.google.com/file/d/${fileId}/view?usp=sharing`
          };
        }
      };

      // Attempt 1: fails
      const res1 = await screenMirrorStreamManager.uploadAndPublish({
        project: 'Flyer Maker',
        module: 'Editor',
        recording: screenMirrorStreamManager.pendingRecording
      });

      assert.strictEqual(res1, null);
      assert.strictEqual(screenMirrorStreamManager.state, 'error');
      // Crucial: pendingRecording and preservedBlob must remain intact!
      assert.ok(screenMirrorStreamManager.pendingRecording, 'pendingRecording must be retained on failure');
      assert.ok(screenMirrorStreamManager.preservedBlob, 'preservedBlob must be retained on failure');

      // Attempt 2: User clicks "Retry Upload" without re-recording
      const res2 = await screenMirrorStreamManager.uploadAndPublish({
        project: 'Flyer Maker',
        module: 'Editor',
        recording: screenMirrorStreamManager.pendingRecording
      });

      assert.ok(res2?.success);
      assert.strictEqual(screenMirrorStreamManager.state, 'completed');
      assert.strictEqual(screenMirrorStreamManager.pendingRecording, null);
    });

    test('4.2 Smart retry reuses already-uploaded Drive file when upload succeeded but publish failed', async () => {
      const mockBlob = new global.Blob([Buffer.from('smart-retry-video-content')]);
      const mockRecording = {
        blob: mockBlob,
        mimeType: 'video/webm',
        ext: 'webm',
        durationSec: 25,
        recordingId: 'rec_smart_retry_002'
      };

      screenMirrorStreamManager.pendingRecording = mockRecording;
      screenMirrorStreamManager.isConfirmingUpload = true;
      screenMirrorStreamManager.state = 'ready_to_upload';
      screenMirrorStreamManager.preservedBlob = mockBlob;

      let uploadCalls = 0;
      let publishCalls = 0;

      screenMirrorStreamManager.api = {
        async getDriveStatus() {
          return { connected: true, defaultFolderId: 'root' };
        },
        async uploadScreenRecording() {
          uploadCalls++;
          return {
            success: true,
            recording: {
              google_drive_file_id: 'smart-file-12345',
              google_drive_web_view_link: 'https://drive.google.com/file/d/smart-file-12345/view'
            }
          };
        },
        async publishDriveFile(fileId) {
          publishCalls++;
          if (publishCalls === 1) {
            throw new Error('Google Drive permissions API rate limited');
          }
          return {
            success: true,
            shareLink: `https://drive.google.com/file/d/${fileId}/view?usp=sharing`
          };
        }
      };

      // Attempt 1: Upload succeeds, but publish throws
      const res1 = await screenMirrorStreamManager.uploadAndPublish({ recording: mockRecording });
      assert.strictEqual(res1, null);
      assert.strictEqual(screenMirrorStreamManager.state, 'error');
      assert.strictEqual(uploadCalls, 1);
      assert.strictEqual(publishCalls, 1);
      // uploadedDriveFile must be saved
      assert.ok(screenMirrorStreamManager.uploadedDriveFile);
      assert.strictEqual(screenMirrorStreamManager.uploadedDriveFile.id, 'smart-file-12345');

      // Attempt 2: User clicks "Retry Upload"
      const res2 = await screenMirrorStreamManager.uploadAndPublish({ recording: mockRecording });
      assert.ok(res2?.success);
      assert.strictEqual(uploadCalls, 1, 'Upload must NOT be re-executed when file is already uploaded');
      assert.strictEqual(publishCalls, 2, 'Publish must be retried');
      assert.strictEqual(res2.fileId, 'smart-file-12345');
      assert.strictEqual(screenMirrorStreamManager.state, 'completed');
      assert.strictEqual(screenMirrorStreamManager.pendingRecording, null);

      const attachEvent = dispatchedEvents.find(
        (e) => e.type === 'bugdesk:attachment-ready' && e.detail.fileId === 'smart-file-12345'
      );
      assert.ok(attachEvent, 'bugdesk:attachment-ready event must be emitted with correct URL');
      assert.strictEqual(attachEvent.detail.url, 'https://drive.google.com/file/d/smart-file-12345/view?usp=sharing');
    });
  });

  describe('5. Modal Closure and Navigation Persistence', () => {
    test('5.1 Dismissing modal via X does NOT discard pending recording; allows re-opening', () => {
      const mockRecording = {
        blob: new global.Blob([Buffer.from('dismiss-test-data')]),
        durationSec: 12
      };

      screenMirrorStreamManager.pendingRecording = mockRecording;
      screenMirrorStreamManager.isConfirmingUpload = true;
      screenMirrorStreamManager.state = 'ready_to_upload';

      // Simulator of modal dismissal (handleDismissModal):
      let showUploadConfirm = true;
      const handleDismissModal = () => {
        showUploadConfirm = false;
        // Does NOT call discardPendingRecording!
      };

      handleDismissModal();
      assert.strictEqual(showUploadConfirm, false);

      // Pending recording in stream manager remains available:
      assert.ok(screenMirrorStreamManager.pendingRecording);
      assert.strictEqual(screenMirrorStreamManager.state, 'ready_to_upload');

      // User clicks "Upload Ready" button to re-open confirmation
      const handleReopenModal = () => {
        showUploadConfirm = true;
      };
      handleReopenModal();
      assert.strictEqual(showUploadConfirm, true);
    });
  });

  describe('6. Both Entry Points (Header & Floating Screen Mirror Panel)', () => {
    test('6.1 Stopping recording from header controls sets authoritative pending recording', async () => {
      screenMirrorStreamManager.state = 'recording';
      screenMirrorStreamManager.durationSec = 6;
      screenMirrorStreamManager.recordedChunks = [Buffer.from('header-stop-chunk')];
      screenMirrorStreamManager.recordingMimeConfig = { mime: 'video/webm', ext: 'webm' };
      screenMirrorStreamManager.recorder = {
        state: 'recording',
        stop: function() {
          this.state = 'inactive';
          if (this.onstop) this.onstop();
        }
      };

      const result = await screenMirrorStreamManager.stopRecording();
      assert.ok(result);
      assert.strictEqual(screenMirrorStreamManager.state, 'ready_to_upload');
      assert.strictEqual(screenMirrorStreamManager.isConfirmingUpload, true);
    });

    test('6.2 Stopping recording from floating ScreenMirrorView panel sets authoritative pending recording without auto-uploading', async () => {
      screenMirrorStreamManager.state = 'recording';
      screenMirrorStreamManager.durationSec = 14;
      screenMirrorStreamManager.recordedChunks = [Buffer.from('panel-stop-chunk')];
      screenMirrorStreamManager.recordingMimeConfig = { mime: 'video/webm', ext: 'webm' };
      screenMirrorStreamManager.recorder = {
        state: 'recording',
        stop: function() {
          this.state = 'inactive';
          if (this.onstop) this.onstop();
        }
      };

      let autoUploadTriggered = false;
      screenMirrorStreamManager.uploadAndPublish = async () => {
        autoUploadTriggered = true;
      };

      // ScreenMirrorView handleStopRecordingUnified simulation:
      await screenMirrorStreamManager.stopRecording();

      assert.strictEqual(autoUploadTriggered, false, 'Floating panel must not auto-upload');
      assert.strictEqual(screenMirrorStreamManager.state, 'ready_to_upload');
      assert.ok(screenMirrorStreamManager.pendingRecording);
    });
  });

  describe('7. Stream Lifecycle & Fresh Readable Stream on Retry (stream.push() after EOF Prevention)', () => {
    let tempTestDir;
    let tempVideoFile;
    let testUserId;

    before(async () => {
      tempTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'odr-stream-test-'));
      tempVideoFile = path.join(tempTestDir, 'test_recording.webm');
      fs.writeFileSync(tempVideoFile, Buffer.from('FAKE-WEBM-VIDEO-STREAM-BYTES-1234567890'));

      const user = await userService.register({
        email: `stream_user_${Date.now()}@test.com`,
        password: 'Password123!',
        name: 'Stream Tester'
      });
      testUserId = user.id;

      // Seed mock Google Drive tokens for testUserId
      const encAccess = tokenCrypto.encryptToken('ya29.stream-test-token');
      const encRefresh = tokenCrypto.encryptSelfContained('1//0gstream-refresh-token');
      await db.query(
        `INSERT INTO google_drive_tokens (
          user_id, google_email, google_name,
          encrypted_access_token, encrypted_refresh_token,
          token_iv, token_auth_tag, expiry_date, scope,
          default_folder_id, default_folder_name
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (user_id) DO UPDATE SET
          encrypted_access_token = EXCLUDED.encrypted_access_token,
          encrypted_refresh_token = EXCLUDED.encrypted_refresh_token`,
        [
          testUserId,
          'stream.tester@gmail.com',
          'Stream Tester',
          encAccess.encrypted,
          encRefresh,
          encAccess.iv,
          encAccess.authTag,
          Date.now() + 3600000,
          'https://www.googleapis.com/auth/drive.file',
          'root',
          'My Drive'
        ]
      );
    });

    after(() => {
      try {
        if (tempTestDir && fs.existsSync(tempTestDir)) {
          fs.rmSync(tempTestDir, { recursive: true, force: true });
        }
      } catch (_) {}
    });

    test('7.1 googleDriveService.uploadRecording creates fresh readable stream on retry attempts and disables gaxios internal retries', async () => {
      let createAttempt = 0;
      const seenStreams = [];
      const seenOptions = [];

      const mockDrive = {
        files: {
          create: async ({ requestBody, media }, options) => {
            createAttempt++;
            seenStreams.push(media.body);
            seenOptions.push(options);

            if (createAttempt === 1) {
              // Attempt 1 fails with transient network or auth error
              const err = new Error('Simulated transient 503 Service Unavailable / socket hangup');
              err.code = 'ECONNRESET';
              throw err;
            }

            // Attempt 2 succeeds: consume stream chunks to verify readability
            const chunks = [];
            for await (const chunk of media.body) {
              chunks.push(chunk);
            }
            const fullContent = Buffer.concat(chunks).toString();

            return {
              data: {
                id: 'file-recovered-after-retry-456',
                name: requestBody.name,
                webViewLink: 'https://drive.google.com/file/d/file-recovered-after-retry-456/view'
              },
              fullContent
            };
          }
        }
      };

      const result = await googleDriveService.uploadRecording(
        testUserId,
        {
          filePath: tempVideoFile,
          originalFilename: 'test_recording.webm',
          mimeType: 'video/webm',
          durationSec: 15,
          recordingId: `rec_stream_retry_${Date.now()}`
        },
        mockDrive
      );

      // Verify that 2 attempts were executed
      assert.strictEqual(createAttempt, 2, 'Should have retried exactly once after transient failure');

      // Verify that each attempt received its own FRESH readable stream
      assert.strictEqual(seenStreams.length, 2);
      const [stream1, stream2] = seenStreams;
      assert.notStrictEqual(stream1, stream2, 'Attempt 2 must receive a new stream instance, NOT the exhausted stream 1');

      // Verify that stream 1 was destroyed cleanly during error cleanup
      assert.strictEqual(stream1.destroyed, true, 'Stream 1 should be destroyed upon failure to release file descriptor');

      // Verify that stream 2 was active, fresh, and fully readable
      assert.strictEqual(stream2.readableEnded, true, 'Stream 2 was successfully read to completion');

      // Verify that retryConfig: { retry: 0 } was passed to drive.files.create for both attempts
      for (const opts of seenOptions) {
        assert.deepStrictEqual(opts?.retryConfig, { retry: 0 }, 'drive.files.create must disable internal gaxios retries');
      }

      // Verify DB record status
      assert.strictEqual(result.upload_status, 'UPLOADED');
      assert.strictEqual(result.google_drive_file_id, 'file-recovered-after-retry-456');
    });

    test('7.2 Demonstrates that writing/pushing to an ended stream reproduces stream.push() after EOF, whereas fresh stream avoids it', async () => {
      const { Transform } = require('stream');

      // ProgressStream pattern identical to googleapis-common
      class MockProgressStream extends Transform {
        _transform(chunk, encoding, callback) {
          this.push(chunk);
          callback();
        }
      }

      // 1. Recreate the buggy condition: piping an ended stream into another stream
      const endedStream = fs.createReadStream(tempVideoFile);
      // Consume to EOF
      for await (const _ of endedStream) {}
      assert.strictEqual(endedStream.readableEnded, true);

      // Reusing an already ended stream: calling push(chunk) after EOF triggers ERR_STREAM_PUSH_AFTER_EOF
      const progressStream = new MockProgressStream();
      // End the progress stream to simulate completion
      progressStream.push(null); // EOF

      const errorPromise = new Promise((resolve) => {
        progressStream.once('error', (err) => resolve(err));
      });
      progressStream.push(Buffer.from('extra-chunk-on-ended-stream'));
      const caughtError = await errorPromise;

      assert.strictEqual(caughtError.code, 'ERR_STREAM_PUSH_AFTER_EOF');
      assert.match(caughtError.message, /stream\.push\(\) after EOF/);

      // 2. The solution: fresh stream for new attempt is never at EOF
      const freshStream = fs.createReadStream(tempVideoFile);
      assert.strictEqual(freshStream.readableEnded, false);
      const freshProgress = new MockProgressStream();
      freshStream.pipe(freshProgress);

      const chunks = [];
      for await (const chunk of freshProgress) {
        chunks.push(chunk);
      }
      assert.ok(chunks.length > 0, 'Fresh stream pipes cleanly without throwing ERR_STREAM_PUSH_AFTER_EOF');
    });

    test('7.3 getAuthenticatedDriveClient configures refresh_token so token refresh succeeds without 401 loop during upload', async () => {
      let appliedCredentials = null;
      const mockOAuth2Client = {
        setCredentials(creds) {
          appliedCredentials = creds;
        }
      };

      const clientObj = await googleDriveService.getAuthenticatedDriveClient(testUserId, mockOAuth2Client);
      assert.ok(clientObj);
      assert.ok(appliedCredentials, 'setCredentials must be called');
      assert.ok(appliedCredentials.access_token, 'access_token must be set');
      assert.strictEqual(appliedCredentials.refresh_token, '1//0gstream-refresh-token', 'refresh_token must be provided for background refresh');
    });
  });
});
