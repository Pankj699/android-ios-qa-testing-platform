const { describe, it } = require('node:test');
const assert = require('node:assert');
const remoteConfigService = require('../src/services/remoteConfigService');

describe('RemoteConfigService Unit & Safeguards Suite', () => {
  describe('1. Platform, Slug & Key Validation', () => {
    it('accepts valid platforms and resolves configured base URLs', () => {
      const androidUrl = remoteConfigService.getBaseUrl('android');
      assert.strictEqual(typeof androidUrl, 'string');
      assert.ok(androidUrl.includes(':2315') || androidUrl.startsWith('http'));

      const iosUrl = remoteConfigService.getBaseUrl('ios');
      assert.strictEqual(typeof iosUrl, 'string');
      assert.ok(iosUrl.includes(':2324') || iosUrl.startsWith('http'));

      // Case insensitivity
      assert.strictEqual(remoteConfigService.getBaseUrl('Android'), androidUrl);
      assert.strictEqual(remoteConfigService.getBaseUrl('iOS '), iosUrl);
    });

    it('rejects unsupported platforms and prevents URL injection', () => {
      assert.throws(() => remoteConfigService.getBaseUrl('windows'), /Unsupported platform/);
      assert.throws(() => remoteConfigService.getBaseUrl(''), /Platform must be specified/);
      assert.throws(() => remoteConfigService.getBaseUrl(null), /Platform must be specified/);
      assert.throws(() => remoteConfigService.getBaseUrl('../../etc/passwd'), /Unsupported platform/);
    });

    it('validates and sanitizes application slugs', () => {
      assert.strictEqual(remoteConfigService.validateAppSlug('designwiz'), 'designwiz');
      assert.strictEqual(remoteConfigService.validateAppSlug('1invites'), '1invites');
      assert.strictEqual(remoteConfigService.validateAppSlug('designwiz_test'), 'designwiz_test');
      assert.strictEqual(remoteConfigService.validateAppSlug('logo-maker'), 'logo-maker');

      // Prevents path traversal and shell injection
      assert.throws(() => remoteConfigService.validateAppSlug('../malicious'), /Invalid application slug/);
      assert.throws(() => remoteConfigService.validateAppSlug('app;rm -rf /'), /Invalid application slug/);
      assert.throws(() => remoteConfigService.validateAppSlug('app<script>'), /Invalid application slug/);
      assert.throws(() => remoteConfigService.validateAppSlug(''), /Invalid application slug/);
    });

    it('validates configuration keys', () => {
      assert.strictEqual(remoteConfigService.validateKey('is_trial_enabled'), 'is_trial_enabled');
      assert.strictEqual(remoteConfigService.validateKey('feature.paywall.v2'), 'feature.paywall.v2');
      assert.strictEqual(remoteConfigService.validateKey('key:sub_key'), 'key:sub_key');

      assert.throws(() => remoteConfigService.validateKey(''), /Invalid key/);
      assert.throws(() => remoteConfigService.validateKey('key with spaces'), /Invalid key/);
      assert.throws(() => remoteConfigService.validateKey('key<script>'), /Invalid key/);
    });
  });

  describe('2. Type & Value Normalization', () => {
    it('normalizes boolean values to 0 or 1', () => {
      assert.strictEqual(remoteConfigService.normalizeValue('boolean', true), '1');
      assert.strictEqual(remoteConfigService.normalizeValue('boolean', false), '0');
      assert.strictEqual(remoteConfigService.normalizeValue('boolean', '1'), '1');
      assert.strictEqual(remoteConfigService.normalizeValue('boolean', '0'), '0');
      assert.strictEqual(remoteConfigService.normalizeValue('boolean', 'true'), '1');
      assert.strictEqual(remoteConfigService.normalizeValue('boolean', 'false'), '0');

      assert.throws(() => remoteConfigService.normalizeValue('boolean', 'invalid'), /Invalid boolean/);
    });

    it('validates and normalizes number values', () => {
      assert.strictEqual(remoteConfigService.normalizeValue('number', 42), '42');
      assert.strictEqual(remoteConfigService.normalizeValue('number', '3.14'), '3.14');
      assert.strictEqual(remoteConfigService.normalizeValue('number', -10), '-10');

      assert.throws(() => remoteConfigService.normalizeValue('number', 'not_a_number'), /Invalid number/);
      assert.throws(() => remoteConfigService.normalizeValue('number', ''), /Invalid number/);
    });

    it('validates JSON syntax and rejects malformed payloads', () => {
      const validObj = { experiment: true, variant: 'B', count: 5 };
      const res = remoteConfigService.normalizeValue('json', JSON.stringify(validObj));
      assert.deepStrictEqual(JSON.parse(res), validObj);

      assert.throws(() => remoteConfigService.normalizeValue('json', '{ bad json: true }'), /Invalid JSON/);
      assert.throws(() => remoteConfigService.normalizeValue('json', '{"unclosed": "string}'), /Invalid JSON/);
    });

    it('normalizes active status', () => {
      assert.strictEqual(remoteConfigService.normalizeActive(true), '1');
      assert.strictEqual(remoteConfigService.normalizeActive(false), '0');
      assert.strictEqual(remoteConfigService.normalizeActive('1'), '1');
      assert.strictEqual(remoteConfigService.normalizeActive('0'), '0');
      assert.strictEqual(remoteConfigService.normalizeActive('active'), '1');
      assert.strictEqual(remoteConfigService.normalizeActive('inactive'), '0');
    });
  });

  describe('3. Blade HTML Table & Application Card Parsing', () => {
    const sampleHtmlTable = `
      <table>
        <thead>
          <tr>
            <th>Sr. No</th><th>Application</th><th>Key</th><th>Value</th><th>Type</th><th>Active</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>1</td>
            <td>designwiz_test</td>
            <td>is_paywall_active</td>
            <td><pre>1</pre></td>
            <td>boolean</td>
            <td><span class="badge">Yes</span></td>
            <td>
              <a href="http://192.168.0.247:2315/admin/applications/designwiz/configs/141/edit">Update</a>
              <form method="POST" action="http://192.168.0.247:2315/admin/applications/designwiz/configs/141">
                <input type="hidden" name="_token" value="test_token_abc_123">
                <input type="hidden" name="_method" value="DELETE">
                <button type="submit">Delete</button>
              </form>
            </td>
          </tr>
          <tr>
            <td>2</td>
            <td>designwiz_test</td>
            <td>theme_config</td>
            <td><pre>{&quot;dark&quot;:true,&quot;accent&quot;:&quot;indigo&quot;}</pre></td>
            <td>json</td>
            <td><span class="badge">No</span></td>
            <td>
              <a href="http://192.168.0.247:2315/admin/applications/designwiz/configs/142/edit">Update</a>
            </td>
          </tr>
        </tbody>
      </table>
    `;

    it('extracts structured configuration records from HTML table', () => {
      const records = remoteConfigService.parseTable(sampleHtmlTable, 'android', 'designwiz');
      assert.strictEqual(records.length, 2);

      const first = records[0];
      assert.strictEqual(first.id, 141);
      assert.strictEqual(first.srNo, 1);
      assert.strictEqual(first.app, 'designwiz_test');
      assert.strictEqual(first.key, 'is_paywall_active');
      assert.strictEqual(first.value, '1');
      assert.strictEqual(first.type, 'boolean');
      assert.strictEqual(first.active, true);
      assert.strictEqual(first.updatedAt, null); // Documented limitation

      const second = records[1];
      assert.strictEqual(second.id, 142);
      assert.strictEqual(second.key, 'theme_config');
      assert.strictEqual(second.value, '{"dark":true,"accent":"indigo"}');
      assert.strictEqual(second.type, 'json');
      assert.strictEqual(second.active, false);
      assert.strictEqual(second.updatedAt, null);
    });

    it('extracts CSRF token from HTML forms and meta tags', () => {
      const formHtml = '<form><input type="hidden" name="_token" value="secret_csrf_999"></form>';
      assert.strictEqual(remoteConfigService._extractCsrf(formHtml), 'secret_csrf_999');

      const metaHtml = '<meta name="csrf-token" content="meta_csrf_token_888">';
      assert.strictEqual(remoteConfigService._extractCsrf(metaHtml), 'meta_csrf_token_888');

      assert.strictEqual(remoteConfigService._extractCsrf('<div>No token here</div>'), null);
    });

    it('parses application cards with h2 titles, slug, and config count', () => {
      const appsHtml = `
        <a href="http://192.168.0.247:2315/admin/applications/LogoMaker/configs">
          <div class="avatar">L</div>
          <div class="mt-5">
            <h2 class="text-lg">LogoMaker</h2>
            <p class="text-stone-400">LogoMaker</p>
            <p class="text-stone-500">10 configs</p>
          </div>
        </a>
        <a href="http://192.168.0.247:2315/admin/applications/postermaker/configs">
          <img src="logo.png" alt="Poster Maker">
          <div class="mt-5">
            <h2 class="text-lg">Poster Maker</h2>
            <p class="text-stone-400">postermaker</p>
            <p class="text-stone-500">7 configs</p>
          </div>
        </a>
      `;
      const apps = remoteConfigService.parseApplications(appsHtml, 'android');
      assert.strictEqual(apps.length, 2);
      assert.strictEqual(apps[0].slug, 'LogoMaker');
      assert.strictEqual(apps[0].name, 'LogoMaker');
      assert.strictEqual(apps[0].configCount, 10);
      assert.strictEqual(apps[1].slug, 'postermaker');
      assert.strictEqual(apps[1].name, 'Poster Maker');
      assert.strictEqual(apps[1].configCount, 7);
    });
  });

  describe('4. Safeguards, Redirects & Error Handling', () => {
    it('prevents false success: throws error if created key does not exist after upstream response', async () => {
      const originalGetConfigs = remoteConfigService.getConfigs;
      const originalAcquire = remoteConfigService._acquireFormContext;
      const originalRequest = remoteConfigService._request;

      try {
        remoteConfigService._acquireFormContext = async () => ({
          token: 'mock_token',
          cookies: 'mock_cookie=1',
          refererUrl: 'http://127.0.0.1/create',
          baseUrl: 'http://127.0.0.1'
        });

        // Upstream returns 200 with HTML validation error
        remoteConfigService._request = async () => ({
          statusCode: 200,
          headers: {},
          body: '<div class="text-red-500">The key has already been taken.</div>'
        });

        // List does NOT contain key
        remoteConfigService.getConfigs = async () => ({
          configs: []
        });

        await assert.rejects(
          async () => {
            await remoteConfigService.createConfig('android', 'designwiz', {
              key: 'duplicate_key',
              value: '1',
              type: 'boolean',
              is_active: '1'
            });
          },
          /The key has already been taken|Upstream rejected config creation/
        );
      } finally {
        remoteConfigService.getConfigs = originalGetConfigs;
        remoteConfigService._acquireFormContext = originalAcquire;
        remoteConfigService._request = originalRequest;
      }
    });

    it('distinguishes upstream 404 with UPSTREAM_404 error type', async () => {
      const originalRequest = remoteConfigService._request;
      try {
        remoteConfigService._request = async () => ({
          statusCode: 404,
          headers: {},
          body: 'Not Found'
        });

        await assert.rejects(
          async () => {
            await remoteConfigService.getConfigs('android', 'nonexistent_app');
          },
          (err) => {
            assert.strictEqual(err.type, 'UPSTREAM_404');
            assert.strictEqual(err.statusCode, 404);
            return true;
          }
        );
      } finally {
        remoteConfigService._request = originalRequest;
      }
    });

    it('throws error when upstream form does not contain CSRF token', async () => {
      const originalRequest = remoteConfigService._request;
      try {
        remoteConfigService._request = async () => ({
          statusCode: 200,
          headers: {},
          body: '<html><body>Login required or page corrupted</body></html>'
        });

        await assert.rejects(
          async () => {
            await remoteConfigService._acquireFormContext('android', 'designwiz', 'create');
          },
          /Upstream form did not contain a valid CSRF token/
        );
      } finally {
        remoteConfigService._request = originalRequest;
      }
    });

    it('throws error when upstream service returns HTTP 4xx or 5xx', async () => {
      const originalRequest = remoteConfigService._request;
      try {
        remoteConfigService._request = async () => ({
          statusCode: 503,
          headers: {},
          body: 'Service Unavailable'
        });

        await assert.rejects(
          async () => {
            await remoteConfigService.getConfigs('android', 'designwiz');
          },
          /HTTP 503/
        );
      } finally {
        remoteConfigService._request = originalRequest;
      }
    });
  });
});
