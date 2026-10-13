const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const deviceImageService = require('../src/services/deviceImageService');

// Minimal valid PNG buffer
function createValidTestPng(w = 64, h = 64) {
  const buf = Buffer.alloc(24);
  buf.write('89504e470d0a1a0a', 0, 'hex'); // PNG magic
  buf.writeUInt32BE(13, 8); // chunk len
  buf.write('IHDR', 12, 'ascii'); // chunk type
  buf.writeUInt32BE(w, 16);
  buf.writeUInt32BE(h, 20);
  return buf;
}

// Minimal valid JPEG buffer
function createValidTestJpeg(w = 64, h = 64) {
  const buf = Buffer.alloc(30);
  buf[0] = 0xFF; buf[1] = 0xD8; buf[2] = 0xFF; // SOI + marker
  buf[3] = 0xE0; buf[4] = 0x00; buf[5] = 0x10; // APP0 length 16
  buf.write('JFIF', 6, 'ascii');
  buf[20] = 0xFF; buf[21] = 0xC0; // SOF0
  buf.writeUInt16BE(11, 22);
  buf[24] = 8;
  buf.writeUInt16BE(h, 25);
  buf.writeUInt16BE(w, 27);
  return buf;
}

// Minimal valid WebP buffer (VP8)
function createValidTestWebp(w = 64, h = 64) {
  const buf = Buffer.alloc(32);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(24, 4); // file size - 8
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8 ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // chunk size
  buf.writeUInt16LE(w & 0x3fff, 26);
  buf.writeUInt16LE(h & 0x3fff, 28);
  return buf;
}

describe('DeviceImageService Unit & Management Tests', () => {
  const testDir = path.resolve(__dirname, '../data/device_images');
  const manifestFile = path.join(testDir, 'manifest.json');
  let manifestBackup = null;

  before(() => {
    if (fs.existsSync(manifestFile)) {
      try { manifestBackup = fs.readFileSync(manifestFile, 'utf8'); } catch (_) {}
    }
  });

  after(() => {
    if (manifestBackup !== null) {
      try { fs.writeFileSync(manifestFile, manifestBackup, 'utf8'); } catch (_) {}
    }
  });

  test('sanitizeIdentifier strips traversal characters and non-alphanumerics', () => {
    assert.equal(deviceImageService.sanitizeIdentifier('../../etc/passwd'), 'etcpasswd');
    assert.equal(deviceImageService.sanitizeIdentifier('Vivo V2143 (Android 13)'), 'vivov2143android13');
    assert.equal(deviceImageService.sanitizeIdentifier('SM-X510'), 'sm-x510');
    assert.equal(deviceImageService.sanitizeIdentifier('iPhone_15_Pro'), 'iphone_15_pro');
    assert.equal(deviceImageService.sanitizeIdentifier(''), '');
    assert.equal(deviceImageService.sanitizeIdentifier(null), '');
  });

  test('getCacheKey formats normalized mfg:model key', () => {
    assert.equal(deviceImageService.getCacheKey('Vivo', 'V2143'), 'vivo:v2143');
    assert.equal(deviceImageService.getCacheKey('Samsung', 'SM-X510'), 'samsung:sm-x510');
  });

  test('normalizeDeviceIdentity normalizes Android and iOS models correctly', () => {
    const androidDev = { manufacturer: 'VIVO', model: 'V2143', displayName: 'Vivo V2143' };
    const iosDev = { name: 'iPhone 13 Pro', model: 'iPhone14,2', platform: 'ios' };

    const normAndroid = deviceImageService.normalizeDeviceIdentity(androidDev);
    assert.equal(normAndroid.sMfg, 'vivo');
    assert.equal(normAndroid.sModel, 'v2143');
    assert.equal(normAndroid.isIos, false);
    assert.equal(normAndroid.displayName, 'Vivo V2143');

    const normIos = deviceImageService.normalizeDeviceIdentity(iosDev);
    assert.equal(normIos.sMfg, 'apple');
    assert.equal(normIos.sModel, 'iphone142');
    assert.equal(normIos.isIos, true);
  });

  describe('Image Buffer Validation & Security Guards', () => {
    test('validates valid PNG buffer with proper dimensions', () => {
      const png = createValidTestPng(200, 300);
      const res = deviceImageService.validateImageBuffer(png);
      assert.equal(res.valid, true);
      assert.equal(res.type, 'image/png');
      assert.equal(res.width, 200);
      assert.equal(res.height, 300);
    });

    test('validates valid JPEG buffer with proper dimensions', () => {
      const jpg = createValidTestJpeg(400, 600);
      const res = deviceImageService.validateImageBuffer(jpg);
      assert.equal(res.valid, true);
      assert.equal(res.type, 'image/jpeg');
      assert.equal(res.width, 400);
      assert.equal(res.height, 600);
    });

    test('validates valid WebP buffer with proper dimensions', () => {
      const webp = createValidTestWebp(320, 480);
      const res = deviceImageService.validateImageBuffer(webp);
      assert.equal(res.valid, true);
      assert.equal(res.type, 'image/webp');
      assert.equal(res.width, 320);
      assert.equal(res.height, 480);
    });

    test('rejects corrupt or non-image buffer', () => {
      const corrupt = Buffer.from('hello world random non image data');
      const res = deviceImageService.validateImageBuffer(corrupt);
      assert.equal(res.valid, false);
      assert.match(res.error, /Unrecognized image format/i);
    });

    test('rejects image that is too small (<32px)', () => {
      const small = createValidTestPng(16, 16);
      const res = deviceImageService.validateImageBuffer(small);
      assert.equal(res.valid, false);
      assert.match(res.error, /too small/i);
    });

    test('rejects decompression bomb image (>4096px)', () => {
      const bomb = createValidTestPng(5000, 5000);
      const res = deviceImageService.validateImageBuffer(bomb);
      assert.equal(res.valid, false);
      assert.match(res.error, /exceed safe bounds/i);
    });

    test('rejects oversized payload (>2MB)', () => {
      const oversized = Buffer.alloc(2.5 * 1024 * 1024);
      oversized.write('89504e470d0a1a0a', 0, 'hex');
      const res = deviceImageService.validateImageBuffer(oversized);
      assert.equal(res.valid, false);
      assert.match(res.error, /exceeds.*limit/i);
    });
  });

  describe('Manual Image Upload, Replacement & Removal Lifecycle', () => {
    const testMfg = 'testbrand';
    const testModel = 'testmodel1';

    afterEach(() => {
      deviceImageService.deleteModel(testMfg, testModel);
    });

    test('uploads image, persists atomically, and sets manifest record', () => {
      const pngBuf = createValidTestPng(120, 200);
      const res = deviceImageService.uploadDeviceImage({
        manufacturer: testMfg,
        model: testModel,
        buffer: pngBuf,
        user: { email: 'admin@test.qa' },
        displayName: 'Test Brand Unit'
      });

      assert.equal(res.hasImage, true);
      assert.equal(res.fileName, `${testMfg}_${testModel}.png`);
      assert.equal(res.mimeType, 'image/png');
      assert.equal(res.width, 120);
      assert.equal(res.height, 200);
      assert.ok(res.eTag);

      // Verify file exists on disk
      const filePath = path.join(testDir, `${testMfg}_${testModel}.png`);
      assert.ok(fs.existsSync(filePath));

      // Verify cached record retrieval
      const cached = deviceImageService.getCachedRecord(testMfg, testModel);
      assert.ok(cached);
      assert.equal(cached.status, 'cached');
      assert.equal(cached.filePath, filePath);
    });

    test('replaces image and cleans up older file with different extension', () => {
      // 1. Upload PNG first
      const pngBuf = createValidTestPng(120, 200);
      deviceImageService.uploadDeviceImage({
        manufacturer: testMfg,
        model: testModel,
        buffer: pngBuf,
        user: { email: 'admin@test.qa' }
      });
      const pngPath = path.join(testDir, `${testMfg}_${testModel}.png`);
      assert.ok(fs.existsSync(pngPath));

      // 2. Replace with JPEG
      const jpgBuf = createValidTestJpeg(240, 400);
      const repRes = deviceImageService.uploadDeviceImage({
        manufacturer: testMfg,
        model: testModel,
        buffer: jpgBuf,
        user: { email: 'admin@test.qa' }
      });

      const jpgPath = path.join(testDir, `${testMfg}_${testModel}.jpg`);
      assert.ok(fs.existsSync(jpgPath));
      assert.equal(repRes.mimeType, 'image/jpeg');
      assert.equal(repRes.width, 240);

      // Confirm old PNG was unlinked
      assert.equal(fs.existsSync(pngPath), false, 'Older image with different extension must be cleaned up');
    });

    test('removes image while preserving model catalog entry', () => {
      const pngBuf = createValidTestPng(120, 200);
      deviceImageService.uploadDeviceImage({
        manufacturer: testMfg,
        model: testModel,
        buffer: pngBuf,
        user: { email: 'admin@test.qa' },
        displayName: 'Test Device 1'
      });

      const pngPath = path.join(testDir, `${testMfg}_${testModel}.png`);
      assert.ok(fs.existsSync(pngPath));

      const remRes = deviceImageService.removeDeviceImage(testMfg, testModel, { email: 'admin@test.qa' });
      assert.equal(remRes.success, true);

      // Image file unlinked
      assert.equal(fs.existsSync(pngPath), false);

      // Catalog entry preserved with status 'no_image'
      const key = `${testMfg}:${testModel}`;
      const entry = deviceImageService.manifest[key];
      assert.ok(entry, 'Model record must be preserved in catalog');
      assert.equal(entry.status, 'no_image');
      assert.equal(entry.displayName, 'Test Device 1');

      // getCachedRecord returns null -> displays fallback
      const cached = deviceImageService.getCachedRecord(testMfg, testModel);
      assert.equal(cached, null);
    });

    test('preserves original image and restores original upon request', () => {
      const origBuf = createValidTestPng(200, 300);
      const trimmedBuf = createValidTestPng(180, 280);

      const upRes = deviceImageService.uploadDeviceImage({
        manufacturer: testMfg,
        model: testModel,
        buffer: trimmedBuf,
        originalBuffer: origBuf,
        isTrimmed: true,
        displayName: 'Trimmable Unit'
      });

      assert.equal(upRes.isTrimmed, true);
      assert.equal(upRes.width, 180);
      assert.equal(upRes.height, 280);
      assert.equal(upRes.originalWidth, 200);
      assert.equal(upRes.originalHeight, 300);

      // Verify active file has trimmed buffer
      const activeRecord = deviceImageService.getCachedRecord(testMfg, testModel);
      assert.ok(activeRecord);
      assert.equal(activeRecord.width, 180);

      // Verify original file can be retrieved via options.original
      const origRecord = deviceImageService.getCachedRecord(testMfg, testModel, { original: true });
      assert.ok(origRecord);
      assert.equal(origRecord.originalWidth, 200);
      assert.ok(origRecord.filePath.includes('_orig.png'));

      // Test restoreOriginalImage
      const restRes = deviceImageService.restoreOriginalImage(testMfg, testModel, { email: 'admin@test.qa' });
      assert.equal(restRes.success, true);
      assert.equal(restRes.data.isTrimmed, false);
      assert.equal(restRes.data.width, 200);
      assert.equal(restRes.data.height, 300);

      // Active cached record is now the restored original
      const restoredActive = deviceImageService.getCachedRecord(testMfg, testModel);
      assert.equal(restoredActive.width, 200);
      assert.equal(restoredActive.height, 300);
    });

    test('addOrUpdateModel registers model in catalog without image', () => {
      const addRes = deviceImageService.addOrUpdateModel({
        manufacturer: testMfg,
        model: testModel,
        displayName: 'Registered Brand Unit'
      });
      assert.equal(addRes.manufacturer, testMfg);
      assert.equal(addRes.model, testModel);
      assert.equal(addRes.hasImage, false);

      const key = `${testMfg}:${testModel}`;
      assert.ok(deviceImageService.manifest[key]);
      assert.equal(deviceImageService.manifest[key].displayName, 'Registered Brand Unit');
    });
  });
});
