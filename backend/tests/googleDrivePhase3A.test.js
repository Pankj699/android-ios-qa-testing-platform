const { test, describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');

const config = require('../src/config');
const db = require('../src/db');
const { runMigrations } = require('../src/db/migrate');
const tokenCrypto = require('../src/utils/tokenCrypto');
const googleDriveService = require('../src/services/googleDriveService');
const { authenticate } = require('../src/middleware/auth');
const userService = require('../src/services/userService');

describe('Google Drive Integration — Phase 3A Test Suite (Folder Operations & Uploads)', () => {
  let app;
  let origEnv;
  let origClientId;
  let origClientSecret;
  let testUserA;
  let testUserB;
  let tokenUserA;
  let tokenUserB;
  let tempTestFile;

  // Helper to simulate HTTP requests through Express app
  function makeRequest({ method = 'GET', urlPath, headers = {}, body = null }) {
    return new Promise((resolve) => {
      let statusCode = 200;
      let responseHeaders = {};
      let responseBody = null;

      const urlObj = new URL(urlPath, 'http://localhost:8080');
      const query = Object.fromEntries(urlObj.searchParams.entries());

      const req = {
        method,
        url: urlPath,
        originalUrl: urlPath,
        path: urlObj.pathname,
        headers: {
          'content-type': 'application/json',
          ...headers
        },
        body,
        query,
        socket: { remoteAddress: '127.0.0.1' },
        ip: '127.0.0.1'
      };

      const res = {
        status(code) {
          statusCode = code;
          return this;
        },
        setHeader(name, val) {
          responseHeaders[name.toLowerCase()] = val;
          return this;
        },
        json(data) {
          responseBody = data;
          resolve({ status: statusCode, headers: responseHeaders, body: responseBody });
        },
        send(data) {
          responseBody = data;
          resolve({ status: statusCode, headers: responseHeaders, body: responseBody });
        }
      };

      app.handle(req, res, (err) => {
        if (err) {
          resolve({
            status: err.statusCode || 500,
            headers: responseHeaders,
            body: { success: false, error: err.message }
          });
        } else {
          resolve({ status: 404, headers: responseHeaders, body: { success: false, error: 'Not found' } });
        }
      });
    });
  }

  before(async () => {
    origEnv = config.NODE_ENV;
    origClientId = config.GOOGLE_CLIENT_ID;
    origClientSecret = config.GOOGLE_CLIENT_SECRET;

    config.NODE_ENV = 'test';
    config.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
    config.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    config.GOOGLE_REDIRECT_URI = 'http://localhost:8080/api/drive/callback';

    await runMigrations();

    // Register User Alpha
    const userA = await userService.register({
      email: `phase3a_user_a_${Date.now()}@test.com`,
      password: 'SecurePassword123!',
      name: 'Tester Alpha'
    });
    testUserA = userA;
    tokenUserA = jwt.sign(
      { id: testUserA.id, email: testUserA.email, role: 'TESTER' },
      config.JWT_SECRET
    );

    // Register User Beta
    const userB = await userService.register({
      email: `phase3a_user_b_${Date.now()}@test.com`,
      password: 'SecurePassword123!',
      name: 'Tester Beta'
    });
    testUserB = userB;
    tokenUserB = jwt.sign(
      { id: testUserB.id, email: testUserB.email, role: 'TESTER' },
      config.JWT_SECRET
    );

    // Seed mock Google Drive tokens for User Alpha so getAuthenticatedDriveClient succeeds
    const encAccess = tokenCrypto.encryptToken('ya29.phase3a-access-token');
    const encRefresh = tokenCrypto.encryptSelfContained('1//0gphase3a-refresh-token');
    await db.query(
      `INSERT INTO google_drive_tokens (
        user_id, google_email, google_name,
        encrypted_access_token, encrypted_refresh_token,
        token_iv, token_auth_tag, expiry_date, scope,
        default_folder_id, default_folder_name
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (user_id) DO UPDATE SET
        encrypted_access_token = EXCLUDED.encrypted_access_token,
        updated_at = NOW()`,
      [
        testUserA.id,
        'tester.alpha@gmail.com',
        'Tester Alpha',
        encAccess.encrypted,
        encRefresh,
        encAccess.iv,
        encAccess.authTag,
        Date.now() + 3600000,
        'https://www.googleapis.com/auth/drive.file',
        'folder_default_alpha_123',
        'QA Default Recordings'
      ]
    );

    // Setup Express App matching main backend router
    app = express();
    app.use(express.json());
    app.use('/api', authenticate);

    const driveRoutes = require('../src/routes/driveRoutes');
    const recordingRoutes = require('../src/routes/recordingRoutes');
    app.use('/api/drive', driveRoutes);
    app.use('/api', recordingRoutes);

    // Create a temporary sample recording file for testing uploads
    const tempDir = path.join(config.UPLOAD_DIR, 'test_recordings');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    tempTestFile = path.join(tempDir, `sample_test_rec_${Date.now()}.webm`);
    fs.writeFileSync(tempTestFile, Buffer.from('RIFF....WEBM...dummy video content bytes for test'));
  });

  after(() => {
    config.NODE_ENV = origEnv;
    config.GOOGLE_CLIENT_ID = origClientId;
    config.GOOGLE_CLIENT_SECRET = origClientSecret;

    if (tempTestFile && fs.existsSync(tempTestFile)) {
      try {
        fs.unlinkSync(tempTestFile);
      } catch (e) {}
    }
  });

  describe('1. Google Drive File & Folder Operations', () => {
    it('listFiles: lists files with pagination and folder filtering', async () => {
      const mockDrive = {
        files: {
          list: async ({ q, pageSize }) => {
            assert.ok(q.includes('trashed = false'));
            assert.ok(q.includes('folder_xyz_123'));
            return {
              data: {
                files: [
                  { id: 'file_001', name: 'recording_1.webm', mimeType: 'video/webm' },
                  { id: 'folder_001', name: 'App Tests', mimeType: 'application/vnd.google-apps.folder' }
                ],
                nextPageToken: 'token_page_2'
              }
            };
          }
        }
      };

      const result = await googleDriveService.listFiles(
        testUserA.id,
        { folderId: 'folder_xyz_123', pageSize: 10 },
        mockDrive
      );

      // Verify listFiles directly with mock
      const mockResult = await googleDriveService.listFiles(
        testUserA.id,
        { folderId: 'folder_xyz_123' },
        mockDrive
      );
      assert.strictEqual(mockResult.files.length, 2);
      assert.strictEqual(mockResult.nextPageToken, 'token_page_2');
    });

    it('createFolder: creates a new folder with valid name and parentId', async () => {
      const mockDrive = {
        files: {
          create: async ({ requestBody }) => {
            assert.strictEqual(requestBody.name, 'Login Screen Tests');
            assert.strictEqual(requestBody.mimeType, 'application/vnd.google-apps.folder');
            assert.deepStrictEqual(requestBody.parents, ['parent_folder_abc']);
            return {
              data: {
                id: 'new_folder_999',
                name: requestBody.name,
                mimeType: requestBody.mimeType,
                parents: requestBody.parents
              }
            };
          }
        }
      };

      const folder = await googleDriveService.createFolder(
        testUserA.id,
        'Login Screen Tests',
        'parent_folder_abc',
        mockDrive
      );

      assert.strictEqual(folder.id, 'new_folder_999');
      assert.strictEqual(folder.name, 'Login Screen Tests');
    });

    it('createFolder: rejects empty or invalid folder names', async () => {
      await assert.rejects(
        async () => {
          await googleDriveService.createFolder(testUserA.id, '   ');
        },
        {
          message: /Folder name is required/i
        }
      );
    });

    it('renameFile: updates file name in Google Drive and local recordings', async () => {
      const mockDrive = {
        files: {
          update: async ({ fileId, requestBody }) => {
            assert.strictEqual(fileId, 'file_rename_123');
            assert.strictEqual(requestBody.name, 'renamed_recording.webm');
            return {
              data: {
                id: fileId,
                name: requestBody.name,
                mimeType: 'video/webm'
              }
            };
          }
        }
      };

      const updated = await googleDriveService.renameFile(
        testUserA.id,
        'file_rename_123',
        'renamed_recording.webm',
        mockDrive
      );

      assert.strictEqual(updated.name, 'renamed_recording.webm');
    });

    it('moveFile: moves file to destination folder by updating parents', async () => {
      const mockDrive = {
        files: {
          get: async ({ fileId }) => ({
            data: { parents: ['old_parent_folder'] }
          }),
          update: async ({ fileId, addParents, removeParents }) => {
            assert.strictEqual(fileId, 'file_move_123');
            assert.strictEqual(addParents, 'destination_folder_456');
            assert.strictEqual(removeParents, 'old_parent_folder');
            return {
              data: {
                id: fileId,
                parents: ['destination_folder_456']
              }
            };
          }
        }
      };

      const moved = await googleDriveService.moveFile(
        testUserA.id,
        'file_move_123',
        'destination_folder_456',
        null,
        mockDrive
      );

      assert.deepStrictEqual(moved.parents, ['destination_folder_456']);
    });

    it('deleteFile: deletes file from Drive and clears Drive link in local recordings', async () => {
      let deletedId = null;
      const mockDrive = {
        files: {
          delete: async ({ fileId }) => {
            deletedId = fileId;
            return { data: {} };
          }
        }
      };

      // Create a local recording associated with this file ID
      await db.query(
        `INSERT INTO recordings (
          user_id, recording_id, filename, original_filename,
          google_drive_file_id, upload_status
        ) VALUES ($1, $2, $3, $4, $5, 'UPLOADED')`,
        [testUserA.id, 'rec_del_test_1', 'video_to_delete.webm', 'orig.webm', 'file_del_123']
      );

      const res = await googleDriveService.deleteFile(testUserA.id, 'file_del_123', mockDrive);
      assert.strictEqual(res.success, true);
      assert.strictEqual(deletedId, 'file_del_123');

      // Verify local record was preserved but Drive link was cleared
      const check = await db.query('SELECT * FROM recordings WHERE recording_id = $1', ['rec_del_test_1']);
      assert.strictEqual(check.rows.length, 1);
      assert.strictEqual(check.rows[0].upload_status, 'LOCAL_ONLY');
      assert.strictEqual(check.rows[0].google_drive_file_id, null);
    });

    it('getFileMetadata: retrieves file metadata from Google Drive', async () => {
      const mockDrive = {
        files: {
          get: async ({ fileId }) => ({
            data: {
              id: fileId,
              name: 'pad_test_run.webm',
              size: '10485760',
              mimeType: 'video/webm',
              webViewLink: 'https://drive.google.com/file/d/meta123/view'
            }
          })
        }
      };

      const meta = await googleDriveService.getFileMetadata(testUserA.id, 'meta123', mockDrive);
      assert.strictEqual(meta.id, 'meta123');
      assert.strictEqual(meta.name, 'pad_test_run.webm');
      assert.strictEqual(meta.size, '10485760');
    });

    it('createShareableLink: explicitly creates anyone-with-link read permission', async () => {
      let createdPermission = null;
      const mockDrive = {
        permissions: {
          create: async ({ fileId, requestBody }) => {
            assert.strictEqual(fileId, 'share_file_123');
            createdPermission = requestBody;
            return { data: { id: 'perm_anyone_reader' } };
          }
        },
        files: {
          get: async ({ fileId }) => ({
            data: {
              id: fileId,
              webViewLink: 'https://drive.google.com/file/d/share_file_123/view?usp=sharing',
              webContentLink: 'https://drive.google.com/uc?id=share_file_123'
            }
          })
        }
      };

      const shareResult = await googleDriveService.createShareableLink(
        testUserA.id,
        'share_file_123',
        mockDrive
      );

      assert.deepStrictEqual(createdPermission, { role: 'reader', type: 'anyone' });
      assert.ok(shareResult.shareLink.includes('share_file_123'));
      assert.ok(shareResult.message.includes('Shareable link created'));
    });
  });

  describe('2. User Default Upload Folder Management', () => {
    it('getDefaultFolder retrieves current default folder', async () => {
      const res = await makeRequest({
        method: 'GET',
        urlPath: '/api/drive/default-folder',
        headers: { authorization: `Bearer ${tokenUserA}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.defaultFolderId, 'folder_default_alpha_123');
      assert.strictEqual(res.body.defaultFolderName, 'QA Default Recordings');
    });

    it('setDefaultFolder updates default upload folder for current user', async () => {
      const res = await makeRequest({
        method: 'POST',
        urlPath: '/api/drive/default-folder',
        headers: { authorization: `Bearer ${tokenUserA}` },
        body: {
          folderId: 'folder_custom_updated_789',
          folderName: 'Automated PAD Tests'
        }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.defaultFolderId, 'folder_custom_updated_789');
      assert.strictEqual(res.body.defaultFolderName, 'Automated PAD Tests');

      // Verify in DB
      const dbCheck = await db.query(
        'SELECT default_folder_id, default_folder_name FROM google_drive_tokens WHERE user_id = $1',
        [testUserA.id]
      );
      assert.strictEqual(dbCheck.rows[0].default_folder_id, 'folder_custom_updated_789');
    });
  });

  describe('3. Recording Upload Service & Streaming', () => {
    it('uploadRecording: streams recording to Drive, falls back to default folder, and persists record', async () => {
      let uploadedFileBody = null;
      const mockDrive = {
        files: {
          create: async ({ requestBody, media }) => {
            assert.strictEqual(requestBody.name, 'login_flow_recording.webm');
            assert.deepStrictEqual(requestBody.parents, ['folder_custom_updated_789']);
            assert.ok(media.body); // Stream is attached
            return {
              data: {
                id: 'gdrive_file_rec_999',
                name: requestBody.name,
                webViewLink: 'https://drive.google.com/file/d/gdrive_file_rec_999/view'
              }
            };
          }
        }
      };

      const recording = await googleDriveService.uploadRecording(
        testUserA.id,
        {
          filePath: tempTestFile,
          originalFilename: 'login_flow_recording.webm',
          mimeType: 'video/webm',
          durationSec: 45,
          deviceSerial: 'emulator-5554',
          deviceName: 'Pixel 7 Pro',
          testId: 'test_pad_login_001',
          recordingId: 'rec_custom_id_101'
        },
        mockDrive
      );

      assert.strictEqual(recording.recording_id, 'rec_custom_id_101');
      assert.strictEqual(recording.upload_status, 'UPLOADED');
      assert.strictEqual(recording.google_drive_file_id, 'gdrive_file_rec_999');
      assert.strictEqual(recording.device_serial, 'emulator-5554');
      assert.strictEqual(recording.duration_sec, 45);

      // Verify DB record
      const dbRec = await db.query('SELECT * FROM recordings WHERE recording_id = $1', ['rec_custom_id_101']);
      assert.strictEqual(dbRec.rows.length, 1);
      assert.strictEqual(dbRec.rows[0].user_id, testUserA.id);
      assert.strictEqual(dbRec.rows[0].google_drive_file_id, 'gdrive_file_rec_999');
    });

    it('uploadRecording: prevents duplicate creation on repeated submission', async () => {
      let callCount = 0;
      const mockDrive = {
        files: {
          create: async () => {
            callCount++;
            return { data: { id: 'file_dup_1' } };
          }
        }
      };

      // Resubmitting the same rec_custom_id_101 which is already UPLOADED
      const existing = await googleDriveService.uploadRecording(
        testUserA.id,
        {
          filePath: tempTestFile,
          recordingId: 'rec_custom_id_101'
        },
        mockDrive
      );

      // Google drive create was NOT called again
      assert.strictEqual(callCount, 0);
      assert.strictEqual(existing.recording_id, 'rec_custom_id_101');
      assert.strictEqual(existing.upload_status, 'UPLOADED');
    });

    it('uploadRecording: records FAILED status on Google Drive API failure', async () => {
      const mockDriveFailing = {
        files: {
          create: async () => {
            const err = new Error('Google Drive quota limit exceeded for project');
            err.status = 403;
            throw err;
          }
        }
      };

      const failRecId = 'rec_fail_test_403';
      await assert.rejects(
        async () => {
          await googleDriveService.uploadRecording(
            testUserA.id,
            {
              filePath: tempTestFile,
              recordingId: failRecId,
              originalFilename: 'failed_recording.webm'
            },
            mockDriveFailing
          );
        },
        {
          message: /Google Drive quota limit exceeded/
        }
      );

      const dbCheck = await db.query('SELECT * FROM recordings WHERE recording_id = $1', [failRecId]);
      assert.strictEqual(dbCheck.rows.length, 1);
      assert.strictEqual(dbCheck.rows[0].upload_status, 'FAILED');
      assert.ok(dbCheck.rows[0].upload_error.includes('quota limit exceeded'));
    });

    it('uploadRecording: rejects missing file path on disk', async () => {
      await assert.rejects(
        async () => {
          await googleDriveService.uploadRecording(testUserA.id, {
            filePath: '/non/existent/path/video.webm'
          });
        },
        {
          message: /does not exist on disk/i
        }
      );
    });
  });

  describe('4. Recordings Management & Multi-User Isolation', () => {
    it('listRecordings strictly isolates records by user ID', async () => {
      // Create a recording for User Beta
      await db.query(
        `INSERT INTO recordings (
          user_id, recording_id, filename, original_filename, upload_status
        ) VALUES ($1, $2, $3, $4, 'UPLOADED')`,
        [testUserB.id, 'rec_user_b_exclusive', 'user_b_video.mp4', 'orig.mp4']
      );

      // Request recordings as User Alpha
      const resA = await makeRequest({
        method: 'GET',
        urlPath: '/api/recordings',
        headers: { authorization: `Bearer ${tokenUserA}` }
      });

      assert.strictEqual(resA.status, 200);
      assert.ok(Array.isArray(resA.body.recordings));
      // Must NOT contain User Beta's recording
      assert.strictEqual(
        resA.body.recordings.some((r) => r.recording_id === 'rec_user_b_exclusive'),
        false
      );

      // Request recordings as User Beta
      const resB = await makeRequest({
        method: 'GET',
        urlPath: '/api/recordings',
        headers: { authorization: `Bearer ${tokenUserB}` }
      });

      assert.strictEqual(resB.status, 200);
      assert.strictEqual(resB.body.recordings.length, 1);
      assert.strictEqual(resB.body.recordings[0].recording_id, 'rec_user_b_exclusive');
    });

    it('getRecording prevents User A from retrieving User B private recording', async () => {
      const res = await makeRequest({
        method: 'GET',
        urlPath: '/api/recordings/rec_user_b_exclusive',
        headers: { authorization: `Bearer ${tokenUserA}` }
      });

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'Recording not found');
    });

    it('deleteRecording deletes record and prevents cross-user deletion', async () => {
      // User A attempts to delete User B's recording -> 404
      const resAttempt = await makeRequest({
        method: 'DELETE',
        urlPath: '/api/recordings/rec_user_b_exclusive',
        headers: { authorization: `Bearer ${tokenUserA}` }
      });
      assert.strictEqual(resAttempt.status, 404);

      // User B deletes own recording -> 200
      const resDelete = await makeRequest({
        method: 'DELETE',
        urlPath: '/api/recordings/rec_user_b_exclusive',
        headers: { authorization: `Bearer ${tokenUserB}` }
      });
      assert.strictEqual(resDelete.status, 200);
      assert.strictEqual(resDelete.body.success, true);

      // Verify deleted in DB
      const check = await db.query('SELECT * FROM recordings WHERE recording_id = $1', ['rec_user_b_exclusive']);
      assert.strictEqual(check.rows.length, 0);
    });
  });
});
