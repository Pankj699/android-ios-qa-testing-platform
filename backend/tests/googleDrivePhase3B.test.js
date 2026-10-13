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

describe('Google Drive Integration — Full Folder Explorer & Destination Verification Suite', () => {
  let app;
  let origEnv;
  let origClientId;
  let origClientSecret;
  let testUserA;
  let testUserB;
  let tokenUserA;
  let tokenUserB;
  let tempTestFile;

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

    const userA = await userService.register({
      email: `explorer_user_a_${Date.now()}@test.com`,
      password: 'SecurePassword123!',
      name: 'Tester Alpha'
    });
    testUserA = userA;
    tokenUserA = jwt.sign(
      { id: testUserA.id, email: testUserA.email, role: 'TESTER' },
      config.JWT_SECRET
    );

    const userB = await userService.register({
      email: `explorer_user_b_${Date.now()}@test.com`,
      password: 'SecurePassword123!',
      name: 'Tester Beta'
    });
    testUserB = userB;
    tokenUserB = jwt.sign(
      { id: testUserB.id, email: testUserB.email, role: 'TESTER' },
      config.JWT_SECRET
    );

    tempTestFile = path.join(__dirname, `temp_test_rec_${Date.now()}.mp4`);
    fs.writeFileSync(tempTestFile, Buffer.from('TEST_VIDEO_BYTES_DATA_STREAM'));

    app = express();
    app.use(express.json());
    app.use('/api', authenticate);
    const driveRoutes = require('../src/routes/driveRoutes');
    app.use('/api/drive', driveRoutes);
  });

  after(async () => {
    config.NODE_ENV = origEnv;
    config.GOOGLE_CLIENT_ID = origClientId;
    config.GOOGLE_CLIENT_SECRET = origClientSecret;
    if (tempTestFile && fs.existsSync(tempTestFile)) {
      fs.unlinkSync(tempTestFile);
    }
  });

  beforeEach(async () => {
    const encAccess = tokenCrypto.encryptToken('ya29.mock-access-token-full');
    const encRefresh = tokenCrypto.encryptSelfContained('1//0gmock-refresh-token');

    await db.query(
      `INSERT INTO google_drive_tokens (
        user_id, google_email, google_name,
        encrypted_access_token, encrypted_refresh_token,
        token_iv, token_auth_tag, expiry_date, scope,
        default_folder_id, default_folder_name
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (user_id) DO UPDATE SET
        encrypted_access_token = EXCLUDED.encrypted_access_token,
        encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
        token_iv = EXCLUDED.token_iv,
        token_auth_tag = EXCLUDED.token_auth_tag,
        scope = EXCLUDED.scope,
        expiry_date = EXCLUDED.expiry_date,
        default_folder_id = EXCLUDED.default_folder_id,
        default_folder_name = EXCLUDED.default_folder_name,
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
        'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.profile',
        'folder_default_alpha_123',
        'Alpha Default Folder'
      ]
    );

    // Also seed user B tokens so user B is connected
    await db.query(
      `INSERT INTO google_drive_tokens (
        user_id, google_email, google_name,
        encrypted_access_token, encrypted_refresh_token,
        token_iv, token_auth_tag, expiry_date, scope,
        default_folder_id, default_folder_name
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (user_id) DO UPDATE SET
        encrypted_access_token = EXCLUDED.encrypted_access_token,
        encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
        token_iv = EXCLUDED.token_iv,
        token_auth_tag = EXCLUDED.token_auth_tag,
        scope = EXCLUDED.scope,
        expiry_date = EXCLUDED.expiry_date,
        default_folder_id = EXCLUDED.default_folder_id,
        default_folder_name = EXCLUDED.default_folder_name,
        updated_at = NOW()`,
      [
        testUserB.id,
        'tester.beta@gmail.com',
        'Tester Beta',
        encAccess.encrypted,
        encRefresh,
        encAccess.iv,
        encAccess.authTag,
        Date.now() + 3600000,
        'https://www.googleapis.com/auth/drive',
        null,
        null
      ]
    );
  });

  describe('Priority 1: Scope Detection & Visibility Queries', () => {
    it('Scenario 1: Full Drive scope is correctly identified as hasFullDriveScope=true', async () => {
      const status = await googleDriveService.getConnectionStatus(testUserA.id);
      assert.equal(status.connected, true);
      assert.equal(status.hasFullDriveScope, true);
      assert.equal(status.scopeWarning, null);
    });

    it('Scenario 2: Restricted drive.file scope triggers hasFullDriveScope=false and actionable warning', async () => {
      await db.query(
        `UPDATE google_drive_tokens SET scope = $1 WHERE user_id = $2`,
        ['https://www.googleapis.com/auth/drive.file', testUserA.id]
      );

      const status = await googleDriveService.getConnectionStatus(testUserA.id);
      assert.equal(status.connected, true);
      assert.equal(status.hasFullDriveScope, false);
      assert.ok(status.scopeWarning.includes('drive.file'));
    });

    it('Scenario 3: generateAuthUrl requests full drive scope and prompt=consent when reconnecting', async () => {
      const res = await googleDriveService.generateAuthUrl(testUserA.id, { prompt: 'consent' });
      assert.ok(res.url);
      assert.ok(res.url.includes('scope='));
      assert.ok(res.url.includes('https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive'));
      assert.ok(res.url.includes('prompt=consent'));
    });

    it('Scenario 4: listFiles includes supportsAllDrives and includeItemsFromAllDrives flags', async () => {
      let capturedParams = null;
      const mockDrive = {
        files: {
          list: async (params) => {
            capturedParams = params;
            return {
              data: {
                files: [
                  { id: 'folder-1', name: 'Existing Pre-QA Folder', mimeType: 'application/vnd.google-apps.folder' },
                  { id: 'file-1', name: 'readme.txt', mimeType: 'text/plain', size: '120' }
                ],
                nextPageToken: null
              }
            };
          }
        }
      };

      const res = await googleDriveService.listFiles(testUserA.id, { folderId: 'root' }, mockDrive);
      assert.equal(capturedParams.supportsAllDrives, true);
      assert.equal(capturedParams.includeItemsFromAllDrives, true);
      assert.ok(capturedParams.q.includes("'root' in parents"));
      assert.equal(res.files.length, 2);
    });

    it('Scenario 5: Drive API error returns structured error response instead of masking as empty list', async () => {
      const mockDrive = {
        files: {
          list: async () => {
            const err = new Error('Google Drive API rate limit exceeded');
            err.code = 429;
            throw err;
          }
        }
      };

      await assert.rejects(
        async () => {
          await googleDriveService.listFiles(testUserA.id, { folderId: 'root' }, mockDrive);
        },
        /Google Drive API rate limit exceeded/
      );
    });
  });

  describe('Priority 2: Folder Navigation, Hierarchy & Breadcrumbs', () => {
    it('Scenario 6: listFiles queries nested folder properly by parentId', async () => {
      let capturedQuery = null;
      const mockDrive = {
        files: {
          list: async (params) => {
            capturedQuery = params.q;
            return { data: { files: [{ id: 'child-1', name: 'Smoke Tests', mimeType: 'application/vnd.google-apps.folder' }] } };
          }
        }
      };

      const res = await googleDriveService.listFiles(testUserA.id, { folderId: 'parent-folder-123' }, mockDrive);
      assert.ok(capturedQuery.includes("'parent-folder-123' in parents"));
      assert.equal(res.files.length, 1);
      assert.equal(res.files[0].name, 'Smoke Tests');
    });

    it('Scenario 7: getFolderBreadcrumbs endpoint resolves full path up to My Drive', async () => {
      const mockDrive = {
        files: {
          get: async ({ fileId }) => {
            if (fileId === 'folder-smoke') {
              return { data: { id: 'folder-smoke', name: 'Smoke Tests', parents: ['folder-android'] } };
            }
            if (fileId === 'folder-android') {
              return { data: { id: 'folder-android', name: 'Android', parents: ['folder-qa'] } };
            }
            if (fileId === 'folder-qa') {
              return { data: { id: 'folder-qa', name: 'QA Recordings', parents: ['root'] } };
            }
            throw new Error(`Folder not found: ${fileId}`);
          }
        }
      };

      const result = await googleDriveService.getFolderBreadcrumbs(testUserA.id, 'folder-smoke', mockDrive);
      assert.equal(result.folder.id, 'folder-smoke');
      assert.equal(result.folder.name, 'Smoke Tests');
      assert.equal(result.breadcrumbs.length, 4);
      assert.deepEqual(result.breadcrumbs.map(b => b.name), [
        'My Drive',
        'QA Recordings',
        'Android',
        'Smoke Tests'
      ]);
    });

    it('Scenario 8: createFolder in root specifies parents=undefined (root) and supportsAllDrives', async () => {
      let capturedBody = null;
      let capturedParams = null;
      const mockDrive = {
        files: {
          create: async (params) => {
            capturedBody = params.requestBody;
            capturedParams = params;
            return { data: { id: 'new-folder-root', name: params.requestBody.name, mimeType: params.requestBody.mimeType } };
          }
        }
      };

      const folder = await googleDriveService.createFolder(
        testUserA.id,
        'Automation Tests',
        'root',
        mockDrive
      );
      assert.equal(folder.name, 'Automation Tests');
      assert.equal(capturedBody.parents, undefined);
      assert.equal(capturedParams.supportsAllDrives, true);
    });

    it('Scenario 9: createFolder nested inside parent folder specifies the parent ID', async () => {
      let capturedParents = null;
      const mockDrive = {
        files: {
          create: async (params) => {
            capturedParents = params.requestBody.parents;
            return { data: { id: 'new-nested-folder', name: params.requestBody.name, mimeType: params.requestBody.mimeType } };
          }
        }
      };

      await googleDriveService.createFolder(
        testUserA.id,
        'Regression 2026',
        'folder-android-99',
        mockDrive
      );
      assert.deepEqual(capturedParents, ['folder-android-99']);
    });

    it('Scenario 10: createFolder validates and rejects blank or whitespace-only name', async () => {
      await assert.rejects(
        async () => {
          await googleDriveService.createFolder(testUserA.id, '   ', 'root');
        },
        /Folder name is required/
      );
    });

    it('Scenario 11: listFiles supports pagination parameters (pageSize and nextPageToken)', async () => {
      let capturedParams = null;
      const mockDrive = {
        files: {
          list: async (params) => {
            capturedParams = params;
            return {
              data: {
                files: [{ id: 'f-page-2', name: 'recording_page2.webm' }],
                nextPageToken: 'token-page-3'
              }
            };
          }
        }
      };

      const res = await googleDriveService.listFiles(
        testUserA.id,
        { folderId: 'root', pageSize: 25, pageToken: 'token-page-2' },
        mockDrive
      );
      assert.equal(capturedParams.pageSize, 25);
      assert.equal(capturedParams.pageToken, 'token-page-2');
      assert.equal(res.nextPageToken, 'token-page-3');
    });

    it('Scenario 12: listFiles search filters by name with case-insensitive contains', async () => {
      let capturedQuery = null;
      const mockDrive = {
        files: {
          list: async (params) => {
            capturedQuery = params.q;
            return { data: { files: [{ id: 'f-match', name: 'smoke_test_pass.webm' }] } };
          }
        }
      };

      await googleDriveService.listFiles(testUserA.id, { search: 'smoke' }, mockDrive);
      assert.ok(capturedQuery.includes("name contains 'smoke'"));
    });
  });

  describe('Priority 3: Default Destination & Recording Upload Destination Integrity', () => {
    it('Scenario 13: User can set any nested folder as default destination', async () => {
      const response = await makeRequest({
        method: 'POST',
        urlPath: '/api/drive/default-folder',
        headers: { authorization: `Bearer ${tokenUserA}` },
        body: { folderId: 'folder-custom-destination', folderName: 'Android > Smoke Tests' }
      });

      assert.equal(response.status, 200);
      assert.equal(response.body.success, true);
      assert.equal(response.body.defaultFolderId, 'folder-custom-destination');
      assert.equal(response.body.defaultFolderName, 'Android > Smoke Tests');

      const status = await googleDriveService.getConnectionStatus(testUserA.id);
      assert.equal(status.defaultFolderId, 'folder-custom-destination');
      assert.equal(status.defaultFolderName, 'Android > Smoke Tests');
    });

    it('Scenario 14: Recording upload streams into user-selected nested folder and keeps it private', async () => {
      let capturedCreateBody = null;
      const mockDrive = {
        files: {
          get: async ({ fileId }) => ({
            data: { id: fileId, name: 'Target Subfolder', mimeType: 'application/vnd.google-apps.folder' }
          }),
          create: async (params) => {
            capturedCreateBody = params.requestBody;
            return {
              data: {
                id: 'drive-uploaded-file-456',
                name: params.requestBody.name,
                webViewLink: 'https://drive.google.com/file/d/drive-uploaded-file-456/view'
              }
            };
          }
        }
      };

      const uploadRes = await googleDriveService.uploadRecording(
        testUserA.id,
        {
          filePath: tempTestFile,
          filename: 'device_test_session_nested.mp4',
          durationSec: 45,
          folderId: 'folder-nested-destination',
          deviceSerial: 'DEVICE_SERIAL_PAD_01',
          deviceName: 'Android PAD Pro'
        },
        mockDrive
      );

      assert.equal(uploadRes.upload_status, 'UPLOADED');
      assert.equal(uploadRes.google_drive_folder_id, 'folder-nested-destination');
      assert.deepEqual(capturedCreateBody.parents, ['folder-nested-destination']);
    });

    it('Scenario 15: Invalid destination folder throws explicit error and DOES NOT silently fall back to root', async () => {
      const mockDrive = {
        files: {
          get: async ({ fileId }) => {
            const err = new Error(`File not found: ${fileId}`);
            err.code = 404;
            throw err;
          }
        }
      };

      await assert.rejects(
        async () => {
          await googleDriveService.uploadRecording(
            testUserA.id,
            {
              filePath: tempTestFile,
              filename: 'strict_destination_check.mp4',
              folderId: 'deleted-or-invalid-folder-id'
            },
            mockDrive
          );
        },
        /Destination folder does not exist or is not accessible/
      );
    });

    it('Scenario 16: Multi-user default folder and upload isolation', async () => {
      await googleDriveService.setDefaultFolder(testUserB.id, 'folder-user-b-unique', 'User B Special Folder');

      const statusA = await googleDriveService.getConnectionStatus(testUserA.id);
      const statusB = await googleDriveService.getConnectionStatus(testUserB.id);

      assert.notEqual(statusA.defaultFolderId, statusB.defaultFolderId);
      assert.equal(statusB.defaultFolderId, 'folder-user-b-unique');
      assert.equal(statusB.defaultFolderName, 'User B Special Folder');
    });
  });
});
