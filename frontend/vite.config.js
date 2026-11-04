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
try {
  gitCommitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch (e) {
  gitCommitHash = '';
}

export default defineConfig({
  plugins: [react()],
  define: {
    __GIT_COMMIT_HASH__: JSON.stringify(gitCommitHash)
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
