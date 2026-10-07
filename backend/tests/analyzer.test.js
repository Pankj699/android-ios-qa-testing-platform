const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const aabAnalyzerService = require('../src/services/aabAnalyzerService');

test('AAB Analyzer extracts metadata and asset packs correctly', async (t) => {
  // Create a synthetic mock .aab
  const testAabPath = path.join(__dirname, 'mock_app.aab');
  const zip = new AdmZip();

  // Mock AndroidManifest in base
  const mockManifestText = `
    package="com.example.flyermaker"
    versionCode="750075"
    versionName="75.0.75"
    minSdkVersion="24"
    targetSdkVersion="36"
    applicationName="Flyer Maker"
  `;
  zip.addFile('base/manifest/AndroidManifest.xml', Buffer.from(mockManifestText, 'utf8'));

  // Mock fast-follow asset pack
  zip.addFile('main_assets/assets/textures/background.png', Buffer.from('mock texture data'));
  zip.addFile('main_assets/manifest/AndroidManifest.xml', Buffer.from('deliveryType="fast-follow"', 'utf8'));

  // Mock on-demand asset pack
  zip.addFile('level2_assets/assets/audio/music.mp3', Buffer.from('mock music data'));
  zip.addFile('level2_assets/manifest/AndroidManifest.xml', Buffer.from('deliveryType="on-demand"', 'utf8'));

  zip.writeZip(testAabPath);

  try {
    const info = await aabAnalyzerService.analyzeAab(testAabPath);

    assert.strictEqual(info.packageName, 'com.example.flyermaker');
    assert.strictEqual(info.versionName, '75.0.75');
    assert.strictEqual(info.versionCode, '750075');
    assert.strictEqual(info.targetSdkVersion, '36');
    assert.strictEqual(info.minSdkVersion, '24');
    assert.strictEqual(info.assetPacks.length, 2);

    const mainPack = info.assetPacks.find(p => p.name === 'main_assets');
    assert.ok(mainPack);
    assert.strictEqual(mainPack.deliveryType, 'fast-follow');

    const level2Pack = info.assetPacks.find(p => p.name === 'level2_assets');
    assert.ok(level2Pack);
    assert.strictEqual(level2Pack.deliveryType, 'on-demand');
  } finally {
    if (fs.existsSync(testAabPath)) {
      fs.unlinkSync(testAabPath);
    }
  }
});
