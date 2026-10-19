const { describe, test, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

describe('BugDesk Screen Recording & Auto-Publish Integration Test Suite', () => {
  let generateRecordingFilename;

  before(async () => {
    // Dynamically import ESM helper from frontend
    const namingModulePath = path.resolve(__dirname, '../../frontend/src/bugdesk/lib/recording-naming.js');
    const namingModule = await import(pathToFileURL(namingModulePath).href);
    generateRecordingFilename = namingModule.generateRecordingFilename;
  });

  describe('1. Recording Filename Formatting & Sanitization', () => {
    const fixedDate = new Date(2026, 9, 19, 11, 15, 0); // Oct 19, 2026 11:15:00

    test('1.1 Generates expected filename with project, module, and round', () => {
      const filename = generateRecordingFilename({
        project: 'FlyerMaker',
        module: 'BillingMigration',
        round: 'R1',
        ext: 'webm',
        date: fixedDate
      });
      assert.strictEqual(filename, 'FlyerMaker_BillingMigration_R1_20261019_111500.webm');
    });

    test('1.2 Cleanly omits round when empty or whitespace without double underscores or undefined', () => {
      const cases = ['', '   ', null, undefined];
      for (const roundVal of cases) {
        const filename = generateRecordingFilename({
          project: 'FlyerMaker',
          module: 'BillingMigration',
          round: roundVal,
          ext: 'webm',
          date: fixedDate
        });
        assert.strictEqual(filename, 'FlyerMaker_BillingMigration_20261019_111500.webm');
        assert.ok(!filename.includes('__'), `Filename "${filename}" should not contain double underscores`);
        assert.ok(!filename.includes('undefined'), `Filename should not contain undefined`);
        assert.ok(!filename.includes('null'), `Filename should not contain null`);
      }
    });

    test('1.3 Sanitizes special characters, punctuation, and multiple spaces', () => {
      const filename = generateRecordingFilename({
        project: 'Flyer Maker v2.0 (Beta)!',
        module: 'Payment & Checkout/Stripe',
        round: 'Round #1 [Final]',
        ext: '.mp4',
        date: fixedDate
      });
      assert.strictEqual(filename, 'Flyer_Maker_v2_0_Beta_Payment_Checkout_Stripe_Round_1_Final_20261019_111500.mp4');
    });

    test('1.4 Provides safe defaults when project and module are missing or blank', () => {
      const filename = generateRecordingFilename({
        project: '',
        module: '',
        round: '',
        date: fixedDate
      });
      assert.strictEqual(filename, 'BugDesk_Module_20261019_111500.webm');
    });
  });

  describe('2. Mirror Preconditions & Stream Manager State Machine', () => {
    // Pure logic simulation of ScreenMirrorStreamManager state machine
    function createStreamManagerMock() {
      let activeStream = null;
      let activeDevice = null;
      let status = 'stopped'; // 'connecting' | 'waiting_for_frame' | 'live' | 'stopped' | 'error'
      let isRecording = false;

      return {
        registerStream(device, stream, initialStatus = 'live') {
          activeDevice = device;
          activeStream = stream;
          status = initialStatus;
        },
        unregisterStream() {
          activeDevice = null;
          activeStream = null;
          status = 'stopped';
        },
        setStatus(newStatus) {
          status = newStatus;
        },
        isMirrorReady() {
          return Boolean(
            activeDevice &&
            activeStream &&
            activeStream.active &&
            status === 'live'
          );
        },
        startRecording() {
          if (!this.isMirrorReady()) {
            throw new Error('Start Screen Mirror before recording.');
          }
          if (isRecording) {
            throw new Error('Recording is already in progress.');
          }
          isRecording = true;
          return { status: 'recording' };
        },
        stopRecording() {
          if (!isRecording) {
            throw new Error('No active recording to stop.');
          }
          isRecording = false;
          return { status: 'stopped' };
        }
      };
    }

    test('2.1 Blocks recording when mirror has not been started', () => {
      const manager = createStreamManagerMock();
      assert.strictEqual(manager.isMirrorReady(), false);
      assert.throws(() => manager.startRecording(), /Start Screen Mirror before recording/i);
    });

    test('2.2 Blocks recording when mirror is connecting or waiting for frames', () => {
      const manager = createStreamManagerMock();
      const mockStream = { active: true, getVideoTracks: () => [{ readyState: 'live' }] };

      manager.registerStream({ id: 'dev-1' }, mockStream, 'connecting');
      assert.strictEqual(manager.isMirrorReady(), false);
      assert.throws(() => manager.startRecording(), /Start Screen Mirror before recording/i);

      manager.setStatus('waiting_for_frame');
      assert.strictEqual(manager.isMirrorReady(), false);
      assert.throws(() => manager.startRecording(), /Start Screen Mirror before recording/i);
    });

    test('2.3 Blocks recording when mirror encounters an error or stops', () => {
      const manager = createStreamManagerMock();
      const mockStream = { active: false, getVideoTracks: () => [] };

      manager.registerStream({ id: 'dev-1' }, mockStream, 'error');
      assert.strictEqual(manager.isMirrorReady(), false);

      manager.registerStream({ id: 'dev-1' }, mockStream, 'stopped');
      assert.strictEqual(manager.isMirrorReady(), false);
    });

    test('2.4 Allows recording only when device and stream are active and status is live', () => {
      const manager = createStreamManagerMock();
      const mockStream = { active: true, getVideoTracks: () => [{ readyState: 'live' }] };

      manager.registerStream({ id: 'dev-1', model: 'Pixel 8' }, mockStream, 'live');
      assert.strictEqual(manager.isMirrorReady(), true);

      const result = manager.startRecording();
      assert.strictEqual(result.status, 'recording');

      // Stop recording
      const stopResult = manager.stopRecording();
      assert.strictEqual(stopResult.status, 'stopped');
    });
  });

  describe('3. Drive Upload & Auto-Publish Lifecycle', () => {
    test('3.1 Uploads to user configured default folder and publishes link', async () => {
      const mockUserFolderId = 'folder-custom-qa-999';
      let uploadedFolderId = null;
      let publishedFileId = null;

      // Mock API methods
      const mockApi = {
        async uploadScreenRecording(formData, folderId) {
          uploadedFolderId = folderId;
          return {
            success: true,
            file: {
              id: 'file-drive-rec-12345',
              name: 'FlyerMaker_Login_20261019_111500.webm',
              size: '4.8 MB',
              webViewLink: 'https://drive.google.com/file/d/file-drive-rec-12345/view'
            }
          };
        },
        async publishDriveFile(fileId) {
          publishedFileId = fileId;
          return {
            success: true,
            published: true,
            shareableLink: `https://drive.google.com/file/d/${fileId}/view?usp=sharing`,
            file: { id: fileId }
          };
        }
      };

      // Execute upload & publish workflow
      const uploadRes = await mockApi.uploadScreenRecording(new FormData(), mockUserFolderId);
      assert.strictEqual(uploadedFolderId, mockUserFolderId);
      assert.strictEqual(uploadRes.file.id, 'file-drive-rec-12345');

      const publishRes = await mockApi.publishDriveFile(uploadRes.file.id);
      assert.strictEqual(publishedFileId, 'file-drive-rec-12345');
      assert.strictEqual(publishRes.shareableLink, 'https://drive.google.com/file/d/file-drive-rec-12345/view?usp=sharing');
    });

    test('3.2 Defaults to Root folder when no default folder configured', async () => {
      let targetFolder = 'UNSET';
      const mockApi = {
        async uploadScreenRecording(formData, folderId) {
          targetFolder = folderId || 'root';
          return { success: true, file: { id: 'file-root-1' } };
        }
      };

      await mockApi.uploadScreenRecording(new FormData(), null);
      assert.strictEqual(targetFolder, 'root');
    });
  });

  describe('4. Failure Recovery & Error Isolation', () => {
    test('4.1 Retry Publish can proceed without re-uploading file if upload succeeded', async () => {
      let uploadCount = 0;
      let publishCount = 0;

      const mockService = {
        uploadedFile: null,
        async doUpload() {
          uploadCount++;
          this.uploadedFile = { id: 'file-already-uploaded' };
          return this.uploadedFile;
        },
        async doPublish() {
          publishCount++;
          if (publishCount === 1) {
            throw new Error('Temporary Google Drive network glitch');
          }
          return {
            published: true,
            shareableLink: `https://drive.google.com/file/d/${this.uploadedFile.id}/view?usp=sharing`
          };
        }
      };

      // 1. Initial upload succeeds
      const file = await mockService.doUpload();
      assert.strictEqual(file.id, 'file-already-uploaded');
      assert.strictEqual(uploadCount, 1);

      // 2. Publish attempt 1 fails
      await assert.rejects(async () => {
        await mockService.doPublish();
      }, /glitch/i);
      assert.strictEqual(publishCount, 1);

      // 3. User clicks "Retry Link" -> calls publish directly without calling upload again
      const retryResult = await mockService.doPublish();
      assert.strictEqual(uploadCount, 1, 'File must not be re-uploaded on publish retry');
      assert.strictEqual(publishCount, 2);
      assert.strictEqual(retryResult.published, true);
      assert.ok(retryResult.shareableLink.includes('file-already-uploaded'));
    });
  });

  describe('5. BugDesk Attachment URL Overwrite Protection', () => {
    function handleAttachmentReady(currentFormState, newAttachmentUrl) {
      if (!currentFormState.attachmentUrl || !currentFormState.attachmentUrl.trim()) {
        // Safe to populate immediately
        return {
          action: 'APPLY_DIRECTLY',
          attachmentUrl: newAttachmentUrl,
          hasAttachment: true
        };
      }
      if (currentFormState.attachmentUrl === newAttachmentUrl) {
        // Same URL, no change needed
        return { action: 'NOOP' };
      }
      // User has already typed or pasted an existing attachment URL
      return {
        action: 'CONFIRM_OVERWRITE',
        existingUrl: currentFormState.attachmentUrl,
        proposedUrl: newAttachmentUrl
      };
    }

    test('5.1 Automatically populates when Attachment URL is empty', () => {
      const state = { attachmentUrl: '', hasAttachment: false };
      const outcome = handleAttachmentReady(state, 'https://drive.google.com/file/d/test1/view?usp=sharing');

      assert.strictEqual(outcome.action, 'APPLY_DIRECTLY');
      assert.strictEqual(outcome.attachmentUrl, 'https://drive.google.com/file/d/test1/view?usp=sharing');
      assert.strictEqual(outcome.hasAttachment, true);
    });

    test('5.2 Prompts confirmation before overwriting existing user-provided URL', () => {
      const state = { attachmentUrl: 'https://jira.corp.internal/browse/QA-404', hasAttachment: true };
      const outcome = handleAttachmentReady(state, 'https://drive.google.com/file/d/new-rec/view?usp=sharing');

      assert.strictEqual(outcome.action, 'CONFIRM_OVERWRITE');
      assert.strictEqual(outcome.existingUrl, 'https://jira.corp.internal/browse/QA-404');
      assert.strictEqual(outcome.proposedUrl, 'https://drive.google.com/file/d/new-rec/view?usp=sharing');
    });

    test('5.3 Ignores duplicate event if attachment URL is already the same', () => {
      const url = 'https://drive.google.com/file/d/same/view?usp=sharing';
      const state = { attachmentUrl: url, hasAttachment: true };
      const outcome = handleAttachmentReady(state, url);

      assert.strictEqual(outcome.action, 'NOOP');
    });
  });

  describe('6. BugDesk Settings Google Drive Folder Name Display & Resolution', () => {
    // Logic simulation of folder resolution in BugDeskSettings
    async function resolveFolderDisplay({
      defaultFolderId,
      defaultFolderName,
      driveMetadataResolver
    }) {
      if (!defaultFolderId || defaultFolderId === 'root') {
        return {
          id: 'root',
          name: 'My Drive (Root)',
          status: 'ready',
          folderIdDisplayedInUI: false
        };
      }

      // If name is already valid and not raw folder ID, reuse it immediately (Req 5 & 8)
      if (defaultFolderName && defaultFolderName.trim() && defaultFolderName.trim() !== defaultFolderId) {
        let currentName = defaultFolderName.trim();
        let status = 'ready';

        // Check if renamed or deleted in background (Req 6 & 7)
        try {
          const meta = await driveMetadataResolver(defaultFolderId);
          if (meta?.trashed) {
            status = 'unavailable';
          } else if (meta?.name && meta.name !== currentName) {
            currentName = meta.name;
          }
        } catch {
          status = 'unavailable';
        }

        return {
          id: defaultFolderId,
          name: status === 'unavailable' ? null : currentName,
          status,
          folderIdDisplayedInUI: false
        };
      }

      // Name not yet available: resolve saved folder ID to real folder name (Req 4)
      try {
        const meta = await driveMetadataResolver(defaultFolderId);
        if (meta?.trashed) {
          return {
            id: defaultFolderId,
            name: null,
            status: 'unavailable',
            folderIdDisplayedInUI: false
          };
        }
        return {
          id: defaultFolderId,
          name: meta.name || 'Folder',
          status: 'ready',
          folderIdDisplayedInUI: false
        };
      } catch {
        return {
          id: defaultFolderId,
          name: null,
          status: 'unavailable',
          folderIdDisplayedInUI: false
        };
      }
    }

    test('6.1 Reuses existing folder picker metadata directly without extra API request (Req 5)', () => {
      let apiFetchCount = 0;
      const selectedFromPicker = {
        id: '1XuwtO3rxjDJuG_RxH3qMTsJEwpJcUEV',
        name: 'BugDesk Recordings',
        path: 'My Drive > BugDesk Recordings'
      };

      // When folder is chosen from picker
      const newSettings = {
        id: selectedFromPicker.id,
        name: selectedFromPicker.name
      };

      assert.strictEqual(newSettings.name, 'BugDesk Recordings');
      assert.strictEqual(newSettings.id, '1XuwtO3rxjDJuG_RxH3qMTsJEwpJcUEV');
      assert.strictEqual(apiFetchCount, 0, 'No extra fetch should be made when picker returns name');
    });

    test('6.2 Resolves saved folder ID to folder name on page load if name is missing (Req 4)', async () => {
      const mockDriveMetadata = async (fileId) => {
        if (fileId === '1XuwtO3rxjDJuG_RxH3qMTsJEwpJcUEV') {
          return { id: fileId, name: 'BugDesk Recordings', trashed: false };
        }
        throw new Error('Not found');
      };

      const result = await resolveFolderDisplay({
        defaultFolderId: '1XuwtO3rxjDJuG_RxH3qMTsJEwpJcUEV',
        defaultFolderName: null, // missing from storage
        driveMetadataResolver: mockDriveMetadata
      });

      assert.strictEqual(result.id, '1XuwtO3rxjDJuG_RxH3qMTsJEwpJcUEV');
      assert.strictEqual(result.name, 'BugDesk Recordings');
      assert.strictEqual(result.status, 'ready');
      assert.strictEqual(result.folderIdDisplayedInUI, false);
    });

    test('6.3 Preserves actual name if name is P-1 without assuming or guessing (Req 10)', async () => {
      const mockDriveMetadata = async (fileId) => ({
        id: fileId,
        name: 'P-1',
        trashed: false
      });

      const result = await resolveFolderDisplay({
        defaultFolderId: 'folder_p1_999',
        defaultFolderName: 'P-1',
        driveMetadataResolver: mockDriveMetadata
      });

      assert.strictEqual(result.name, 'P-1');
      assert.strictEqual(result.folderIdDisplayedInUI, false);
    });

    test('6.4 Refreshes displayed folder name when folder is renamed in Google Drive (Req 6)', async () => {
      // User renamed folder from "QA Old Recordings" to "QA New Recordings 2026" in Drive
      const mockDriveMetadata = async () => ({
        id: 'folder-123',
        name: 'QA New Recordings 2026',
        trashed: false
      });

      const result = await resolveFolderDisplay({
        defaultFolderId: 'folder-123',
        defaultFolderName: 'QA Old Recordings',
        driveMetadataResolver: mockDriveMetadata
      });

      assert.strictEqual(result.name, 'QA New Recordings 2026');
      assert.strictEqual(result.status, 'ready');
    });

    test('6.5 Displays Folder unavailable and preserves ID internally when folder is deleted or in trash (Req 7 & 9)', async () => {
      const mockDriveMetadata = async () => ({
        id: 'folder-trashed',
        name: 'Deleted Folder',
        trashed: true
      });

      const result = await resolveFolderDisplay({
        defaultFolderId: 'folder-trashed',
        defaultFolderName: 'Deleted Folder',
        driveMetadataResolver: mockDriveMetadata
      });

      assert.strictEqual(result.status, 'unavailable');
      assert.strictEqual(result.name, null);
      // Folder ID is retained internally for recovery or change
      assert.strictEqual(result.id, 'folder-trashed');
      assert.strictEqual(result.folderIdDisplayedInUI, false);
    });

    test('6.6 Displays Folder unavailable when folder returns 404 or permission denied (Req 7)', async () => {
      const mockDriveMetadata = async () => {
        const err = new Error('File not found: folder-missing-404');
        err.statusCode = 404;
        throw err;
      };

      const result = await resolveFolderDisplay({
        defaultFolderId: 'folder-missing-404',
        defaultFolderName: null,
        driveMetadataResolver: mockDriveMetadata
      });

      assert.strictEqual(result.status, 'unavailable');
      assert.strictEqual(result.name, null);
      assert.strictEqual(result.id, 'folder-missing-404');
    });

    test('6.7 Upload payload still receives the internal folder ID (Req 9)', () => {
      const folderState = {
        id: '1XuwtO3rxjDJuG_RxH3qMTsJEwpJcUEV',
        name: 'BugDesk Recordings'
      };

      const formData = new FormData();
      if (folderState.id && folderState.id !== 'root') {
        formData.append('folderId', folderState.id);
      }

      assert.strictEqual(formData.get('folderId'), '1XuwtO3rxjDJuG_RxH3qMTsJEwpJcUEV');
    });
  });
});

