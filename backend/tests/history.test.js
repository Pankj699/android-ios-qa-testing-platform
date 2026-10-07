const test = require('node:test');
const assert = require('node:assert');
const historyService = require('../src/services/historyService');

test('HistoryService stores and retrieves builds and test records', (t) => {
  const testBuild = {
    id: 'test-build-123',
    fileName: 'app-release.aab',
    packageName: 'com.qa.app',
    versionName: '2.0.0',
    versionCode: '200',
    assetPacks: [{ name: 'main_assets', deliveryType: 'fast-follow' }]
  };

  historyService.saveBuild(testBuild);
  const retrievedBuild = historyService.getBuildById('test-build-123');
  assert.strictEqual(retrievedBuild.packageName, 'com.qa.app');

  const testRun = {
    id: 'test-run-456',
    buildId: 'test-build-123',
    packageName: 'com.qa.app',
    deviceSerial: '192.168.1.100:5555',
    deviceName: 'Pixel 8',
    installMode: 'Fresh Install',
    status: 'COMPLETED',
    result: 'PASS',
    duration: '1m 20s'
  };

  historyService.saveTest(testRun);
  const retrievedTest = historyService.getTestById('test-run-456');
  assert.strictEqual(retrievedTest.result, 'PASS');

  const summary = historyService.getSummaryStats();
  assert.ok(summary.totalTests > 0);

  // Clean up test records
  historyService.deleteBuild('test-build-123');
  historyService.deleteTest('test-run-456');
});
