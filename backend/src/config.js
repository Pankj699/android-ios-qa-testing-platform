const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from .env in backend directory or root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const ROOT_DIR = path.resolve(__dirname, '../..');
const BACKEND_DIR = path.resolve(__dirname, '..');

// Authoritative version from root package.json (fallback to backend package.json)
let appVersion = '1.0.0';
try {
  const rootPkg = require(path.join(ROOT_DIR, 'package.json'));
  if (rootPkg.version) appVersion = rootPkg.version;
} catch (e) {
  try {
    const backendPkg = require(path.join(BACKEND_DIR, 'package.json'));
    if (backendPkg.version) appVersion = backendPkg.version;
  } catch (err) {}
}

const semverParts = appVersion.split('.');
const displayVersion = `v${semverParts[0] || 1}.${semverParts[1] || 0} QA`;

const config = {
  APP_VERSION: appVersion,
  DISPLAY_VERSION: displayVersion,
  PORT: parseInt(process.env.PORT || '8080', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  
  // CLI executable paths - fallback to platform defaults if not provided in env
  ADB_PATH: process.env.ADB_PATH || (process.platform === 'win32' ? 'adb.exe' : 'adb'),
  JAVA_PATH: process.env.JAVA_PATH || (process.platform === 'win32' ? 'java.exe' : 'java'),
  PYTHON_PATH: process.env.PYTHON_PATH || (process.platform === 'win32' && require('fs').existsSync('C:\\tools\\python\\python.exe') ? 'C:\\tools\\python\\python.exe' : 'python'),
  IOS_BRIDGE_PATH: process.env.IOS_BRIDGE_PATH || path.join(BACKEND_DIR, 'src', 'tools', 'ios_bridge.py'),
  BUNDLETOOL_PATH: process.env.BUNDLETOOL_PATH || path.join(BACKEND_DIR, 'tools', 'bundletool-all-1.18.3.jar'),
  
  // Storage and Working directories
  UPLOAD_DIR: process.env.UPLOAD_DIR || path.join(BACKEND_DIR, 'uploads'),
  LOG_DIR: process.env.LOG_DIR || path.join(BACKEND_DIR, 'logs'),
  DATA_DIR: process.env.DATA_DIR || path.join(BACKEND_DIR, 'data'),
  TOOLS_DIR: path.join(BACKEND_DIR, 'tools'),
  APKS_OUTPUT_DIR: path.join(BACKEND_DIR, 'data', 'apks'),
  OUTPUT_DIR: path.join(BACKEND_DIR, 'data', 'apks'),
  
  // Limits and timeouts
  MAX_AAB_SIZE_MB: parseInt(process.env.MAX_AAB_SIZE_MB || '1024', 10),
  TEST_TIMEOUT_MS: parseInt(process.env.TEST_TIMEOUT_MS || '600000', 10), // 10 minutes
  ADB_TIMEOUT_MS: parseInt(process.env.ADB_TIMEOUT_MS || '30000', 10), // 30 seconds
  
  // Security & Native Authentication
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  IS_INTERNAL_QA: process.env.IS_INTERNAL_QA !== 'false',
  AUTH_ENABLED: process.env.AUTH_ENABLED !== 'false',
  JWT_SECRET: process.env.JWT_SECRET || 'qa_platform_jwt_secret_key_3948271',
  SESSION_SECRET: process.env.SESSION_SECRET || 'qa_platform_session_secret_key_7194823',
  SESSION_MAX_AGE_MS: parseInt(process.env.SESSION_MAX_AGE_MS || String(7 * 24 * 60 * 60 * 1000), 10), // 7 days default
  DATABASE_URL: process.env.DATABASE_URL || '',
  INITIAL_ADMIN_EMAIL: (process.env.INITIAL_ADMIN_EMAIL || 'admin.ob@gmail.com').toLowerCase().trim(),
  INITIAL_ADMIN_PASSWORD: process.env.INITIAL_ADMIN_PASSWORD || '',
  DEVICE_LOCK_TIMEOUT_MS: parseInt(process.env.DEVICE_LOCK_TIMEOUT_MS || '300000', 10), // 5 minutes default
  
  // HTTPS & SSL Config for Secure Context / WebUSB
  USE_HTTPS: process.env.USE_HTTPS !== 'false',
  HTTP_PORT: parseInt(process.env.HTTP_PORT || '8081', 10)
};

module.exports = config;
