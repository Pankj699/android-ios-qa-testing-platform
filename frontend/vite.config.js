import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const certPath = path.resolve(__dirname, '../backend/data/cert.pem');
const keyPath = path.resolve(__dirname, '../backend/data/key.pem');

const hasCert = fs.existsSync(certPath) && fs.existsSync(keyPath);
const httpsConfig = hasCert
  ? {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath)
    }
  : undefined;

let gitCommitHash = '';
let gitCommitCount = 0;
try {
  gitCommitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const countStr = execSync('git rev-list --count HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  gitCommitCount = parseInt(countStr, 10) || 0;
} catch (e) {
  gitCommitHash = '';
  gitCommitCount = 0;
}

function computeSysVersion(commitCount) {
  // Baseline: commit 13 was 1.0 baseline. Step 1 (commit 14) was 1.1.
  // Step 2 (commit 15) is 1.2, step 3 is 1.3 ... step 10 is 1.10.
  // After 1.10 (step 11), rolls over to 2.0, 2.1 ... 2.10, then 3.0, etc.
  const baseOffset = 13;
  const step = Math.max(1, commitCount - baseOffset);
  if (step <= 10) {
    return `1.${step}`;
  }
  const adj = step - 11;
  const major = 2 + Math.floor(adj / 11);
  const minor = adj % 11;
  return `${major}.${minor}`;
}

const sysVersionNum = gitCommitCount > 0 ? computeSysVersion(gitCommitCount) : '1.2';
const sysVersionLabel = `SYS.VER.${sysVersionNum}`;

export default defineConfig({
  plugins: [react()],
  define: {
    __GIT_COMMIT_HASH__: JSON.stringify(gitCommitHash),
    __SYS_VERSION__: JSON.stringify(sysVersionLabel)
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    https: httpsConfig,
    proxy: {
      '/api': {
        target: 'https://localhost:8080',
        changeOrigin: true,
        secure: false
      },
      '/ws': {
        target: 'wss://localhost:8080',
        ws: true,
        secure: false
      }
    }
  }
});
