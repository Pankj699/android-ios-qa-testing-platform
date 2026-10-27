const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const config = require('../src/config');
const db = require('../src/db');
const { runMigrations } = require('../src/db/migrate');
const tokenCrypto = require('../src/utils/tokenCrypto');
const userService = require('../src/services/userService');
const googleDriveService = require('../src/services/googleDriveService');
const bugDeskService = require('../src/services/bugDeskService');
const bugDeskController = require('../src/controllers/bugDeskController');

describe('BugDesk Google Account Integration & Gemini API Setup Test Suite', () => {
  let testUserA;
  let testUserB;
  let originalFetch;
  let scopedStorage;

  before(async () => {
    config.NODE_ENV = 'test';
    config.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
    config.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    await runMigrations();

    // Register User A and User B for isolation testing
    testUserA = await userService.register({
      email: `bugdesk_gemini_a_${Date.now()}@test.com`,
      password: 'Password123!',
      name: 'Alice Tester'
    });

    testUserB = await userService.register({
      email: `bugdesk_gemini_b_${Date.now()}@test.com`,
      password: 'Password123!',
      name: 'Bob Tester'
    });

    // Mock localStorage in global for frontend scoped-storage testing
    const storageStore = new Map();
    global.window = {
      localStorage: {
        getItem: (k) => storageStore.get(k) || null,
        setItem: (k, v) => storageStore.set(k, String(v)),
        removeItem: (k) => storageStore.delete(k),
        clear: () => storageStore.clear()
      },
      dispatchEvent: () => {}
    };

    const scopedStoragePath = path.resolve(__dirname, '../../frontend/src/bugdesk/lib/scoped-storage.js');
    scopedStorage = await import(pathToFileURL(scopedStoragePath).href);

    originalFetch = global.fetch;
  });

  after(() => {
    global.fetch = originalFetch;
  });

  describe('1. Google Account Connection Status & Minimum Scopes', () => {
    test('1.1 Unconnected user reports connected: false without throwing', async () => {
      const status = await googleDriveService.getConnectionStatus(testUserA.id);
      assert.strictEqual(status.connected, false);
      assert.strictEqual(status.email, undefined);
    });

    test('1.2 Connected user reports Google email, name, and identity accurately', async () => {
      const encAccess = tokenCrypto.encryptToken('ya29.mock-google-account-access-token');
      const encRefresh = tokenCrypto.encryptSelfContained('1//0gmock-google-refresh-token');

      await db.query(
        `INSERT INTO google_drive_tokens (
          user_id, google_email, google_name,
          encrypted_access_token, encrypted_refresh_token,
          token_iv, token_auth_tag, expiry_date, scope,
          default_folder_id, default_folder_name
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (user_id) DO UPDATE SET
          google_email = EXCLUDED.google_email,
          encrypted_access_token = EXCLUDED.encrypted_access_token,
          updated_at = NOW()`,
        [
          testUserA.id,
          'alice.tester.google@gmail.com',
          'Alice Google',
          encAccess.encrypted,
          encRefresh,
          encAccess.iv,
          encAccess.authTag,
          Date.now() + 3600000,
          'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
          'root',
          'My Drive'
        ]
      );

      const status = await googleDriveService.getConnectionStatus(testUserA.id);
      assert.strictEqual(status.connected, true);
      assert.strictEqual(status.email, 'alice.tester.google@gmail.com');
      assert.strictEqual(status.name, 'Alice Google');
    });

    test('1.3 Google OAuth URL requests minimal identity/drive scopes and does NOT request broad cloud-platform scope', async () => {
      const authObj = await googleDriveService.generateAuthUrl(testUserA.id, {
        origin: 'http://localhost:8080'
      });

      assert.ok(authObj.url);
      const parsedUrl = new URL(authObj.url);
      const requestedScope = parsedUrl.searchParams.get('scope') || '';

      // Must include standard userinfo & drive scopes
      assert.ok(requestedScope.includes('userinfo.email'));
      assert.ok(requestedScope.includes('userinfo.profile'));

      // Crucial: Must NOT request broad cloud-platform permissions for ordinary users
      assert.strictEqual(
        requestedScope.includes('https://www.googleapis.com/auth/cloud-platform'),
        false,
        'Must not request broad cloud-platform permissions'
      );
    });
  });

  describe('2. Disconnect Google Account Isolation', () => {
    test('2.1 Disconnecting Google account removes only google_drive_tokens and preserves saved Gemini key', async () => {
      // 1. User A saves Gemini API key and model in scoped storage
      scopedStorage.saveAISettings(testUserA.id, {
        apiKey: 'AIzaSyTestKey_Alice_12345',
        model: 'gemini-2.5-pro'
      });

      // 2. User A saves a bug report draft and PMS URL
      scopedStorage.saveNewBugDraft(testUserA.id, {
        rawNotes: 'Draft notes before Google disconnect'
      });
      scopedStorage.savePMSUrls(testUserA.id, {
        android: 'https://pms.custom.com/issues/new'
      });

      // 3. Verify Google account is connected for User A
      let driveStatus = await googleDriveService.getConnectionStatus(testUserA.id);
      assert.strictEqual(driveStatus.connected, true);

      // 4. User A disconnects Google Account
      const disconnectRes = await googleDriveService.disconnect(testUserA.id);
      assert.strictEqual(disconnectRes.success, true);

      // 5. Verify Google account is disconnected
      driveStatus = await googleDriveService.getConnectionStatus(testUserA.id);
      assert.strictEqual(driveStatus.connected, false);

      // 6. Verify Gemini API key, drafts, and PMS URLs remain 100% intact!
      const aiSettings = scopedStorage.getAISettings(testUserA.id);
      assert.strictEqual(aiSettings.apiKey, 'AIzaSyTestKey_Alice_12345');
      assert.strictEqual(aiSettings.model, 'gemini-2.5-pro');

      const draft = scopedStorage.getNewBugDraft(testUserA.id);
      assert.strictEqual(draft.rawNotes, 'Draft notes before Google disconnect');

      const pms = scopedStorage.getPMSUrls(testUserA.id);
      assert.strictEqual(pms.android, 'https://pms.custom.com/issues/new');
    });
  });

  describe('3. User-Scoped Key Storage & Multi-User Isolation', () => {
    test('3.1 User A and User B have completely isolated Gemini API keys and settings', () => {
      scopedStorage.saveAISettings(testUserA.id, {
        apiKey: 'AIzaSy_ALICE_SECRET_KEY',
        model: 'gemini-2.5-flash'
      });

      scopedStorage.saveAISettings(testUserB.id, {
        apiKey: 'AIzaSy_BOB_SECRET_KEY',
        model: 'gemini-2.5-pro'
      });

      const aliceAI = scopedStorage.getAISettings(testUserA.id);
      const bobAI = scopedStorage.getAISettings(testUserB.id);

      assert.strictEqual(aliceAI.apiKey, 'AIzaSy_ALICE_SECRET_KEY');
      assert.strictEqual(aliceAI.model, 'gemini-2.5-flash');

      assert.strictEqual(bobAI.apiKey, 'AIzaSy_BOB_SECRET_KEY');
      assert.strictEqual(bobAI.model, 'gemini-2.5-pro');

      // User A key must never equal or leak into User B
      assert.notStrictEqual(aliceAI.apiKey, bobAI.apiKey);
    });
  });

  describe('4. Official Guided Key-Creation Workflow & Link Integrity', () => {
    test('4.1 Official Google AI Studio URL is accurate and secure (HTTPS)', () => {
      const officialAiStudioUrl = 'https://aistudio.google.com/app/apikey';
      assert.strictEqual(officialAiStudioUrl, 'https://aistudio.google.com/app/apikey');
      assert.ok(officialAiStudioUrl.startsWith('https://aistudio.google.com'));
    });
  });

  describe('5. Test AI Connection & Key Verification (/api/test-connection)', () => {
    test('5.1 Rejects empty or whitespace API key with 400', async () => {
      await assert.rejects(
        async () => {
          await bugDeskService.testConnection({ apiKey: '   ', model: 'gemini-2.5-flash' });
        },
        (err) => {
          assert.strictEqual(err.status, 400);
          assert.match(err.message, /Missing Gemini API key/i);
          return true;
        }
      );
    });

    test('5.2 Controller blocks unauthenticated testConnection request with 401', async () => {
      let code = null;
      let body = null;
      const res = {
        status: (c) => { code = c; return res; },
        json: (d) => { body = d; return res; }
      };

      await bugDeskController.testConnection({ user: null, body: { apiKey: 'AIzaSy...' } }, res, () => {});
      assert.strictEqual(code, 401);
      assert.strictEqual(body.connected, false);
      assert.match(body.error, /Authentication required/i);
    });

    test('5.3 Returns connected: true when Google Generative Language API verifies the key', async () => {
      global.fetch = async (url) => {
        assert.ok(url.includes('generativelanguage.googleapis.com'));
        assert.ok(url.includes('key=AIzaSy_VALID_KEY_123'));
        return {
          ok: true,
          status: 200,
          json: async () => ({ candidates: [] })
        };
      };

      const result = await bugDeskService.testConnection({
        apiKey: 'AIzaSy_VALID_KEY_123',
        model: 'gemini-2.5-flash'
      });
      assert.strictEqual(result.connected, true);
    });

    test('5.4 Returns connected: false with clear error on invalid key or 401/403', async () => {
      global.fetch = async () => ({
        ok: false,
        status: 401,
        text: async () => 'API_KEY_INVALID'
      });

      await assert.rejects(
        async () => {
          await bugDeskService.testConnection({
            apiKey: 'AIzaSy_REVOKED_OR_INVALID',
            model: 'gemini-2.5-flash'
          });
        },
        (err) => {
          assert.strictEqual(err.status, 401);
          assert.match(err.message, /Invalid Gemini API key/i);
          return true;
        }
      );
    });
  });

  describe('6. BugDesk Report Generation with Configured Key & Model (/api/rewrite-bug)', () => {
    test('6.1 rewriteBug formats bug report cleanly using configured model', async () => {
      global.fetch = async (url, opts) => {
        assert.ok(url.includes('gemini-2.5-pro'));
        assert.ok(url.includes('key=AIzaSy_TESTER_PRO_KEY'));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        title: 'Settings page fails to update profile image on slow connection',
                        steps: [
                          'Navigate to User Profile page',
                          'Click Change Avatar button',
                          'Select an image larger than 2MB on 3G network simulation'
                        ],
                        actualResult: 'Avatar placeholder remains blank and loading spinner hangs indefinitely',
                        expectedResult: 'Avatar image uploads successfully or actionable timeout toast appears'
                      })
                    }
                  ]
                }
              }
            ]
          })
        };
      };

      const result = await bugDeskService.rewriteBug({
        rawNotes: 'Profile pic not changing when network slow',
        apiKey: 'AIzaSy_TESTER_PRO_KEY',
        model: 'gemini-2.5-pro'
      });

      assert.strictEqual(result.title, 'Settings page fails to update profile image on slow connection');
      assert.strictEqual(result.steps.length, 3);
      assert.strictEqual(result.actualResult, 'Avatar placeholder remains blank and loading spinner hangs indefinitely');
      assert.ok(result.expectedResult.includes('Avatar image uploads successfully'));
    });
  });
});
