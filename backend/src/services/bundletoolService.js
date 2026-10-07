const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');
const config = require('../config');
const logger = require('../utils/logger');

class BundletoolService {
  constructor() {
    this.javaPath = config.JAVA_PATH;
    this.bundletoolJarPath = config.BUNDLETOOL_PATH;
    this._cachedJava = null;
    this._cachedJavaExpiry = 0;
    this._cachedBundletool = null;
    this._cachedBundletoolExpiry = 0;
  }

  /**
   * Check Java runtime (cached for 60s)
   */
  async checkJava(force = false) {
    const now = Date.now();
    if (!force && this._cachedJava && now < this._cachedJavaExpiry) {
      return this._cachedJava;
    }

    return new Promise((resolve) => {
      const proc = spawn(this.javaPath, ['-version'], { windowsHide: true });
      let output = '';

      proc.stdout.on('data', chunk => { output += chunk.toString(); });
      proc.stderr.on('data', chunk => { output += chunk.toString(); });

      proc.on('error', (err) => {
        const res = {
          available: false,
          error: `Java JDK was not found at '${this.javaPath}'. Please ensure Java 11+ is installed and configured in PATH or JAVA_PATH.`
        };
        resolve(res);
      });

      proc.on('close', (code) => {
        if (code === 0 || output.includes('version')) {
          const firstLine = output.split('\n')[0] || 'Java Runtime';
          const res = {
            available: true,
            version: firstLine.trim(),
            raw: output.trim()
          };
          this._cachedJava = res;
          this._cachedJavaExpiry = Date.now() + 60000;
          resolve(res);
        } else {
          resolve({
            available: false,
            error: `Java returned non-zero code (${code}): ${output}`
          });
        }
      });
    });
  }

  /**
   * Check Bundletool JAR existence and availability (cached for 60s)
   */
  async checkBundletool(force = false) {
    const now = Date.now();
    if (!force && this._cachedBundletool && now < this._cachedBundletoolExpiry) {
      return this._cachedBundletool;
    }
    const possiblePaths = [
      this.bundletoolJarPath,
      path.join(config.TOOLS_DIR, 'bundletool-all-1.18.3.jar'),
      path.join(config.TOOLS_DIR, 'bundletool.jar'),
      'C:\\Tools\\bundletool-all-1.18.3.jar',
      path.join(process.cwd(), 'tools', 'bundletool-all-1.18.3.jar'),
      path.join(process.cwd(), 'bundletool-all-1.18.3.jar')
    ];

    for (const p of possiblePaths) {
      if (p && fs.existsSync(p)) {
        try {
          const stats = fs.statSync(p);
          if (stats.size > 1000000) { // must be valid full jar (>1MB)
            this.bundletoolJarPath = p;
            break;
          }
        } catch (e) {}
      }
    }

    if (!fs.existsSync(this.bundletoolJarPath)) {
      return {
        available: false,
        path: this.bundletoolJarPath,
        error: `Bundletool JAR was not found at '${this.bundletoolJarPath}'.`
      };
    }

    try {
      const res = await this.execute(['version'], { timeout: 8000 });
      const result = {
        available: true,
        version: res.stdout || 'Bundletool 1.18.3',
        path: this.bundletoolJarPath
      };
      this._cachedBundletool = result;
      this._cachedBundletoolExpiry = Date.now() + 60000;
      return result;
    } catch (e) {
      const result = {
        available: true,
        version: 'Bundletool (JAR detected)',
        path: this.bundletoolJarPath,
        warning: e.message
      };
      this._cachedBundletool = result;
      this._cachedBundletoolExpiry = Date.now() + 60000;
      return result;
    }
  }

  /**
   * Execute bundletool jar command safely
   */
  execute(args, options = {}) {
    return new Promise((resolve, reject) => {
      const timeoutMs = options.timeout || 300000; // 5 minutes default
      const fullArgs = ['-jar', this.bundletoolJarPath, ...args];
      const cmdStr = `${this.javaPath} ${fullArgs.join(' ')}`;
      logger.debug(`[Bundletool Exec] ${cmdStr}`);

      const proc = spawn(this.javaPath, fullArgs, {
        windowsHide: true,
        shell: false
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      if (options.onLog) {
        proc.stdout.on('data', chunk => options.onLog(chunk.toString()));
        proc.stderr.on('data', chunk => options.onLog(chunk.toString()));
      }

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGKILL');
        reject(new Error(`Bundletool command timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      proc.stdout.on('data', chunk => { stdout += chunk.toString(); });
      proc.stderr.on('data', chunk => { stderr += chunk.toString(); });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Failed to execute bundletool: ${err.message}`));
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) return;

        if (code === 0) {
          resolve({
            code,
            stdout: stdout.trim(),
            stderr: stderr.trim()
          });
        } else {
          const errMsg = (stderr || stdout).trim();
          reject(new Error(`Bundletool execution failed (Code ${code}): ${errMsg}`));
        }
      });
    });
  }

  /**
   * Build APKs with --local-testing flag for Play Asset Delivery
   */
  async buildApks(aabPath, outputApksPath, options = {}) {
    if (!fs.existsSync(aabPath)) {
      throw new Error(`AAB file not found at ${aabPath}`);
    }

    const outDir = path.dirname(outputApksPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    // Note: build-apks does NOT accept --adb flag. Use --mode=default --local-testing
    const args = [
      'build-apks',
      `--bundle=${aabPath}`,
      `--output=${outputApksPath}`,
      '--local-testing',
      '--overwrite',
      '--mode=default'
    ];

    logger.info(`Building APKs for local testing: ${outputApksPath}`);
    return this.execute(args, { onLog: options.onLog, timeout: 300000 });
  }

  /**
   * Install APKs onto the target Android device using bundletool install-apks
   */
  async installApks(apksPath, deviceId, options = {}) {
    if (!fs.existsSync(apksPath)) {
      throw new Error(`APKS file not found at ${apksPath}`);
    }
    if (!deviceId) {
      throw new Error('Target device ID is required for installation');
    }

    const args = [
      'install-apks',
      `--apks=${apksPath}`,
      `--device-id=${deviceId}`,
      '--allow-downgrade',
      '--allow-test-only'
    ];

    // Only pass --adb if a specific custom path is given
    if (config.ADB_PATH && config.ADB_PATH !== 'adb' && config.ADB_PATH !== 'adb.exe') {
      args.push(`--adb=${config.ADB_PATH}`);
    }

    logger.info(`Installing APKs to device ${deviceId}...`);
    return this.execute(args, { onLog: options.onLog, timeout: 300000 });
  }

  /**
   * Build a universal APK for local testing (used for Browser USB direct installation)
   */
  async buildUniversalApk(aabPath, outputApkPath, options = {}) {
    if (!fs.existsSync(aabPath)) {
      throw new Error(`AAB file not found at ${aabPath}`);
    }

    const outDir = path.dirname(outputApkPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const tempApksPath = path.join(outDir, `temp_${Date.now()}.apks`);

    const args = [
      'build-apks',
      `--bundle=${aabPath}`,
      `--output=${tempApksPath}`,
      '--mode=universal',
      '--local-testing',
      '--overwrite'
    ];

    logger.info(`Building universal APK for Browser USB: ${outputApkPath}`);
    await this.execute(args, { onLog: options.onLog, timeout: 300000 });

    try {
      const AdmZip = require('adm-zip');
      const zip = new AdmZip(tempApksPath);
      const universalEntry = zip.getEntry('universal.apk');
      if (universalEntry) {
        fs.writeFileSync(outputApkPath, universalEntry.getData());
      } else {
        const entries = zip.getEntries();
        const apkEntry = entries.find(e => e.entryName.endsWith('.apk'));
        if (apkEntry) {
          fs.writeFileSync(outputApkPath, apkEntry.getData());
        } else {
          throw new Error('Universal APK entry not found in generated APKS archive');
        }
      }
    } finally {
      // Clean up temp APKS
      if (fs.existsSync(tempApksPath)) {
        try {
          fs.unlinkSync(tempApksPath);
        } catch (e) {}
      }
    }

    return { outputApkPath, size: fs.statSync(outputApkPath).size };
  }
}

module.exports = new BundletoolService();
