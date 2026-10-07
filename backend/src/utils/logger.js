const fs = require('fs');
const path = require('path');
const config = require('../config');

// Ensure log directory exists
if (!fs.existsSync(config.LOG_DIR)) {
  fs.mkdirSync(config.LOG_DIR, { recursive: true });
}

function getTimestamp() {
  return new Date().toISOString();
}

const logger = {
  info: (msg, ...args) => {
    console.log(`[${getTimestamp()}] [INFO] ${msg}`, ...args);
  },
  warn: (msg, ...args) => {
    console.warn(`[${getTimestamp()}] [WARN] ${msg}`, ...args);
  },
  error: (msg, ...args) => {
    console.error(`[${getTimestamp()}] [ERROR] ${msg}`, ...args);
  },
  debug: (msg, ...args) => {
    if (config.NODE_ENV !== 'production') {
      console.debug(`[${getTimestamp()}] [DEBUG] ${msg}`, ...args);
    }
  },
  writeTestLog: (testId, line) => {
    const filePath = path.join(config.LOG_DIR, `test-${testId}.log`);
    fs.appendFileSync(filePath, `[${getTimestamp()}] ${line}\n`, 'utf8');
  }
};

module.exports = logger;
