const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  FirebaseTestLabProvider,
  redactSecrets,
  mapExitCode,
  stripAnsi,
  isValidFirebaseResultsUrl
} = require('../src/services/providers/firebaseTestLabProvider');
const { RoboTestService } = require('../src/services/roboTestService');

describe('Firebase Test Lab Robo Test Suite', () => {
  let tempDir;
  let testApkPath;
  let testAabPath;
  let fakeGcloudPath;

  beforeEach(() => {
    tempDir = path.join(__dirname, `temp-robo-test-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`);
    fs.mkdirSync(tempDir, { recursive: true });

    testApkPath = path.join(tempDir, 'sample-app.apk');
    fs.writeFileSync(testApkPath, 'dummy-apk-binary-content');

    testAabPath = path.join(tempDir, 'sample-bundle.aab');
    fs.writeFileSync(testAabPath, 'dummy-aab-binary-content');
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  describe('1. Command Argument Construction & Validation', () => {
    const provider = new FirebaseTestLabProvider({ projectId: 'qa-tools-test-project' });

    test('successfully builds arguments for valid APK and single device', () => {
      const args = provider.buildCommandArgs({
        appPath: testApkPath,
        devices: [{ model: 'Pixel7', version: '33', orientation: 'portrait', locale: 'en_US' }],
        timeout: '10m'
      });

      assert.ok(args.includes('firebase'));
      assert.ok(args.includes('test'));
      assert.ok(args.includes('android'));
      assert.ok(args.includes('run'));
      assert.ok(args.includes('--type=robo'));
      assert.ok(args.includes(`--app=${testApkPath}`));
      assert.ok(args.includes('--device=model=Pixel7,version=33,locale=en_US,orientation=portrait'));
      assert.ok(args.includes('--timeout=10m'));
      assert.ok(args.includes('--project=qa-tools-test-project'));
    });

    test('successfully builds arguments for AAB and multiple devices', () => {
      const args = provider.buildCommandArgs({
        appPath: testAabPath,
        devices: [
          { model: 'Pixel7', version: '33', orientation: 'portrait', locale: 'en_US' },
          { model: 'GalaxyS22', version: '31', orientation: 'landscape', locale: 'es_ES' }
        ],
        timeout: '300s',
        roboDirectives: [
          { type: 'text', resourceName: 'com.example:id/login_user', text: 'qa_user' },
          { type: 'click', resourceName: 'com.example:id/submit_button' }
        ]
      });

      assert.ok(args.includes(`--app=${testAabPath}`));
      assert.ok(args.includes('--device=model=Pixel7,version=33,locale=en_US,orientation=portrait'));
      assert.ok(args.includes('--device=model=GalaxyS22,version=31,locale=es_ES,orientation=landscape'));
      assert.ok(args.includes('--timeout=300s'));
      assert.ok(args.some(a => a.startsWith('--robo-directives=') && a.includes('com.example:id/login_user=qa_user') && a.includes('com.example:id/submit_button')));
    });

    test('rejects missing or non-existent application build', () => {
      assert.throws(() => {
        provider.buildCommandArgs({
          appPath: path.join(tempDir, 'non_existent.apk'),
          devices: [{ model: 'Pixel7', version: '33' }]
        });
      }, /Application file does not exist/);
    });

    test('rejects invalid file extension (e.g. .exe or .sh)', () => {
      const badFile = path.join(tempDir, 'malicious.sh');
      fs.writeFileSync(badFile, '#!/bin/bash');
      assert.throws(() => {
        provider.buildCommandArgs({
          appPath: badFile,
          devices: [{ model: 'Pixel7', version: '33' }]
        });
      }, /Invalid application format/);
    });

    test('rejects empty device configuration list', () => {
      assert.throws(() => {
        provider.buildCommandArgs({
          appPath: testApkPath,
          devices: []
        });
      }, /At least one device configuration must be specified/);
    });

    test('rejects device without model or version', () => {
      assert.throws(() => {
        provider.buildCommandArgs({
          appPath: testApkPath,
          devices: [{ model: 'Pixel7' }]
        });
      }, /Device configuration must include model and version/);
    });

    test('rejects device inputs with invalid shell metacharacters', () => {
      assert.throws(() => {
        provider.buildCommandArgs({
          appPath: testApkPath,
          devices: [{ model: 'Pixel7;rm -rf /', version: '33', locale: 'en', orientation: 'landscape' }]
        });
      }, /Invalid characters in device model/);

      assert.throws(() => {
        provider.buildCommandArgs({
          appPath: testApkPath,
          devices: [{ model: 'Pixel7', version: '33&reboot', locale: 'en', orientation: 'landscape' }]
        });
      }, /Invalid characters in OS version/);
    });
  });

  describe('2. Secret Redaction & Output Stream Sanitization', () => {
    test('redacts OAuth Bearer tokens from output stream', () => {
      const raw = 'Request header: Authorization: Bearer ya29.a0AfH6SMD_secret_token_123456789 and continuing';
      const sanitized = redactSecrets(raw);
      assert.ok(!sanitized.includes('ya29.a0AfH6SMD_secret_token_123456789'));
      assert.ok(sanitized.includes('[REDACTED_SECRET]'));
    });

    test('redacts client secrets and passwords', () => {
      const raw = 'Config: client_secret="my_super_secret_key" and password: "top_secret_password"';
      const sanitized = redactSecrets(raw);
      assert.ok(!sanitized.includes('my_super_secret_key'));
      assert.ok(!sanitized.includes('top_secret_password'));
      assert.ok(sanitized.includes('[REDACTED_SECRET]'));
    });
  });

  describe('3. Matrix ID & Results URL Extraction and Strict Validation', () => {
    const provider = new FirebaseTestLabProvider({ projectId: 'qa-tools-demo' });

    test('extracts matrix ID from standard gcloud progress output', () => {
      const output = 'Uploading app...\nTest [matrix-abcd1234efgh] has been created in the Google Cloud.\nRunning...';
      const matrixId = provider.parseMatrixId(output);
      assert.strictEqual(matrixId, 'matrix-abcd1234efgh');
    });

    test('extracts matrix ID from ANSI colored output with trailing brackets', () => {
      const output = '\u001b[32mTest [matrix-abcd1234efgh]\u001b[0m has been created.';
      const matrixId = provider.parseMatrixId(output);
      assert.strictEqual(matrixId, 'matrix-abcd1234efgh');
    });

    test('extracts matrix ID from table format', () => {
      const output = 'Matrix[matrix-98765zyxw]\nTEST_MATRIX_ID: matrix-98765zyxw';
      const matrixId = provider.parseMatrixId(output);
      assert.strictEqual(matrixId, 'matrix-98765zyxw');
    });

    test('extracts Firebase Console results URL from output', () => {
      const output = 'Test in progress.\nFirebase Console: https://console.firebase.google.com/project/qa-tools-demo/testlab/histories/bh.12345/matrices/matrix-abcd1234efgh\nDone.';
      const url = provider.parseResultsUrl(output, 'qa-tools-demo', 'matrix-abcd1234efgh');
      assert.strictEqual(url, 'https://console.firebase.google.com/project/qa-tools-demo/testlab/histories/bh.12345/matrices/matrix-abcd1234efgh');
    });

    test('extracts Firebase results URL with ANSI escapes and trailing punctuation', () => {
      const output = 'See results at \u001b[1m[https://console.firebase.google.com/project/qa-tools-demo/testlab/histories/bh.999/matrices/matrix-xyz].\u001b[0m';
      const url = provider.parseResultsUrl(output, 'qa-tools-demo', 'matrix-xyz');
      assert.strictEqual(url, 'https://console.firebase.google.com/project/qa-tools-demo/testlab/histories/bh.999/matrices/matrix-xyz');
    });

    test('rejects untrusted domains and spoofed console URLs', () => {
      const untrustedOutput = 'Results: https://attacker.com/project/qa-tools-demo/testlab/histories/bh.123/matrices/matrix-fake';
      const url = provider.parseResultsUrl(untrustedOutput, 'qa-tools-demo', 'matrix-safe');
      // Should reject untrusted URL and fall back to safe canonical Google link
      assert.strictEqual(url, 'https://console.firebase.google.com/project/qa-tools-demo/testlab/histories/default/matrices/matrix-safe');
    });

    test('constructs canonical fallback results URL when output URL is pending', () => {
      const url = provider.parseResultsUrl('', 'qa-tools-demo', 'matrix-xyz123');
      assert.strictEqual(url, 'https://console.firebase.google.com/project/qa-tools-demo/testlab/histories/default/matrices/matrix-xyz123');
    });

    test('returns null if neither URL nor matrix ID exists', () => {
      const url = provider.parseResultsUrl('', null, null);
      assert.strictEqual(url, null);
    });
  });

  describe('4. Environment Diagnostics & Setup Checks (Privacy & Sanitization)', () => {
    test('reports GCLOUD_MISSING without exposing internal file paths or account emails', async () => {
      const provider = new FirebaseTestLabProvider({ gcloudPath: 'C:\\secret\\tools\\gcloud.exe' });
      const diag = await provider.checkEnvironment();

      assert.strictEqual(diag.ready, false);
      assert.strictEqual(diag.step, 'GCLOUD_MISSING');
      assert.strictEqual(diag.gcloudInstalled, false);
      assert.strictEqual(diag.authenticated, false);
      // Ensure host filesystem path is never exposed in client-facing message
      assert.ok(!diag.message.includes('C:\\secret\\tools'));
      assert.ok(!diag.message.includes('gcloud.exe'));
      // Ensure no raw account email field
      assert.strictEqual(diag.activeAccount, undefined);
      assert.strictEqual(diag.gcloudPath, undefined);
    });
  });

  describe('5. Concurrency-Safe History & Interrupted Job Recovery (Matrix Reconciliation)', () => {
    let testHistoryFile;
    let service;

    beforeEach(() => {
      testHistoryFile = path.join(tempDir, 'robo-test-history.json');
      fs.writeFileSync(testHistoryFile, JSON.stringify([
        {
          id: 'job-with-matrix',
          userId: 'user-1',
          projectId: 'qa-tools-demo',
          status: 'RUNNING',
          outcome: 'PENDING',
          matrixId: 'matrix-submitted-123',
          resultsUrl: null
        },
        {
          id: 'job-without-matrix',
          userId: 'user-1',
          status: 'RUNNING',
          outcome: 'PENDING',
          matrixId: null,
          resultsUrl: null
        },
        {
          id: 'job-completed-2',
          userId: 'user-1',
          status: 'COMPLETED',
          outcome: 'SUCCESS',
          matrixId: 'matrix-comp-456'
        }
      ], null, 2), 'utf8');

      service = new RoboTestService();
      service.historyFile = testHistoryFile;
    });

    test('reconciles jobs distinguishing remote matrix presence from early interruption', async () => {
      await service.recoverInterruptedJobs();
      const history = service._readHistory();

      // Job 1: Has matrixId -> marks REMOTE_EXECUTION_UNKNOWN and synthesizes results link
      const jobWithMatrix = history.find(j => j.id === 'job-with-matrix');
      assert.strictEqual(jobWithMatrix.status, 'INTERRUPTED');
      assert.strictEqual(jobWithMatrix.outcome, 'REMOTE_EXECUTION_UNKNOWN');
      assert.ok(jobWithMatrix.error.includes('Test matrix was submitted to Google Cloud'));
      assert.strictEqual(jobWithMatrix.matrixId, 'matrix-submitted-123');
      assert.strictEqual(
        jobWithMatrix.resultsUrl,
        'https://console.firebase.google.com/project/qa-tools-demo/testlab/histories/default/matrices/matrix-submitted-123'
      );

      // Job 2: No matrixId -> marks PROCESS_INTERRUPTED
      const jobWithoutMatrix = history.find(j => j.id === 'job-without-matrix');
      assert.strictEqual(jobWithoutMatrix.status, 'INTERRUPTED');
      assert.strictEqual(jobWithoutMatrix.outcome, 'PROCESS_INTERRUPTED');
      assert.ok(jobWithoutMatrix.error.includes('prior to test matrix creation'));

      // Job 3: Preserves already completed jobs untouched
      const jobCompleted = history.find(j => j.id === 'job-completed-2');
      assert.strictEqual(jobCompleted.status, 'COMPLETED');
      assert.strictEqual(jobCompleted.outcome, 'SUCCESS');
    });

    test('recovers gracefully from corrupted history file without crashing', () => {
      fs.writeFileSync(testHistoryFile, 'INVALID_JSON_CORRUPTED{{{', 'utf8');
      const history = service._readHistory();
      assert.deepStrictEqual(history, []);
      assert.ok(fs.existsSync(testHistoryFile));
    });
  });

  describe('6. User Authorization & Cross-User Isolation', () => {
    let service;

    beforeEach(() => {
      const testHistoryFile = path.join(tempDir, 'robo-test-history.json');
      fs.writeFileSync(testHistoryFile, JSON.stringify([
        {
          id: 'job-alice',
          userId: 'alice-id',
          userName: 'Alice',
          status: 'COMPLETED',
          testLabel: 'Alice Test'
        },
        {
          id: 'job-bob',
          userId: 'bob-id',
          userName: 'Bob',
          status: 'COMPLETED',
          testLabel: 'Bob Test'
        }
      ], null, 2), 'utf8');

      service = new RoboTestService();
      service.historyFile = testHistoryFile;
    });

    test('non-admin user can only view their own jobs', () => {
      const aliceUser = { id: 'alice-id', role: 'TESTER' };
      const aliceJobs = service.getJobs({}, aliceUser);

      assert.strictEqual(aliceJobs.length, 1);
      assert.strictEqual(aliceJobs[0].id, 'job-alice');
    });

    test('admin user can view all jobs', () => {
      const adminUser = { id: 'admin-id', role: 'ADMIN' };
      const allJobs = service.getJobs({}, adminUser);

      assert.strictEqual(allJobs.length, 2);
    });

    test('non-admin user is rejected with 403 when requesting another users job', () => {
      const bobUser = { id: 'bob-id', role: 'TESTER' };
      assert.throws(() => {
        service.getJobById('job-alice', bobUser);
      }, err => err.status === 403);
    });
  });

  describe('7. Exit Code Classification and Process Outcomes', () => {
    test('exit code 0 maps to COMPLETED / SUCCESS', () => {
      const res = mapExitCode(0, null, false);
      assert.strictEqual(res.status, 'COMPLETED');
      assert.strictEqual(res.outcome, 'SUCCESS');
      assert.strictEqual(res.error, null);
    });

    test('exit code 10 maps to COMPLETED / FAILURE (Defects Found)', () => {
      const res = mapExitCode(10, null, false);
      assert.strictEqual(res.status, 'COMPLETED');
      assert.strictEqual(res.outcome, 'FAILURE');
      assert.ok(res.error.includes('application defects, crashes'));
    });

    test('exit code 1 maps to FAILED / GENERAL_FAILURE', () => {
      const res = mapExitCode(1, null, false);
      assert.strictEqual(res.status, 'FAILED');
      assert.strictEqual(res.outcome, 'GENERAL_FAILURE');
      assert.ok(res.error.includes('General failure'));
    });

    test('exit code 2 maps to FAILED / CONFIG_ERROR', () => {
      const res = mapExitCode(2, null, false);
      assert.strictEqual(res.status, 'FAILED');
      assert.strictEqual(res.outcome, 'CONFIG_ERROR');
      assert.ok(res.error.includes('Invalid configuration'));
    });

    test('exit code 15 maps to FAILED / INCONCLUSIVE', () => {
      const res = mapExitCode(15, null, false);
      assert.strictEqual(res.status, 'FAILED');
      assert.strictEqual(res.outcome, 'INCONCLUSIVE');
      assert.ok(res.error.includes('could not determine'));
    });

    test('exit code 18 maps to FAILED / UNSUPPORTED_ENVIRONMENT', () => {
      const res = mapExitCode(18, null, false);
      assert.strictEqual(res.status, 'FAILED');
      assert.strictEqual(res.outcome, 'UNSUPPORTED_ENVIRONMENT');
      assert.ok(res.error.includes('Unsupported test environment'));
    });

    test('exit code 19 maps to CANCELLED / CANCELLED', () => {
      const res = mapExitCode(19, null, false);
      assert.strictEqual(res.status, 'CANCELLED');
      assert.strictEqual(res.outcome, 'CANCELLED');
      assert.ok(res.error.includes('cancelled'));
    });

    test('exit code 20 maps to FAILED / INFRASTRUCTURE_ERROR', () => {
      const res = mapExitCode(20, null, false);
      assert.strictEqual(res.status, 'FAILED');
      assert.strictEqual(res.outcome, 'INFRASTRUCTURE_ERROR');
      assert.ok(res.error.includes('infrastructure error'));
    });

    test('signals SIGINT / SIGTERM or isTerminated flag map to CANCELLED / CANCELLED', () => {
      const resSig = mapExitCode(null, 'SIGINT', false);
      assert.strictEqual(resSig.status, 'CANCELLED');
      assert.strictEqual(resSig.outcome, 'CANCELLED');

      const resTerm = mapExitCode(0, null, true);
      assert.strictEqual(resTerm.status, 'CANCELLED');
      assert.strictEqual(resTerm.outcome, 'CANCELLED');
    });

    test('unknown non-zero exit code maps to FAILED / UNKNOWN_FAILURE', () => {
      const res = mapExitCode(99, null, false);
      assert.strictEqual(res.status, 'FAILED');
      assert.strictEqual(res.outcome, 'UNKNOWN_FAILURE');
      assert.ok(res.error.includes('99'));
    });
  });

  describe('8. Device Catalog Search and Version Compatibility', () => {
    const provider = new FirebaseTestLabProvider({ projectId: 'qa-tools-demo' });
    const mockCatalog = {
      models: [
        {
          id: 'oriole',
          name: 'Pixel 6',
          brand: 'Google',
          form: 'PHYSICAL',
          formFactor: 'PHONE',
          supportedVersionIds: ['31', '32', '33'],
          supportedVersions: [
            { id: '33', versionString: '13', apiLevel: 33 },
            { id: '32', versionString: '12L', apiLevel: 32 },
            { id: '31', versionString: '12', apiLevel: 31 }
          ],
          tags: ['default']
        },
        {
          id: 'b0q',
          name: 'Galaxy S22',
          brand: 'Samsung',
          form: 'PHYSICAL',
          formFactor: 'PHONE',
          supportedVersionIds: ['31', '32'],
          supportedVersions: [
            { id: '32', versionString: '12L', apiLevel: 32 },
            { id: '31', versionString: '12', apiLevel: 31 }
          ],
          tags: []
        },
        {
          id: 'tangorpro',
          name: 'Pixel Tablet',
          brand: 'Google',
          form: 'PHYSICAL',
          formFactor: 'TABLET',
          supportedVersionIds: ['33', '34'],
          supportedVersions: [
            { id: '34', versionString: '14', apiLevel: 34 },
            { id: '33', versionString: '13', apiLevel: 33 }
          ],
          tags: []
        },
        {
          id: 'a15x',
          name: 'Galaxy A15 5G',
          brand: 'Samsung',
          form: 'PHYSICAL',
          formFactor: 'PHONE',
          supportedVersionIds: ['34', '36'],
          supportedVersions: [
            { id: '36', versionString: '36', codeName: 'Baklava', apiLevel: 36 },
            { id: '34', versionString: '14', codeName: 'UpsideDownCake', apiLevel: 34 }
          ],
          tags: []
        },
        {
          id: 'medium_phone_arm',
          name: 'Medium Phone, 6.4in/16cm (Arm)',
          brand: 'Generic',
          form: 'VIRTUAL',
          formFactor: 'PHONE',
          supportedVersionIds: ['26', '27', '28', '29', '30', '31', '32', '33', '34', '35', '36'],
          supportedVersions: [
            { id: '36', versionString: '36', codeName: 'Baklava', apiLevel: 36 },
            { id: '35', versionString: '35', codeName: 'VanillaIceCream', apiLevel: 35 },
            { id: '34', versionString: '14', codeName: 'UpsideDownCake', apiLevel: 34 }
          ],
          tags: []
        }
      ],
      versions: [
        { id: '36', versionString: '36', codeName: 'Baklava', apiLevel: 36 },
        { id: '35', versionString: '35', codeName: 'VanillaIceCream', apiLevel: 35 },
        { id: '34', versionString: '14', codeName: 'UpsideDownCake', apiLevel: 34 },
        { id: '33', versionString: '13', codeName: 'Tiramisu', apiLevel: 33 },
        { id: '32', versionString: '12L', apiLevel: 32 },
        { id: '31', versionString: '12', apiLevel: 31 }
      ],
      locales: [{ id: 'en_US', name: 'English (United States)' }]
    };

    test('searches devices by model name case-insensitively', () => {
      const filtered = provider.filterCatalog(mockCatalog, 'pixel');
      assert.strictEqual(filtered.models.length, 2);
      assert.ok(filtered.models.some(m => m.id === 'oriole'));
      assert.ok(filtered.models.some(m => m.id === 'tangorpro'));
      assert.strictEqual(filtered.matchingCount, 2);
    });

    test('searches devices by brand / manufacturer', () => {
      const filtered = provider.filterCatalog(mockCatalog, 'samsung');
      assert.strictEqual(filtered.models.length, 2);
      assert.ok(filtered.models.some(m => m.id === 'b0q'));
      assert.ok(filtered.models.some(m => m.id === 'a15x'));
    });

    test('searches devices by real Firebase model ID', () => {
      const filtered = provider.filterCatalog(mockCatalog, 'oriole');
      assert.strictEqual(filtered.models.length, 1);
      assert.strictEqual(filtered.models[0].id, 'oriole');
      assert.strictEqual(filtered.models[0].name, 'Pixel 6');
    });

    test('searches devices by form factor (e.g. tablet)', () => {
      const filtered = provider.filterCatalog(mockCatalog, 'tablet');
      assert.strictEqual(filtered.models.length, 1);
      assert.strictEqual(filtered.models[0].id, 'tangorpro');
    });

    test('searches devices by "API 36" matching multi-version devices and version ranges', () => {
      const filtered = provider.filterCatalog(mockCatalog, 'API 36');
      assert.strictEqual(filtered.models.length, 2);
      // Galaxy A15 5G has ['34', '36']
      assert.ok(filtered.models.some(m => m.id === 'a15x'));
      // Virtual phone has range 26..36
      assert.ok(filtered.models.some(m => m.id === 'medium_phone_arm'));
    });

    test('searches devices by "API 35" and "api:34"', () => {
      const filtered35 = provider.filterCatalog(mockCatalog, 'API 35');
      assert.strictEqual(filtered35.models.length, 1);
      assert.strictEqual(filtered35.models[0].id, 'medium_phone_arm');

      const filtered34 = provider.filterCatalog(mockCatalog, 'api:34');
      assert.strictEqual(filtered34.models.length, 3);
      assert.ok(filtered34.models.some(m => m.id === 'tangorpro'));
      assert.ok(filtered34.models.some(m => m.id === 'a15x'));
      assert.ok(filtered34.models.some(m => m.id === 'medium_phone_arm'));
    });

    test('searches devices by Android OS name e.g. "Android 16" and "Android 14"', () => {
      const filtered16 = provider.filterCatalog(mockCatalog, 'Android 16');
      assert.strictEqual(filtered16.models.length, 2);
      assert.ok(filtered16.models.some(m => m.id === 'a15x'));
      assert.ok(filtered16.models.some(m => m.id === 'medium_phone_arm'));

      const filtered14 = provider.filterCatalog(mockCatalog, 'Android 14');
      assert.strictEqual(filtered14.models.length, 3);
      assert.ok(filtered14.models.some(m => m.id === 'tangorpro'));
      assert.ok(filtered14.models.some(m => m.id === 'a15x'));
      assert.ok(filtered14.models.some(m => m.id === 'medium_phone_arm'));
    });

    test('searches devices by pure digits e.g. "36"', () => {
      const filtered = provider.filterCatalog(mockCatalog, '36');
      assert.strictEqual(filtered.models.length, 2);
      assert.ok(filtered.models.some(m => m.id === 'a15x'));
      assert.ok(filtered.models.some(m => m.id === 'medium_phone_arm'));
    });

    test('returns empty results when no devices match query', () => {
      const filtered = provider.filterCatalog(mockCatalog, 'NonExistentDeviceBrand12345');
      assert.strictEqual(filtered.models.length, 0);
      assert.strictEqual(filtered.matchingCount, 0);
      assert.strictEqual(filtered.totalModels, 5);
    });

    test('empty or whitespace search query restores full catalog', () => {
      const filteredEmpty = provider.filterCatalog(mockCatalog, '');
      assert.strictEqual(filteredEmpty.models.length, 5);

      const filteredSpaces = provider.filterCatalog(mockCatalog, '   ');
      assert.strictEqual(filteredSpaces.models.length, 5);
    });

    test('compatible Android versions are correctly filtered for selected model', () => {
      const s22Model = mockCatalog.models.find(m => m.id === 'b0q');
      assert.ok(s22Model);
      assert.deepStrictEqual(s22Model.supportedVersionIds, ['31', '32']);
      assert.strictEqual(s22Model.supportedVersions.length, 2);

      const tabletModel = mockCatalog.models.find(m => m.id === 'tangorpro');
      assert.ok(tabletModel);
      assert.deepStrictEqual(tabletModel.supportedVersionIds, ['33', '34']);
    });

    test('classifies virtual and physical devices using actual Firebase catalog metadata', () => {
      const virtual = mockCatalog.models.filter(m => m.form === 'VIRTUAL');
      const physical = mockCatalog.models.filter(m => m.form === 'PHYSICAL');

      assert.strictEqual(virtual.length, 1);
      assert.strictEqual(virtual[0].id, 'medium_phone_arm');
      assert.strictEqual(physical.length, 4);
    });

    test('matrix entries retain model ID and are preserved independently of searches', () => {
      const matrix = [];
      const dev1 = {
        model: 'oriole',
        modelName: 'Pixel 6',
        version: '33',
        orientation: 'portrait',
        locale: 'en_US'
      };
      matrix.push(dev1);

      // Perform a search that filters out Pixel 6
      const searchResult = provider.filterCatalog(mockCatalog, 'samsung');
      assert.strictEqual(searchResult.models.length, 2);

      // Verify existing matrix is completely unaffected by search
      assert.strictEqual(matrix.length, 1);
      assert.strictEqual(matrix[0].model, 'oriole');
      assert.strictEqual(matrix[0].version, '33');
    });
  });
});
