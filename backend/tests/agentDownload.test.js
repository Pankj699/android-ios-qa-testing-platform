const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const agentRoutes = require('../src/routes/agentRoutes');
const { authenticate } = require('../src/middleware/auth');

test.describe('iOS Device Agent Package Download Suite', () => {
  let app;
  let server;
  let baseUrl;

  test.before((_, done) => {
    app = express();
    app.use(express.json());
    app.use('/api', authenticate);
    app.use('/api/agent', agentRoutes);

    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      done();
    });
  });

  test.after((_, done) => {
    if (server) {
      server.close(done);
    } else {
      done();
    }
  });

  function get(path) {
    return new Promise((resolve, reject) => {
      http.get(`${baseUrl}${path}`, (res) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const bodyBuffer = Buffer.concat(chunks);
          let json = null;
          try {
            json = JSON.parse(bodyBuffer.toString('utf8'));
          } catch (e) {}
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            bodyBuffer,
            json
          });
        });
      }).on('error', reject);
    });
  }

  test('1. Windows Agent Package download returns 200 with correct zip filename and headers', async () => {
    const res = await get('/api/agent/download/windows');
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'application/zip');
    assert.ok(res.headers['content-disposition']?.includes('QA-Device-Agent-Windows-x64-v1.1.2.zip'));
    assert.ok(res.bodyBuffer.length > 1000000, 'Windows package should be substantial in size');
  });

  test('2. macOS Agent Package download returns 200 with correct zip filename and headers', async () => {
    const res = await get('/api/agent/download/macos');
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'application/zip');
    assert.ok(res.headers['content-disposition']?.includes('QA-Device-Agent-macOS-v1.1.2.zip'));
    assert.ok(res.bodyBuffer.length > 10000, 'macOS package should contain bundled scripts');
  });

  test('3. Invalid platform returns 400 error without exposing internal files', async () => {
    const res = await get('/api/agent/download/unknown_platform');
    assert.equal(res.statusCode, 400);
    assert.equal(res.json?.success, false);
    assert.ok(res.json?.error?.includes('Invalid platform'));
  });

  test('4. Download endpoints are publicly accessible without authentication header', async () => {
    // Unauthenticated GET request to windows download
    const res = await get('/api/agent/download/windows');
    assert.notEqual(res.statusCode, 401, 'Download should not require JWT');
    assert.equal(res.statusCode, 200);
  });
});
