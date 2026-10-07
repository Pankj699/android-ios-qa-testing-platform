const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const config = require('../src/config');
const { execSync } = require('child_process');

describe('Automatic Version Management Suite', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const rootPkgPath = path.join(rootDir, 'package.json');
  const backendPkgPath = path.join(rootDir, 'backend', 'package.json');
  const frontendPkgPath = path.join(rootDir, 'frontend', 'package.json');
  const frontendVersionPath = path.join(rootDir, 'frontend', 'src', 'config', 'version.js');

  it('1. Authoritative root package.json contains valid semver version', () => {
    assert.ok(fs.existsSync(rootPkgPath), 'Root package.json must exist');
    const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
    assert.ok(rootPkg.version, 'Root package.json must have a version property');
    
    const semverRegex = /^\d+\.\d+\.\d+$/;
    assert.ok(semverRegex.test(rootPkg.version), `Version "${rootPkg.version}" must match MAJOR.MINOR.PATCH format`);
  });

  it('2. Backend, Frontend, and Root package.json versions are strictly in sync', () => {
    const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
    const backendPkg = JSON.parse(fs.readFileSync(backendPkgPath, 'utf8'));
    const frontendPkg = JSON.parse(fs.readFileSync(frontendPkgPath, 'utf8'));

    assert.strictEqual(backendPkg.version, rootPkg.version, 'Backend version must match root version');
    assert.strictEqual(frontendPkg.version, rootPkg.version, 'Frontend version must match root version');
  });

  it('3. Frontend version config export matches authoritative version', () => {
    assert.ok(fs.existsSync(frontendVersionPath), 'frontend/src/config/version.js must exist');
    const content = fs.readFileSync(frontendVersionPath, 'utf8');
    const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));

    assert.ok(content.includes(`export const APP_VERSION = '${rootPkg.version}';`), 'APP_VERSION must match root package.json version');
    
    const [major, minor] = rootPkg.version.split('.');
    const expectedDisplay = `v${major}.${minor} QA`;
    assert.ok(content.includes(`export const DISPLAY_VERSION = '${expectedDisplay}';`), 'DISPLAY_VERSION must match expected vX.Y QA format');
  });

  it('4. Backend config exposes APP_VERSION and DISPLAY_VERSION matching root package.json', () => {
    const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
    const [major, minor] = rootPkg.version.split('.');
    const expectedDisplay = `v${major}.${minor} QA`;

    assert.strictEqual(config.APP_VERSION, rootPkg.version);
    assert.strictEqual(config.DISPLAY_VERSION, expectedDisplay);
  });

  it('5. Version manager CLI script executes check successfully', () => {
    const scriptPath = path.join(rootDir, 'scripts', 'version-manager.js');
    assert.ok(fs.existsSync(scriptPath), 'scripts/version-manager.js must exist');

    const output = execSync(`node "${scriptPath}" check`, { encoding: 'utf8' });
    assert.ok(output.includes('[VersionManager] All modules in sync'), 'Version manager check command must pass');
  });
});
