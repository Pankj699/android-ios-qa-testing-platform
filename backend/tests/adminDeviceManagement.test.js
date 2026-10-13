const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const deviceImageService = require('../src/services/deviceImageService');

// Helper to create test JWT tokens
function createToken(role = 'ADMIN', email = 'admin@test.qa') {
  return jwt.sign({ id: 'user_' + role.toLowerCase(), email, role }, config.JWT_SECRET, { expiresIn: '1h' });
}

// Minimal valid PNG buffer
function createValidTestPng(w = 64, h = 64) {
  const buf = Buffer.alloc(24);
  buf.write('89504e470d0a1a0a', 0, 'hex');
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(w, 16);
  buf.writeUInt32BE(h, 20);
  return buf;
}

// Minimal valid JPEG buffer
function createValidTestJpeg(w = 64, h = 64) {
  const buf = Buffer.alloc(30);
  buf[0] = 0xFF; buf[1] = 0xD8; buf[2] = 0xFF;
  buf[3] = 0xE0; buf[4] = 0x00; buf[5] = 0x10;
  buf.write('JFIF', 6, 'ascii');
  buf[20] = 0xFF; buf[21] = 0xC0;
  buf.writeUInt16BE(11, 22);
  buf[24] = 8;
  buf.writeUInt16BE(h, 25);
  buf.writeUInt16BE(w, 27);
  return buf;
}

describe('Admin Device Management API & Access Control Tests', () => {
  const adminToken = createToken('ADMIN', 'admin@qa.test');
  const testerToken = createToken('TESTER', 'tester@qa.test');
  const testMfg = 'testadm';
  const testModel = 'admtest1';

  afterEach(() => {
    deviceImageService.deleteModel(testMfg, testModel);
  });

  test('listDeviceModels returns catalog models and summary', async () => {
    // Register test model
    deviceImageService.addOrUpdateModel({
      manufacturer: testMfg,
      model: testModel,
      displayName: 'Admin Test Phone'
    });

    const result = await deviceImageService.listDeviceModels({ search: testMfg });
    assert.ok(result.summary);
    assert.ok(result.models.length >= 1);

    const found = result.models.find(m => m.manufacturer === testMfg && m.model === testModel);
    assert.ok(found);
    assert.equal(found.displayName, 'Admin Test Phone');
    assert.equal(found.hasImage, false);
  });

  test('uploadDeviceImage persists image and updates catalog metadata', () => {
    const png = createValidTestPng(100, 150);
    const res = deviceImageService.uploadDeviceImage({
      manufacturer: testMfg,
      model: testModel,
      buffer: png,
      user: { email: 'admin@qa.test' },
      displayName: 'Admin Uploaded Model'
    });

    assert.equal(res.hasImage, true);
    assert.equal(res.width, 100);
    assert.equal(res.height, 150);
    assert.equal(res.mimeType, 'image/png');
    assert.ok(res.thumbnailUrl.includes(`/api/devices/image/${testMfg}/${testModel}`));

    const record = deviceImageService.getCachedRecord(testMfg, testModel);
    assert.ok(record);
    assert.equal(record.status, 'cached');
    assert.ok(fs.existsSync(record.filePath));
  });

  test('rejects upload with malformed or corrupt image', () => {
    const corrupt = Buffer.from('non-image data string that is definitely longer than 24 bytes');
    assert.throws(() => {
      deviceImageService.uploadDeviceImage({
        manufacturer: testMfg,
        model: testModel,
        buffer: corrupt
      });
    }, /Unrecognized image format/i);
  });

  test('rejects upload with path traversal in manufacturer or model', () => {
    const png = createValidTestPng(100, 100);
    assert.throws(() => {
      deviceImageService.uploadDeviceImage({
        manufacturer: '../../etc',
        model: 'passwd',
        buffer: png
      });
    });
  });

  test('removeDeviceImage clears image while preserving catalog model entry', () => {
    const png = createValidTestPng(100, 100);
    deviceImageService.uploadDeviceImage({
      manufacturer: testMfg,
      model: testModel,
      buffer: png,
      displayName: 'Permanent Model Name'
    });

    const rem = deviceImageService.removeDeviceImage(testMfg, testModel);
    assert.equal(rem.success, true);

    const key = `${testMfg}:${testModel}`;
    const entry = deviceImageService.manifest[key];
    assert.ok(entry);
    assert.equal(entry.status, 'no_image');
    assert.equal(entry.displayName, 'Permanent Model Name');
    assert.equal(deviceImageService.getCachedRecord(testMfg, testModel), null);
  });

  test('deleteModel removes both image and catalog entry', () => {
    const png = createValidTestPng(100, 100);
    deviceImageService.uploadDeviceImage({
      manufacturer: testMfg,
      model: testModel,
      buffer: png
    });

    const del = deviceImageService.deleteModel(testMfg, testModel);
    assert.equal(del.success, true);

    const key = `${testMfg}:${testModel}`;
    assert.equal(deviceImageService.manifest[key], undefined);
    assert.equal(deviceImageService.getCachedRecord(testMfg, testModel), null);
  });

  test('restoreOriginalImage restores raw image if trimmed was active', () => {
    const origPng = createValidTestPng(200, 300);
    const trimmedPng = createValidTestPng(170, 260);

    deviceImageService.uploadDeviceImage({
      manufacturer: testMfg,
      model: testModel,
      buffer: trimmedPng,
      originalBuffer: origPng,
      isTrimmed: true
    });

    const activeBefore = deviceImageService.getCachedRecord(testMfg, testModel);
    assert.equal(activeBefore.width, 170);

    const res = deviceImageService.restoreOriginalImage(testMfg, testModel, { email: 'admin@qa.test' });
    assert.equal(res.success, true);

    const activeAfter = deviceImageService.getCachedRecord(testMfg, testModel);
    assert.equal(activeAfter.width, 200);
    assert.equal(activeAfter.height, 300);
    assert.equal(activeAfter.isTrimmed, false);
  });
});
