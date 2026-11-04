const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const appUserService = require('../src/services/appUserService');
const adbService = require('../src/services/adbService');
const config = require('../src/config');

describe('AppUserService & Delete App User / Credits Removal Suite', () => {
  let originalExecute;
  let originalCallApi;
  let originalClearAppData;
  let originalCheckUserCredits;

  beforeEach(() => {
    originalExecute = adbService.execute;
    originalCallApi = appUserService.callRemoveCreditsApi;
    originalClearAppData = adbService.clearAppData;
    originalCheckUserCredits = appUserService.checkUserCredits;
  });

  afterEach(() => {
    adbService.execute = originalExecute;
    appUserService.callRemoveCreditsApi = originalCallApi;
    adbService.clearAppData = originalClearAppData;
    appUserService.checkUserCredits = originalCheckUserCredits;
  });

  describe('1. Default Identifiers & Extraction from Selected Primary Device', () => {
    it('automatically extracts user_id, device_uuid, and default app_id = 2 from device files', async () => {
      // Mock adbService.execute for target device R52X808W8QK
      adbService.execute = async (args) => {
        const cmdStr = args.join(' ');
        if (cmdStr.includes('com.bg.flyermaker.xml')) {
          return {
            code: 0,
            stdout: `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <int name="onboarding_user_id" value="2048596" />
    <int name="onbaording_app_id" value="2" />
</map>`,
            stderr: ''
          };
        }
        if (cmdStr.includes('ls shared_prefs')) {
          return {
            code: 0,
            stdout: 'com.mixpanel.android.mpmetrics.MixpanelAPI_f4eb61e446ab12b9a1d2301c86a7beb0.xml\n',
            stderr: ''
          };
        }
        if (cmdStr.includes('MixpanelAPI_')) {
          return {
            code: 0,
            stdout: `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <string name="events_distinct_id">cc06494c51fab615</string>
</map>`,
            stderr: ''
          };
        }
        return { code: 0, stdout: '', stderr: '' };
      };

      const result = await appUserService.getAppUser('R52X808W8QK');

      assert.strictEqual(result.available, true);
      assert.strictEqual(result.userId, 2048596);
      assert.strictEqual(result.appId, 2);
      assert.strictEqual(result.deviceUuid, 'cc06494c51fab615');
      assert.strictEqual(result.serial, 'R52X808W8QK');
      assert.strictEqual(result.packageName, 'com.bg.flyermaker');
    });

    it('defaults app_id to 2 if not present in app preferences', async () => {
      adbService.execute = async (args) => {
        const cmdStr = args.join(' ');
        if (cmdStr.includes('com.bg.flyermaker.xml')) {
          return {
            code: 0,
            stdout: `<map><int name="onboarding_user_id" value="753743" /></map>`,
            stderr: ''
          };
        }
        if (cmdStr.includes('ls shared_prefs')) {
          return {
            code: 0,
            stdout: 'com.mixpanel.android.mpmetrics.MixpanelAPI_123.xml\n',
            stderr: ''
          };
        }
        if (cmdStr.includes('MixpanelAPI_')) {
          return {
            code: 0,
            stdout: `<map><string name="events_distinct_id">test_uuid_abc</string></map>`,
            stderr: ''
          };
        }
        return { code: 0, stdout: '', stderr: '' };
      };

      const result = await appUserService.getAppUser('DEVICE_001');

      assert.strictEqual(result.available, true);
      assert.strictEqual(result.userId, 753743);
      assert.strictEqual(result.appId, 2, 'Default app_id must be 2');
      assert.strictEqual(result.deviceUuid, 'test_uuid_abc');
    });

    it('extracts device_uuid from Crashlytics userlog if Mixpanel distinct ID is absent', async () => {
      adbService.execute = async (args) => {
        const cmdStr = args.join(' ');
        if (cmdStr.includes('com.bg.flyermaker.xml')) {
          return {
            code: 0,
            stdout: `<map><int name="onboarding_user_id" value="30001" /></map>`,
            stderr: ''
          };
        }
        if (cmdStr.includes('ls shared_prefs')) {
          return { code: 0, stdout: '', stderr: '' };
        }
        if (cmdStr.includes('userlog')) {
          return {
            code: 0,
            stdout: '"device_uuid":"crashlytics_extracted_uuid_999"',
            stderr: ''
          };
        }
        return { code: 0, stdout: '', stderr: '' };
      };

      const result = await appUserService.getAppUser('DEV_CRASH');

      assert.strictEqual(result.available, true);
      assert.strictEqual(result.userId, 30001);
      assert.strictEqual(result.deviceUuid, 'crashlytics_extracted_uuid_999');
    });

    it('returns available: false with an explanatory reason if app user is not initialized', async () => {
      adbService.execute = async () => ({
        code: 1,
        stdout: '',
        stderr: 'run-as: package not debuggable or not found'
      });

      const result = await appUserService.getAppUser('DEV_EMPTY');

      assert.strictEqual(result.available, false);
      assert.strictEqual(result.userId, null);
      assert.strictEqual(result.appId, 2);
      assert.ok(result.reason.includes('Could not extract') || result.reason.includes('Failed to read'));
    });
  });

  describe('2. Multi-Device Isolation & Stale Identifier Prevention', () => {
    it('guarantees device isolation: Device A and Device B return their own distinct identifiers', async () => {
      adbService.execute = async (args) => {
        const serialIdx = args.indexOf('-s');
        const serial = serialIdx !== -1 ? args[serialIdx + 1] : '';

        if (serial === 'DEVICE_A') {
          if (args.join(' ').includes('com.bg.flyermaker.xml')) {
            return {
              code: 0,
              stdout: `<map><int name="onboarding_user_id" value="10001" /></map>`,
              stderr: ''
            };
          }
          if (args.join(' ').includes('MixpanelAPI_')) {
            return {
              code: 0,
              stdout: `<map><string name="events_distinct_id">uuid_device_a</string></map>`,
              stderr: ''
            };
          }
        } else if (serial === 'DEVICE_B') {
          if (args.join(' ').includes('com.bg.flyermaker.xml')) {
            return {
              code: 0,
              stdout: `<map><int name="onboarding_user_id" value="20002" /></map>`,
              stderr: ''
            };
          }
          if (args.join(' ').includes('MixpanelAPI_')) {
            return {
              code: 0,
              stdout: `<map><string name="events_distinct_id">uuid_device_b</string></map>`,
              stderr: ''
            };
          }
        }
        if (args.join(' ').includes('ls shared_prefs')) {
          return { code: 0, stdout: 'com.mixpanel.android.mpmetrics.MixpanelAPI_test.xml\n', stderr: '' };
        }
        return { code: 0, stdout: '', stderr: '' };
      };

      const devA = await appUserService.getAppUser('DEVICE_A');
      const devB = await appUserService.getAppUser('DEVICE_B');

      assert.strictEqual(devA.userId, 10001);
      assert.strictEqual(devA.deviceUuid, 'uuid_device_a');

      assert.strictEqual(devB.userId, 20002);
      assert.strictEqual(devB.deviceUuid, 'uuid_device_b');

      assert.notStrictEqual(devA.userId, devB.userId, 'Device A and Device B user IDs must never mix');
      assert.notStrictEqual(devA.deviceUuid, devB.deviceUuid, 'Device A and Device B device UUIDs must never mix');
    });
  });

  describe('3. Validation, Upstream Request & Error Handling', () => {
    it('submits confirmed final values to flyerbuilder removeCredits endpoint', async () => {
      let capturedPayload = null;

      appUserService.callRemoveCreditsApi = async (payload) => {
        capturedPayload = payload;
        return {
          status: 200,
          code: 200,
          message: 'Credits removed successfully',
          data: {}
        };
      };

      const result = await appUserService.deleteAppUser('R52X808W8QK', {
        userId: 2048596,
        appId: 2,
        deviceUuid: 'cc06494c51fab615',
        clearLocalData: false
      });

      assert.deepStrictEqual(capturedPayload, {
        userId: 2048596,
        deviceUuid: 'cc06494c51fab615',
        appId: 2
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.message, 'Credits removed successfully');
      assert.strictEqual(result.localDataCleared, false, 'pm clear must not run automatically');
    });

    it('supports manually edited identifiers and positive integers', async () => {
      let capturedPayload = null;

      appUserService.callRemoveCreditsApi = async (payload) => {
        capturedPayload = payload;
        return {
          status: 200,
          code: 200,
          message: 'Credits removed successfully'
        };
      };

      // User manually edited values: userId=99999, appId=5, deviceUuid=custom_uuid_xyz
      await appUserService.deleteAppUser('R52X808W8QK', {
        userId: '99999',
        appId: '5',
        deviceUuid: 'custom_uuid_xyz',
        clearLocalData: false
      });

      assert.strictEqual(capturedPayload.userId, 99999);
      assert.strictEqual(capturedPayload.appId, 5);
      assert.strictEqual(capturedPayload.deviceUuid, 'custom_uuid_xyz');
    });

    it('rejects invalid or missing User ID with 400 Bad Request', async () => {
      await assert.rejects(
        async () => {
          await appUserService.deleteAppUser('R52X808W8QK', {
            userId: 'invalid_non_numeric',
            appId: 2,
            deviceUuid: 'cc06494c51fab615'
          });
        },
        (err) => err.status === 400 && err.message.includes('User ID must be a positive integer')
      );

      await assert.rejects(
        async () => {
          await appUserService.deleteAppUser('R52X808W8QK', {
            userId: 0,
            appId: 2,
            deviceUuid: 'cc06494c51fab615'
          });
        },
        (err) => err.status === 400
      );
    });

    it('rejects invalid or missing App ID with 400 Bad Request', async () => {
      await assert.rejects(
        async () => {
          await appUserService.deleteAppUser('R52X808W8QK', {
            userId: 2048596,
            appId: -1,
            deviceUuid: 'cc06494c51fab615'
          });
        },
        (err) => err.status === 400 && err.message.includes('App ID must be a positive integer')
      );
    });

    it('rejects missing Device UUID with 400 Bad Request', async () => {
      await assert.rejects(
        async () => {
          await appUserService.deleteAppUser('R52X808W8QK', {
            userId: 2048596,
            appId: 2,
            deviceUuid: '   '
          });
        },
        (err) => err.status === 400 && err.message.includes('Device UUID is required')
      );
    });

    it('executes pm clear ONLY when explicitly requested (clearLocalData: true)', async () => {
      let clearCalledWith = null;
      adbService.clearAppData = async (serial, pkg) => {
        clearCalledWith = { serial, pkg };
        return { success: true };
      };

      appUserService.callRemoveCreditsApi = async () => ({
        status: 200,
        code: 200,
        message: 'Credits removed successfully'
      });

      const res = await appUserService.deleteAppUser('R52X808W8QK', {
        userId: 2048596,
        appId: 2,
        deviceUuid: 'cc06494c51fab615',
        clearLocalData: true,
        packageName: 'com.bg.flyermaker'
      });

      assert.strictEqual(res.localDataCleared, true);
      assert.deepStrictEqual(clearCalledWith, {
        serial: 'R52X808W8QK',
        pkg: 'com.bg.flyermaker'
      });
    });

    it('configures FLYERBUILDER_TIMEOUT_MS default to at least 45000ms', () => {
      assert.ok(config.FLYERBUILDER_TIMEOUT_MS >= 45000, `Expected at least 45000ms, got ${config.FLYERBUILDER_TIMEOUT_MS}`);
    });

    it('recovers from upstream timeout if read-only status check verifies credits removed (total_credits = 0)', async () => {
      let removeCalls = 0;
      let checkCalls = 0;

      appUserService.callRemoveCreditsApi = async () => {
        removeCalls++;
        const error = new Error('Request to flyerbuilder.app timed out after 45s. The upstream operation may have completed; please verify credit and account status before retrying.');
        error.status = 504;
        error.code = 'UPSTREAM_TIMEOUT';
        throw error;
      };

      appUserService.checkUserCredits = async ({ userId, deviceUuid, appId }) => {
        checkCalls++;
        return {
          success: true,
          statusCode: 200,
          totalCredits: 0,
          data: { total_credits: 0, subscription_balance: 0, topup_balance: 0 }
        };
      };

      const res = await appUserService.deleteAppUser('R52X808W8QK', {
        userId: 2048596,
        appId: 2,
        deviceUuid: 'cc06494c51fab615',
        clearLocalData: false
      });

      assert.strictEqual(removeCalls, 1, 'Must not retry removeCredits upstream call');
      assert.strictEqual(checkCalls, 1, 'Must run verification status check');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.verifiedViaStatusCheck, true);
      assert.ok(res.message.includes('verified via account status check'));
    });

    it('marks outcomeUnknown = true and prevents pm clear when upstream times out and status check cannot confirm credit removal', async () => {
      let removeCalls = 0;
      let clearCalls = 0;

      appUserService.callRemoveCreditsApi = async () => {
        removeCalls++;
        const error = new Error('Request to flyerbuilder.app timed out after 45s. The upstream operation may have completed; please verify credit and account status before retrying.');
        error.status = 504;
        error.code = 'UPSTREAM_TIMEOUT';
        throw error;
      };

      appUserService.checkUserCredits = async () => {
        return {
          success: false,
          error: 'Verification request timed out'
        };
      };

      adbService.clearAppData = async () => {
        clearCalls++;
        return { success: true };
      };

      await assert.rejects(
        async () => {
          await appUserService.deleteAppUser('R52X808W8QK', {
            userId: 2048596,
            appId: 2,
            deviceUuid: 'cc06494c51fab615',
            clearLocalData: true // User requested local clear, but it MUST be aborted
          });
        },
        (err) => {
          assert.strictEqual(err.status, 504);
          assert.strictEqual(err.outcomeUnknown, true);
          assert.ok(err.message.includes('Do not resubmit'));
          return true;
        }
      );

      assert.strictEqual(removeCalls, 1, 'Must not retry removeCredits upstream call');
      assert.strictEqual(clearCalls, 0, 'Never run pm clear automatically as part of timeout recovery');
    });
  });
});
