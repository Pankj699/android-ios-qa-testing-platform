const test = require('node:test');
const assert = require('node:assert');
const adbService = require('../src/services/adbService');

test('State-aware App Launch / Relaunch logic', async (t) => {
  const serial = 'mock_device_123';
  const packageName = 'com.example.testapp';

  // Save original execute method
  const originalExecute = adbService.execute.bind(adbService);

  // Test 1: App not installed -> fails gracefully
  adbService.execute = async (args) => {
    if (args.includes('pm') && args.includes('list')) {
      return { code: 0, stdout: 'package:com.other.app', stderr: '', raw: '' };
    }
    return { code: 0, stdout: '', stderr: '', raw: '' };
  };

  await assert.rejects(
    async () => {
      await adbService.launchApp(serial, packageName);
    },
    /is not installed on device/
  );

  // Test 2: App installed and NOT running -> launches app
  let forceStopCalled = false;
  let monkeyCalled = false;

  adbService.execute = async (args) => {
    if (args.includes('pm') && args.includes('list')) {
      return { code: 0, stdout: `package:${packageName}\n`, stderr: '', raw: '' };
    }
    if (args.includes('pidof')) {
      return { code: 1, stdout: '', stderr: '', raw: '' };
    }
    if (args.includes('ps') && args.includes('-A')) {
      return { code: 0, stdout: 'USER PID PPID VSZ RSS WCHAN ADDR S NAME\nroot 1 0 ...\n', stderr: '', raw: '' };
    }
    if (args.includes('force-stop')) {
      forceStopCalled = true;
      return { code: 0, stdout: '', stderr: '', raw: '' };
    }
    if (args.includes('monkey')) {
      monkeyCalled = true;
      return { code: 0, stdout: 'Events injected: 1', stderr: '', raw: 'Events injected: 1' };
    }
    return { code: 0, stdout: '', stderr: '', raw: '' };
  };

  const launchRes = await adbService.launchApp(serial, packageName);
  assert.strictEqual(launchRes.success, true);
  assert.strictEqual(launchRes.relaunched, false);
  assert.strictEqual(launchRes.isRunning, false);
  assert.strictEqual(launchRes.message, `Launched ${packageName}`);
  assert.strictEqual(forceStopCalled, false, 'Should not call force-stop when app is not running');
  assert.strictEqual(monkeyCalled, true, 'Should launch via monkey');

  // Test 3: App installed and ALREADY running -> force-stops and relaunches
  forceStopCalled = false;
  monkeyCalled = false;

  adbService.execute = async (args) => {
    if (args.includes('pm') && args.includes('list')) {
      return { code: 0, stdout: `package:${packageName}\n`, stderr: '', raw: '' };
    }
    if (args.includes('pidof')) {
      return { code: 0, stdout: '12345\n', stderr: '', raw: '' };
    }
    if (args.includes('force-stop')) {
      forceStopCalled = true;
      return { code: 0, stdout: '', stderr: '', raw: '' };
    }
    if (args.includes('monkey')) {
      monkeyCalled = true;
      return { code: 0, stdout: 'Events injected: 1', stderr: '', raw: 'Events injected: 1' };
    }
    return { code: 0, stdout: '', stderr: '', raw: '' };
  };

  const relaunchRes = await adbService.launchApp(serial, packageName);
  assert.strictEqual(relaunchRes.success, true);
  assert.strictEqual(relaunchRes.relaunched, true);
  assert.strictEqual(relaunchRes.isRunning, true);
  assert.strictEqual(relaunchRes.message, `Relaunched ${packageName}`);
  assert.strictEqual(forceStopCalled, true, 'Should call force-stop when app is already running');
  assert.strictEqual(monkeyCalled, true, 'Should launch again after stopping');

  // Restore original execute
  adbService.execute = originalExecute;
});

test('Clear App Cache logic', async (t) => {
  const serial = 'mock_device_123';
  const packageName = 'com.example.testapp';

  const originalExecute = adbService.execute.bind(adbService);

  // Test 1: App not installed -> fails
  adbService.execute = async (args) => {
    if (args.includes('pm') && args.includes('list')) {
      return { code: 0, stdout: 'package:com.other.app', stderr: '', raw: '' };
    }
    return { code: 0, stdout: '', stderr: '', raw: '' };
  };

  await assert.rejects(
    async () => {
      await adbService.clearAppCache(serial, packageName);
    },
    /is not installed on device/
  );

  // Test 2: App installed -> clears cache
  let trimCachesCalled = false;
  let rmCacheCalled = false;

  adbService.execute = async (args) => {
    if (args.includes('pm') && args.includes('list')) {
      return { code: 0, stdout: `package:${packageName}\n`, stderr: '', raw: '' };
    }
    if (args.includes('trim-caches')) {
      trimCachesCalled = true;
      return { code: 0, stdout: '', stderr: '', raw: '' };
    }
    if (args.includes('rm') && args.includes('-rf')) {
      rmCacheCalled = true;
      return { code: 0, stdout: '', stderr: '', raw: '' };
    }
    return { code: 0, stdout: '', stderr: '', raw: '' };
  };

  const res = await adbService.clearAppCache(serial, packageName);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.message, `Cleared cache for ${packageName}`);
  assert.strictEqual(trimCachesCalled, true, 'Should execute pm trim-caches');
  assert.strictEqual(rmCacheCalled, true, 'Should execute rm -rf for cache directories');

  adbService.execute = originalExecute;
});
