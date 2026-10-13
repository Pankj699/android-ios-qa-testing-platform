/**
 * Standalone Restart Supervisor for QA Testing Platform Backend
 * Usage: node restartService.js <parentPid>
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const parentPid = parseInt(process.argv[2], 10);
const backendDir = path.resolve(__dirname, '../..');
const logsDir = path.join(backendDir, 'logs');
const logFile = path.join(logsDir, 'restart.log');

try {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
} catch (_) {}

function log(msg) {
  const line = `[${new Date().toISOString()}] [RestartSupervisor] ${msg}\n`;
  try {
    fs.appendFileSync(logFile, line);
  } catch (_) {}
}

function isPidRunning(pid) {
  if (!pid || isNaN(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return false;
  }
}

async function run() {
  log(`Supervisor started for parent PID ${parentPid}`);

  if (parentPid && !isNaN(parentPid)) {
    const startTime = Date.now();
    const timeoutMs = 12000; // 12 seconds max wait for parent exit

    while (isPidRunning(parentPid)) {
      if (Date.now() - startTime > timeoutMs) {
        log(`Parent PID ${parentPid} did not exit within ${timeoutMs}ms. Attempting force terminate.`);
        try {
          process.kill(parentPid, 'SIGKILL');
        } catch (_) {}
        break;
      }
      // Sleep 150ms
      await new Promise(r => setTimeout(r, 150));
    }
    log(`Parent PID ${parentPid} confirmed stopped.`);
  }

  // Grace delay for OS TCP socket release (EADDRINUSE prevention)
  await new Promise(r => setTimeout(r, 600));

  const serverScript = path.join(backendDir, 'src', 'index.js');
  log(`Spawning new backend server instance (${serverScript})...`);

  try {
    const outLog = path.join(logsDir, 'backend_supervisor_child.log');
    const outFd = fs.openSync(outLog, 'a');
    const serverProcess = spawn(process.execPath, [serverScript], {
      cwd: backendDir,
      detached: true,
      stdio: ['ignore', outFd, outFd],
      env: process.env
    });

    serverProcess.unref();
    log(`Successfully spawned new backend instance PID ${serverProcess.pid}. Supervisor exiting.`);
  } catch (err) {
    log(`Failed to spawn new backend process: ${err.message}`);
    process.exit(1);
  }

  process.exit(0);
}

run().catch(err => {
  log(`Fatal error in supervisor: ${err.message}`);
  process.exit(1);
});
