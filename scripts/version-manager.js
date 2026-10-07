/**
 * Centralized Version Management Utility
 * Android PAD / ORD QA Testing Platform
 * 
 * Handles reading, validating, synchronizing, and bumping application version
 * across root package.json, backend, frontend, and changelog.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const ROOT_PKG_PATH = path.join(ROOT_DIR, 'package.json');
const BACKEND_PKG_PATH = path.join(ROOT_DIR, 'backend', 'package.json');
const FRONTEND_PKG_PATH = path.join(ROOT_DIR, 'frontend', 'package.json');
const FRONTEND_VERSION_FILE = path.join(ROOT_DIR, 'frontend', 'src', 'config', 'version.js');
const CHANGELOG_PATH = path.join(ROOT_DIR, 'CHANGELOG.md');

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`[VersionManager] Failed to read JSON file at ${filePath}:`, err.message);
    process.exit(1);
  }
}

function writeJson(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  } catch (err) {
    console.error(`[VersionManager] Failed to write JSON file at ${filePath}:`, err.message);
    process.exit(1);
  }
}

function parseSemver(ver) {
  const parts = (ver || '').trim().split('.').map(n => parseInt(n, 10));
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid semver version: "${ver}". Expected format: MAJOR.MINOR.PATCH (e.g. 1.0.0)`);
  }
  return { major: parts[0], minor: parts[1], patch: parts[2] };
}

function formatDisplayVersion(semver, stage = 'QA') {
  const { major, minor } = parseSemver(semver);
  return `v${major}.${minor} ${stage}`;
}

function generateFrontendVersionCode(version, stage = 'QA') {
  const displayVersion = formatDisplayVersion(version, stage);
  return `// Centralized Version Configuration for Android PAD / ORD QA Platform
// Generated automatically by scripts/version-manager.js — DO NOT EDIT MANUALLY
export const APP_VERSION = '${version}';
export const APP_NAME = 'Android PAD / ORD Testing Platform';
export const VERSION_STAGE = '${stage}';

/**
 * Format a semver string (e.g. "1.0.0" or "1.1.0") into UI display format (e.g. "v1.0 QA" or "v1.1 QA")
 * @param {string} semver 
 * @param {string} stage 
 * @returns {string}
 */
export function formatDisplayVersion(semver = APP_VERSION, stage = VERSION_STAGE) {
  if (!semver || typeof semver !== 'string') return 'v1.0 ' + stage;
  const parts = semver.split('.');
  const major = parts[0] || '1';
  const minor = parts[1] || '0';
  return \`v\${major}.\${minor} \${stage}\`;
}

export const DISPLAY_VERSION = '${displayVersion}';
`;
}

function updateChangelog(newVersion, oldVersion, bumpType, reason = '') {
  const displayVersion = formatDisplayVersion(newVersion, 'QA');
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];

  const defaultReason = reason || (bumpType === 'minor' ? 'New features and platform improvements' : (bumpType === 'major' ? 'Major architectural release' : 'Patch updates and bug fixes'));

  const entry = `\n## [${displayVersion}] - ${dateStr} (${newVersion})\n- **Type**: ${bumpType.toUpperCase()}\n- **Previous Version**: ${oldVersion}\n- **Summary**: ${defaultReason}\n`;

  if (!fs.existsSync(CHANGELOG_PATH)) {
    const initial = `# Changelog - Android PAD / ORD QA Testing Platform\n\nAll notable changes, version increments, and major milestones are documented here.\n${entry}`;
    fs.writeFileSync(CHANGELOG_PATH, initial, 'utf8');
  } else {
    const content = fs.readFileSync(CHANGELOG_PATH, 'utf8');
    const headerEnd = content.indexOf('\n## ');
    if (headerEnd !== -1) {
      const updated = content.slice(0, headerEnd) + entry + content.slice(headerEnd);
      fs.writeFileSync(CHANGELOG_PATH, updated, 'utf8');
    } else {
      fs.writeFileSync(CHANGELOG_PATH, content + entry, 'utf8');
    }
  }
}

function getVersionInfo() {
  const rootPkg = readJson(ROOT_PKG_PATH);
  const currentVersion = rootPkg.version || '1.0.0';
  const displayVersion = formatDisplayVersion(currentVersion, 'QA');

  let backendVersion = 'unknown';
  let frontendVersion = 'unknown';

  if (fs.existsSync(BACKEND_PKG_PATH)) backendVersion = readJson(BACKEND_PKG_PATH).version;
  if (fs.existsSync(FRONTEND_PKG_PATH)) frontendVersion = readJson(FRONTEND_PKG_PATH).version;

  const inSync = (currentVersion === backendVersion) && (currentVersion === frontendVersion);

  return {
    version: currentVersion,
    displayVersion,
    backendVersion,
    frontendVersion,
    inSync
  };
}

function syncAll(targetVersion) {
  const version = targetVersion || readJson(ROOT_PKG_PATH).version;
  parseSemver(version); // Validate

  // 1. Root package.json
  const rootPkg = readJson(ROOT_PKG_PATH);
  rootPkg.version = version;
  writeJson(ROOT_PKG_PATH, rootPkg);

  // 2. Backend package.json
  if (fs.existsSync(BACKEND_PKG_PATH)) {
    const backendPkg = readJson(BACKEND_PKG_PATH);
    backendPkg.version = version;
    writeJson(BACKEND_PKG_PATH, backendPkg);
  }

  // 3. Frontend package.json
  if (fs.existsSync(FRONTEND_PKG_PATH)) {
    const frontendPkg = readJson(FRONTEND_PKG_PATH);
    frontendPkg.version = version;
    writeJson(FRONTEND_PKG_PATH, frontendPkg);
  }

  // 4. Frontend version config
  const frontendConfigDir = path.dirname(FRONTEND_VERSION_FILE);
  if (!fs.existsSync(frontendConfigDir)) {
    fs.mkdirSync(frontendConfigDir, { recursive: true });
  }
  fs.writeFileSync(FRONTEND_VERSION_FILE, generateFrontendVersionCode(version, 'QA'), 'utf8');

  console.log(`[VersionManager] Successfully synchronized all modules to version ${version} (${formatDisplayVersion(version, 'QA')})`);
}

function bumpVersion(type, reason) {
  const rootPkg = readJson(ROOT_PKG_PATH);
  const oldVersion = rootPkg.version || '1.0.0';
  const { major, minor, patch } = parseSemver(oldVersion);

  let newVersion;
  switch (type.toLowerCase()) {
    case 'major':
      newVersion = `${major + 1}.0.0`;
      break;
    case 'minor':
      newVersion = `${major}.${minor + 1}.0`;
      break;
    case 'patch':
      newVersion = `${major}.${minor}.${patch + 1}`;
      break;
    default:
      console.error(`[VersionManager] Unknown bump type: "${type}". Use: major, minor, or patch.`);
      process.exit(1);
  }

  console.log(`[VersionManager] Bumping version: ${oldVersion} -> ${newVersion} (${formatDisplayVersion(newVersion, 'QA')}) [${type.toUpperCase()}]`);

  syncAll(newVersion);
  updateChangelog(newVersion, oldVersion, type, reason);

  console.log(`\n========================================`);
  console.log(`VERSION BUMP COMPLETE:`);
  console.log(`  Previous Version: ${oldVersion} (${formatDisplayVersion(oldVersion, 'QA')})`);
  console.log(`  New Version:      ${newVersion} (${formatDisplayVersion(newVersion, 'QA')})`);
  console.log(`  Type:             ${type.toUpperCase()}`);
  if (reason) console.log(`  Reason:           ${reason}`);
  console.log(`========================================\n`);

  return newVersion;
}

// CLI Command Dispatcher
const args = process.argv.slice(2);
const command = args[0] || 'get';

switch (command.toLowerCase()) {
  case 'get': {
    const info = getVersionInfo();
    console.log(JSON.stringify(info, null, 2));
    break;
  }
  case 'check': {
    const info = getVersionInfo();
    if (!info.inSync) {
      console.error(`[VersionManager] Version mismatch detected! Root: ${info.version}, Backend: ${info.backendVersion}, Frontend: ${info.frontendVersion}`);
      process.exit(1);
    }
    console.log(`[VersionManager] All modules in sync: ${info.version} (${info.displayVersion})`);
    break;
  }
  case 'sync': {
    const targetVersion = args[1];
    syncAll(targetVersion);
    break;
  }
  case 'bump': {
    const type = args[1];
    if (!type) {
      console.error(`[VersionManager] Please specify bump type: minor, major, or patch.`);
      process.exit(1);
    }
    const reason = args.slice(2).join(' ');
    bumpVersion(type, reason);
    break;
  }
  default:
    console.log(`Usage: node scripts/version-manager.js <get|check|sync|bump> [minor|major|patch] [reason]`);
    process.exit(0);
}
