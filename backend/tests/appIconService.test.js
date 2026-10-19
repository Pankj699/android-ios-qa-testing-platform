const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const appIconService = require('../src/services/appIconService');
const historyService = require('../src/services/historyService');

// Minimal valid PNG buffer
function createValidTestPng() {
  const buf = Buffer.alloc(24);
  buf.write('89504e470d0a1a0a', 0, 'hex'); // PNG magic
  buf.writeUInt32BE(13, 8); // chunk len
  buf.write('IHDR', 12, 'ascii'); // chunk type
  buf.writeUInt32BE(48, 16);
  buf.writeUInt32BE(48, 20);
  return buf;
}

// Minimal valid WebP buffer
function createValidTestWebp() {
  const buf = Buffer.alloc(32);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(24, 4);
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8 ', 12, 'ascii');
  return buf;
}

describe('AppIconService Unit & Integration Tests', () => {
  const testBuildId = 'test-unit-icon-' + Date.now();

  afterEach(() => {
    appIconService.deleteCachedIcon(testBuildId);
  });

  test('MIME type detection identifies PNG, WebP, JPEG and rejects invalid data', () => {
    const png = createValidTestPng();
    const webp = createValidTestWebp();
    const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46]);
    const invalid = Buffer.from([0x00, 0x01, 0x02, 0x03]);

    assert.equal(appIconService._detectMimeType(png)?.mimeType, 'image/png');
    assert.equal(appIconService._detectMimeType(png)?.ext, 'png');

    assert.equal(appIconService._detectMimeType(webp)?.mimeType, 'image/webp');
    assert.equal(appIconService._detectMimeType(webp)?.ext, 'webp');

    assert.equal(appIconService._detectMimeType(jpeg)?.mimeType, 'image/jpeg');
    assert.equal(appIconService._detectMimeType(jpeg)?.ext, 'jpg');

    assert.equal(appIconService._detectMimeType(invalid), null);
    assert.equal(appIconService._detectMimeType(null), null);
  });

  test('Scoring prioritizes launcher mipmaps and rejects non-resource assets', () => {
    const mipmapScore = appIconService._scoreIconPath('res/mipmap-xxxhdpi/ic_launcher.png');
    const drawableScore = appIconService._scoreIconPath('res/drawable-hdpi/ic_launcher.png');
    const assetScore = appIconService._scoreIconPath('assets/icons/link_icon_1.webp');
    const xmlScore = appIconService._scoreIconPath('res/mipmap-anydpi-v26/ic_launcher.xml');
    const notificationScore = appIconService._scoreIconPath('res/drawable/notification_icon.png');

    assert.ok(mipmapScore > 300, 'Launcher mipmap should have high score');
    assert.ok(mipmapScore > drawableScore, 'Mipmap should score higher than drawable');
    assert.ok(assetScore < 0, 'Assets folder must be rejected');
    assert.ok(xmlScore < 0, 'XML adaptive icons must be rejected from direct raster score');
    assert.ok(mipmapScore > notificationScore, 'Launcher icon should score much higher than notification icon');
  });

  test('Gracefully handles missing or non-existent files', async () => {
    const res = await appIconService.extractAndCacheIcon('non-existent-build', 'C:/invalid/path/build.apk');
    assert.equal(res, null);
    assert.equal(appIconService.getCachedIcon('non-existent-build'), null);
  });

  test('Extracts launcher icon from real AAB build', async () => {
    const sampleAab = path.resolve(__dirname, '../uploads/7b76a4ce-d37b-4cdd-aeec-755c41f56ced/Flyer_maker_V1_211.0.211-flyerV1-qa-AI-Tools-1792401031066-800504465.aab');
    if (!fs.existsSync(sampleAab)) return;

    const res = await appIconService.extractAndCacheIcon(testBuildId, sampleAab);
    assert.ok(res, 'Extraction should succeed for sample AAB');
    assert.equal(res.success, true);
    assert.ok(fs.existsSync(res.filePath), 'Extracted icon file should exist on disk');
    assert.ok(res.filePath.endsWith('.png') || res.filePath.endsWith('.webp'));
    assert.equal(res.iconUrl, `/api/build/${testBuildId}/icon`);

    // Verify caching
    const cached = appIconService.getCachedIcon(testBuildId);
    assert.ok(cached, 'Cached icon should be retrievable');
    assert.equal(cached.filePath, res.filePath);
  });

  test('Extracts launcher icon from real obfuscated release APK build', async () => {
    const sampleApk = path.resolve(__dirname, '../uploads/7b76a4ce-d37b-4cdd-aeec-755c41f56ced/Flyer_maker_V1_212.0.212-flyerV1-release-1792404980179-7920122.apk');
    if (!fs.existsSync(sampleApk)) return;

    const res = await appIconService.extractAndCacheIcon(testBuildId, sampleApk);
    assert.ok(res, 'Extraction should succeed for obfuscated APK');
    assert.equal(res.success, true);
    assert.ok(fs.existsSync(res.filePath), 'Extracted icon file should exist on disk');
    assert.ok(res.filePath.endsWith('.png') || res.filePath.endsWith('.webp'));
  });

  test('Extracts launcher icon from adaptive XML APK build', async () => {
    const adaptiveApk = path.resolve(__dirname, '../uploads/bf0b2225-97f5-4c8d-8aa3-bcb98b32b806/Invitation_Card_Maker_V1_177.0.177-invitationV1-qa__1_-1792411702340-230479539.apk');
    if (!fs.existsSync(adaptiveApk)) return;

    const res = await appIconService.extractAndCacheIcon(testBuildId, adaptiveApk);
    assert.ok(res, 'Extraction should succeed for adaptive XML APK');
    assert.equal(res.success, true);
    assert.ok(fs.existsSync(res.filePath), 'Extracted icon file should exist on disk');
    assert.ok(res.filePath.endsWith('.png') || res.filePath.endsWith('.webp'));
  });

  test('Deletes cached icon when requested', async () => {
    const iconPath = path.join(appIconService.iconDir, `${testBuildId}.png`);
    fs.writeFileSync(iconPath, createValidTestPng());
    assert.ok(appIconService.getCachedIcon(testBuildId));

    appIconService.deleteCachedIcon(testBuildId);
    assert.equal(appIconService.getCachedIcon(testBuildId), null);
    assert.equal(fs.existsSync(iconPath), false);
  });
});
