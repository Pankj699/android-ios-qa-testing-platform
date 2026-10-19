const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const adbService = require('../src/services/adbService');
const deviceController = require('../src/controllers/deviceController');
const deviceLockService = require('../src/services/deviceLockService');
const { formatDeviceOsVersion, formatDeviceDisplayName } = require('../src/utils/deviceFormatter');

describe('Phase 3: Device Metadata & Telemetry Stability Suite', () => {
  const tabletSerial = 'R9PT1027R5Y';
  const tabletHwSerial = 'R9PT1027R5Y';
  const testUser = { id: 'usr_qa_pankaj', name: 'Pankaj Gupta', email: 'pankajgupta.ob@gmail.com', role: 'tester' };

  let origExecute;

  beforeEach(() => {
    origExecute = adbService.execute;
    // Clear caches for clean test isolation
    if (adbService._deviceMetaCache) adbService._deviceMetaCache.clear();
    if (adbService._deviceTelemetryCache) adbService._deviceTelemetryCache.clear();
    if (adbService._hardwareSerialCache) adbService._hardwareSerialCache.clear();
  });

  afterEach(() => {
    adbService.execute = origExecute;
    if (adbService._deviceMetaCache) adbService._deviceMetaCache.clear();
    if (adbService._deviceTelemetryCache) adbService._deviceTelemetryCache.clear();
    if (adbService._hardwareSerialCache) adbService._hardwareSerialCache.clear();
  });

  test('1. Metadata & Telemetry Extraction: getDeviceInfo populates OS, battery, storage, and screen resolution', async () => {
    adbService.execute = async (args) => {
      const cmd = args.join(' ');
      if (cmd.includes('ro.product.manufacturer')) return { code: 0, stdout: 'samsung\n' };
      if (cmd.includes('ro.product.model')) return { code: 0, stdout: 'SM-X200\n' };
      if (cmd.includes('ro.build.version.release')) return { code: 0, stdout: '13\n' };
      if (cmd.includes('ro.build.version.sdk')) return { code: 0, stdout: '33\n' };
      if (cmd.includes('dumpsys battery')) {
        return { code: 0, stdout: 'Current Battery Service state:\n  level: 85\n  status: 3\n  temperature: 312\n' };
      }
      if (cmd.includes('df -h /data')) {
        return { code: 0, stdout: 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/block/dm-0  64G   40G   24G  63% /data\n' };
      }
      if (cmd.includes('wm size')) {
        return { code: 0, stdout: 'Physical size: 1200x2000\n' };
      }
      if (cmd.includes('ro.serialno') || cmd.includes('ro.boot.serialno')) {
        return { code: 0, stdout: tabletSerial + '\n' };
      }
      return { code: 0, stdout: '' };
    };

    const info = await adbService.getDeviceInfo(tabletSerial);

    assert.strictEqual(info.serial, tabletSerial);
    assert.strictEqual(info.osVersion, '13');
    assert.strictEqual(info.androidVersion, 'Android 13');
    assert.strictEqual(info.battery, '85%');
    assert.strictEqual(info.batteryStatus, 'Discharging');
    assert.strictEqual(info.storageFree, '24G free');
    assert.strictEqual(info.screenResolution, '1200 × 2000');
    assert.strictEqual(formatDeviceOsVersion(info), 'Android 13');
  });

  test('2. Post-Test ListDevices Enrichment: enrichDeviceMetadata attaches cached telemetry so fields never become N/A', async () => {
    // Prime the cache with known valid metadata and telemetry (as occurs during initial check)
    adbService._setCachedMeta(tabletSerial, tabletHwSerial, {
      manufacturer: 'samsung',
      model: 'SM-X200',
      osVersion: '13',
      sdkVersion: '33'
    });
    adbService._setCachedTelemetry(tabletSerial, tabletHwSerial, {
      battery: '85%',
      batteryStatus: 'Discharging',
      batteryTemp: '31.2°C',
      storageFree: '24G free',
      storageTotal: '64G',
      storageUsedPct: '63%',
      screenResolution: '1200 × 2000'
    });

    const rawDev = {
      serial: tabletSerial,
      hardwareSerial: tabletHwSerial,
      state: 'device',
      model: 'SM-X200',
      connected: true,
      isWireless: false
    };

    // When listDevices enriches raw device
    const enriched = await adbService.enrichDeviceMetadata(rawDev);

    assert.strictEqual(enriched.osVersion, '13');
    assert.strictEqual(enriched.androidVersion, 'Android 13');
    assert.strictEqual(enriched.battery, '85%');
    assert.strictEqual(enriched.batteryStatus, 'Discharging');
    assert.strictEqual(enriched.storageFree, '24G free');
    assert.strictEqual(enriched.screenResolution, '1200 × 2000');

    // Verify formatters do NOT return empty or N/A
    assert.strictEqual(formatDeviceOsVersion(enriched), 'Android 13');
    assert.ok(formatDeviceDisplayName(enriched).includes('Samsung SM-X200'));
  });

  test('3. Transient ADB Failure: Timeout or empty shell during busy test completion does not wipe out metadata', async () => {
    // Prime the cache
    adbService._setCachedMeta(tabletSerial, tabletHwSerial, {
      manufacturer: 'samsung',
      model: 'SM-X200',
      osVersion: '13',
      sdkVersion: '33'
    });
    adbService._setCachedTelemetry(tabletSerial, tabletHwSerial, {
      battery: '85%',
      batteryStatus: 'Discharging',
      storageFree: '24G free',
      screenResolution: '1200 × 2000'
    });

    // Simulate transient ADB command timeout / error
    adbService.execute = async () => {
      throw new Error('ADB command timed out after 5000ms: adb -s R9PT1027R5Y shell getprop ...');
    };

    // 1. resolveDeviceMetadata should gracefully return cached metadata
    const meta = await adbService.resolveDeviceMetadata(tabletSerial, tabletHwSerial);
    assert.ok(meta, 'resolveDeviceMetadata must not return null when cached data exists');
    assert.strictEqual(meta.osVersion, '13');

    // 2. getDeviceInfo should gracefully preserve previous battery, storage, and OS version
    const info = await adbService.getDeviceInfo(tabletSerial);
    assert.strictEqual(info.osVersion, '13');
    assert.strictEqual(info.battery, '85%');
    assert.strictEqual(info.storageFree, '24G free');
    assert.strictEqual(info.screenResolution, '1200 × 2000');
    assert.strictEqual(formatDeviceOsVersion(info), 'Android 13');
  });

  test('4. Deduplication & Transport Priority: Single connected device resolves stable hardwareSerial', async () => {
    adbService.execute = async (args) => {
      const cmd = args.join(' ');
      if (cmd.includes('ro.serialno')) return { code: 0, stdout: 'R9PT1027R5Y\n' };
      return { code: 0, stdout: '' };
    };

    const singleDeviceList = [{
      serial: tabletSerial,
      state: 'device',
      model: 'SM-X200',
      connected: true,
      isWireless: false
    }];

    const result = await adbService.deduplicateAndPrioritizeTransports(singleDeviceList);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].hardwareSerial, tabletHwSerial);
  });

  test('5. Subsequent Refresh: Fresh updates cleanly update dynamic telemetry while preserving immutable OS metadata', async () => {
    // Initial cache
    adbService._setCachedMeta(tabletSerial, tabletHwSerial, {
      manufacturer: 'samsung',
      model: 'SM-X200',
      osVersion: '13',
      sdkVersion: '33'
    });
    adbService._setCachedTelemetry(tabletSerial, tabletHwSerial, {
      battery: '85%',
      batteryStatus: 'Discharging',
      storageFree: '24G free',
      screenResolution: '1200 × 2000'
    });

    // Later: Battery discharged to 80%, new storage used
    adbService.execute = async (args) => {
      const cmd = args.join(' ');
      if (cmd.includes('ro.product.manufacturer')) return { code: 0, stdout: 'samsung\n' };
      if (cmd.includes('ro.product.model')) return { code: 0, stdout: 'SM-X200\n' };
      if (cmd.includes('ro.build.version.release')) return { code: 0, stdout: '13\n' };
      if (cmd.includes('dumpsys battery')) {
        return { code: 0, stdout: 'level: 80\nstatus: 3\n' };
      }
      if (cmd.includes('df -h /data')) {
        return { code: 0, stdout: 'Filesystem Size Used Avail Use% Mounted on\n/dev/block/dm-0 64G 42G 22G 66% /data\n' };
      }
      if (cmd.includes('wm size')) {
        return { code: 0, stdout: 'Physical size: 1200x2000\n' };
      }
      return { code: 0, stdout: '' };
    };

    const updated = await adbService.getDeviceInfo(tabletSerial);

    assert.strictEqual(updated.battery, '80%');
    assert.strictEqual(updated.storageFree, '22G free');
    assert.strictEqual(updated.osVersion, '13');
    assert.strictEqual(formatDeviceOsVersion(updated), 'Android 13');
  });

  test('6. Controller Fallback: DeviceController.getDeviceInfo falls back to cache on unexpected ADB error', async () => {
    adbService._setCachedMeta(tabletSerial, tabletHwSerial, {
      manufacturer: 'samsung',
      model: 'SM-X200',
      osVersion: '13',
      sdkVersion: '33'
    });
    adbService._setCachedTelemetry(tabletSerial, tabletHwSerial, {
      battery: '85%',
      batteryStatus: 'Discharging',
      storageFree: '24G free',
      screenResolution: '1200 × 2000'
    });

    // Mock adbService.getDeviceInfo to reject
    const origGetInfo = adbService.getDeviceInfo;
    adbService.getDeviceInfo = async () => {
      throw new Error('ADB connection dropped');
    };

    // Assign ownership to testUser
    deviceLockService.setOwner(tabletSerial, testUser);

    const req = { params: { id: tabletSerial }, user: testUser };
    let jsonResult = null;
    const res = {
      json: (data) => { jsonResult = data; return res; },
      status: () => res
    };

    try {
      await deviceController.getDeviceInfo(req, res, (err) => { throw err; });
      assert.ok(jsonResult, 'Response must be returned');
      assert.strictEqual(jsonResult.success, true);
      assert.strictEqual(jsonResult.device.osVersion, '13');
      assert.strictEqual(jsonResult.device.battery, '85%');
      assert.strictEqual(jsonResult.device.storageFree, '24G free');
      assert.strictEqual(formatDeviceOsVersion(jsonResult.device), 'Android 13');
    } finally {
      adbService.getDeviceInfo = origGetInfo;
    }
  });
});
