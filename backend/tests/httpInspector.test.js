const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const liveLogViewerPath = 'c:/Projects/ODR Test/frontend/src/components/LiveLogViewer.jsx';
const content = fs.readFileSync(liveLogViewerPath, 'utf-8');

// Extract all helper functions before the React component definition
const helperStart = content.indexOf('export const HTTP_STATUS_TEXTS');
const helperEnd = content.indexOf('export function JsonSyntaxViewer');
const helperBlock = content.substring(helperStart, helperEnd).replace(/export\s+/g, '');

const context = new Function(`
  ${helperBlock}

  return {
    sanitizeSensitiveData,
    formatBytes,
    formatDuration,
    extractQueryParams,
    formatHeaders,
    formatPayloadBody,
    getStructuredTransactionJson,
    tokenizeJsonLine,
    HTTP_STATUS_TEXTS,
    parseLogEntry,
    correlateLogs
  };
`)();

test('1. Sensitive Data Masking', async (t) => {
  await t.test('Masks Authorization Bearer tokens', () => {
    const raw = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
    const sanitized = context.sanitizeSensitiveData(raw);
    assert.strictEqual(sanitized, 'Authorization: Bearer [MASKED]');
  });

  await t.test('Masks Basic Auth headers', () => {
    const raw = 'Authorization: Basic YWRtaW46cGFzc3dvcmQ=';
    const sanitized = context.sanitizeSensitiveData(raw);
    assert.strictEqual(sanitized, 'Authorization: Basic [MASKED]');
  });

  await t.test('Masks JSON passwords, secrets, and api keys', () => {
    const raw = JSON.stringify({
      username: 'qa_user',
      password: 'superSecretPassword123',
      apiKey: 'api_sec_8f9a21b33',
      refresh_token: 'rf_998124791247'
    });
    const sanitized = context.sanitizeSensitiveData(raw);
    assert.match(sanitized, /"password":\s*"\*\*\*\*\*\*\*\*"/);
    assert.match(sanitized, /"apiKey":\s*"\*\*\*\*\*\*\*\*"/);
    assert.match(sanitized, /"refresh_token":\s*"\*\*\*\*\*\*\*\*"/);
  });

  await t.test('Masks query parameters with credentials', () => {
    const url = 'https://api.example.com/login?user=test&password=mySecretPassword&token=jwt_91823791238';
    const sanitized = context.sanitizeSensitiveData(url);
    assert.match(sanitized, /password=\*\*\*\*\*\*\*\*/);
    assert.match(sanitized, /token=\*\*\*\*\*\*\*\*/);
  });
});

test('2. Byte Size and Duration Formatters', async (t) => {
  await t.test('formatBytes formats bytes, KB, and MB accurately', () => {
    assert.strictEqual(context.formatBytes(119), '119 B');
    assert.strictEqual(context.formatBytes(18841), '18.4 KB');
    assert.strictEqual(context.formatBytes(1258291), '1.2 MB');
    assert.strictEqual(context.formatBytes(null), null);
  });

  await t.test('formatDuration formats ms and seconds accurately', () => {
    assert.strictEqual(context.formatDuration(842), '842 ms');
    assert.strictEqual(context.formatDuration(1930), '1.93 s');
    assert.strictEqual(context.formatDuration('500 ms'), '500 ms');
  });
});

test('3. Query Parameter Extraction', async (t) => {
  await t.test('Extracts query parameters into key-value pairs', () => {
    const url = 'https://flyerbuilder.app/api/public/api/getTemplateWithCatalogs?catalogId=123&type=premium';
    const params = context.extractQueryParams(url);
    assert.deepStrictEqual(params, [
      { key: 'catalogId', value: '123' },
      { key: 'type', value: 'premium' }
    ]);
  });

  await t.test('Returns null when no query string exists', () => {
    const url = 'https://flyerbuilder.app/api/public/api/getTemplateWithCatalogs';
    assert.strictEqual(context.extractQueryParams(url), null);
  });
});

test('4. Payload Body Formatting & Protection', async (t) => {
  await t.test('Pretty-prints JSON payload', () => {
    const jsonStr = '{"templateId":123,"category":"business"}';
    const formatted = context.formatPayloadBody(jsonStr);
    assert.strictEqual(formatted.isBinary, false);
    assert.strictEqual(formatted.isJson, true);
    assert.strictEqual(formatted.contentType, 'application/json');
    assert.strictEqual(formatted.text, JSON.stringify({ templateId: 123, category: 'business' }, null, 2));
  });

  await t.test('Detects binary image and octet-stream payloads without dumping raw bytes', () => {
    const binary = context.formatPayloadBody('RAW_BINARY_DATA', 'image/png');
    assert.strictEqual(binary.isBinary, true);
    assert.strictEqual(binary.text, '[Binary Content: image/png]');
  });

  await t.test('Truncates bodies exceeding 1 MB safety limit', () => {
    const hugeBody = 'A'.repeat(1024 * 1024 + 500);
    const formatted = context.formatPayloadBody(hugeBody);
    assert.strictEqual(formatted.isTruncated, true);
    assert.match(formatted.text, /\[TRUNCATED — original size: 1\.0 MB\]/);
  });
});

test('5. Real Volley HTTP Transaction Parsing', async (t) => {
  await t.test('Parses structured [VOLLEY_HTTP_TRANSACTION] log string with request and response details', () => {
    const transaction = {
      type: 'API',
      requestId: 'api-7f9a12b',
      method: 'POST',
      url: 'http://192.168.0.110/photo_editor_lab_backend/api/public/api/generateProfilePictureV2',
      durationMs: 10650,
      request: {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test_token_xyz'
        },
        body: {
          prompt: 'Modern profile portrait',
          category: 'business'
        }
      },
      response: {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': '606'
        },
        body: {
          success: true,
          imageUrl: 'http://192.168.0.110/output/portrait_9182.jpg'
        },
        bodySize: 606
      }
    };

    const rawLine = '[VOLLEY_HTTP_TRANSACTION] ' + JSON.stringify(transaction);
    const parsed = context.parseLogEntry(rawLine, 0);

    assert.strictEqual(parsed.category, 'API');
    assert.strictEqual(parsed.apiDetails.method, 'POST');
    assert.strictEqual(parsed.apiDetails.endpoint, 'http://192.168.0.110/photo_editor_lab_backend/api/public/api/generateProfilePictureV2');
    assert.strictEqual(parsed.status, 200);
    assert.strictEqual(parsed.duration, '10.65 s');
    assert.strictEqual(parsed.apiDetails.responseSize, '606 B');
    assert.strictEqual(parsed.apiDetails.isFullTransaction, true);
    assert.match(parsed.apiDetails.requestHeaders, /Content-Type: application\/json/);
    assert.match(parsed.apiDetails.requestHeaders, /Authorization: Bearer \[MASKED\]/);
    assert.strictEqual(parsed.apiDetails.requestBody.isJson, true);
    assert.strictEqual(parsed.apiDetails.responseBody.isJson, true);
  });

  await t.test('Parses Volley slow request log line as fallback', () => {
    const volleyLine = 'Volley : [4608] NetworkUtility.logSlowRequests: HTTP response for request=<[POST] http://192.168.0.110/api/generateAiFlyerImage 0x85adf673 NORMAL 19> [lifetime=842], [size=18841], [rc=200], [retryCount=0]';
    const parsed = context.parseLogEntry(volleyLine, 1);
    assert.strictEqual(parsed.category, 'API');
    assert.strictEqual(parsed.apiDetails.method, 'POST');
    assert.strictEqual(parsed.apiDetails.endpoint, 'http://192.168.0.110/api/generateAiFlyerImage');
    assert.strictEqual(parsed.status, 200);
    assert.strictEqual(parsed.duration, '842 ms');
    assert.strictEqual(parsed.apiDetails.responseSize, '18.4 KB');
  });

  await t.test('Parses API_TO_CALL log line with Request body', () => {
    const apiLine = 'API_TO_CALL: URL :- https://flyerbuilder.app/api/public/api/getTemplateWithCatalogs?catalogId=123 Request: {"id":123}';
    const parsed = context.parseLogEntry(apiLine, 2);
    assert.strictEqual(parsed.category, 'API');
    assert.strictEqual(parsed.apiDetails.endpoint, 'https://flyerbuilder.app/api/public/api/getTemplateWithCatalogs?catalogId=123');
    assert.strictEqual(parsed.apiDetails.queryParams[0].key, 'catalogId');
    assert.strictEqual(parsed.apiDetails.queryParams[0].value, '123');
    assert.strictEqual(parsed.apiDetails.requestBody.isJson, true);
  });

  await t.test('Parses generatePhotoshoot request and formats all fields correctly', () => {
    const apiLine = '10-05 16:43:09.871 11382 11382 I AIToolsHelper: API_TO_CALL: http://192.168.0.110/photo_editor_lab_backend/api/public/api/generatePhotoshoot\tRequest: {"app_id":2,"country_code":"in","gender":"male","user_choice":"old_money","user_id":440}';
    const parsed = context.parseLogEntry(apiLine, 3);
    assert.strictEqual(parsed.category, 'API');
    assert.strictEqual(parsed.apiDetails.method, 'POST');
    assert.strictEqual(parsed.apiDetails.endpoint, 'http://192.168.0.110/photo_editor_lab_backend/api/public/api/generatePhotoshoot');
    assert.strictEqual(parsed.apiDetails.requestBody.isJson, true);
    assert.match(parsed.apiDetails.requestBody.text, /old_money/);
  });

  await t.test('Parses PhotoMultipartRequest response payload', () => {
    const respLine = '10-05 16:43:32.459 11382 11514 I PhotoMultipartRequest: {"code":200,"message":"Photoshoot image generated successfully","data":{"url":"https://example.com/photo.png","total_credits":150}}';
    const jsonBody = context.formatPayloadBody(respLine.substring(respLine.indexOf('{')));
    assert.strictEqual(jsonBody.isJson, true);
    assert.match(jsonBody.text, /Photoshoot image generated successfully/);
  });
});

test('7. Full HTTP Inspector JSON View Structure & Masking', async (t) => {
  await t.test('Generates structured JSON object from parsed API entry', () => {
    const entry = {
      id: 'log-10',
      time: '16:43:09',
      status: 200,
      duration: '22.58 s',
      category: 'API',
      apiDetails: {
        requestId: 'req-photoshoot-01',
        method: 'POST',
        endpoint: 'http://192.168.0.110/photo_editor_lab_backend/api/public/api/generatePhotoshoot?source=studio',
        queryParams: [{ key: 'source', value: 'studio' }],
        requestHeaders: 'Authorization: Bearer [MASKED]\nContent-Type: application/json',
        requestBody: {
          text: JSON.stringify({ app_id: 2, user_choice: 'old_money', user_id: 440 })
        },
        responseHeaders: 'Content-Type: application/json; charset=utf-8',
        responseBody: {
          text: JSON.stringify({ code: 200, message: 'Photoshoot image generated successfully' })
        },
        responseSize: '244 B',
        status: 200,
        statusText: 'OK',
        duration: '22.58 s',
        error: null
      }
    };

    const jsonObj = context.getStructuredTransactionJson(entry);
    assert.strictEqual(jsonObj.requestId, 'req-photoshoot-01');
    assert.strictEqual(jsonObj.request.method, 'POST');
    assert.strictEqual(jsonObj.request.url, 'http://192.168.0.110/photo_editor_lab_backend/api/public/api/generatePhotoshoot?source=studio');
    assert.strictEqual(jsonObj.request.queryParams.source, 'studio');
    assert.strictEqual(jsonObj.request.headers.Authorization, 'Bearer [MASKED]');
    assert.strictEqual(jsonObj.request.headers['Content-Type'], 'application/json');
    assert.strictEqual(jsonObj.request.body.user_choice, 'old_money');
    assert.strictEqual(jsonObj.response.status, 200);
    assert.strictEqual(jsonObj.response.statusText, 'OK');
    assert.strictEqual(jsonObj.response.size, '244 B');
    assert.strictEqual(jsonObj.response.duration, '22.58 s');
    assert.strictEqual(jsonObj.response.body.code, 200);
    assert.strictEqual(jsonObj.error, null);

    // Verify formatted serialization
    const serialized = JSON.stringify(jsonObj, null, 2);
    assert.match(serialized, /"user_choice": "old_money"/);
    assert.match(serialized, /"Authorization": "Bearer \[MASKED\]"/);
  });

  await t.test('Preserves nulls safely when optional fields are missing', () => {
    const entry = {
      id: 'log-11',
      time: '16:44:00',
      category: 'API',
      apiDetails: {
        method: 'GET',
        endpoint: 'https://api.example.com/status',
        queryParams: null,
        requestHeaders: null,
        requestBody: null,
        responseHeaders: null,
        responseBody: null,
        status: 200,
        statusText: 'OK',
        duration: '50 ms',
        responseSize: '12 B',
        error: null
      }
    };

    const jsonObj = context.getStructuredTransactionJson(entry);
    assert.strictEqual(jsonObj.request.queryParams, null);
    assert.strictEqual(jsonObj.request.headers, null);
    assert.strictEqual(jsonObj.request.body, null);
    assert.strictEqual(jsonObj.response.headers, null);
    assert.strictEqual(jsonObj.response.body, null);
  });
});

test('8. Console Maximize / Expand Overlay & Keyboard Shortcuts', async (t) => {
  await t.test('LiveLogViewer component includes expand/minimize button with aria-labels and tooltips', () => {
    assert.match(content, /aria-label=\{isMaximized \? "Close Expanded Live Execution Console" : "Expand Live Execution Console"\}/);
    assert.match(content, /title=\{isMaximized \? "Close Expanded Console" : "Expand Console"\}/);
    assert.match(content, /<Maximize2/);
    assert.match(content, /<Minimize2/);
  });

  await t.test('LiveLogViewer component includes dedicated close button in expanded mode', () => {
    assert.match(content, /aria-label="Close Expanded Live Execution Console"/);
    assert.match(content, /title="Close Expanded Console"/);
    assert.match(content, /<X className="w-3.5 h-3.5"/);
  });

  await t.test('ESC keydown listener closes expanded overlay without resetting state', () => {
    assert.match(content, /if\s*\(e\.key === 'Escape' \|\| e\.keyCode === 27\)\s*\{\s*e\.preventDefault\(\);\s*setIsMaximized\(false\);/);
    assert.match(content, /window\.addEventListener\('keydown',\s*handleKeyDown\);/);
    assert.match(content, /window\.removeEventListener\('keydown',\s*handleKeyDown\);/);
  });

  await t.test('Body scroll lock is applied when expanded and cleaned up on close', () => {
    assert.match(content, /document\.body\.style\.overflow = 'hidden';/);
    assert.match(content, /document\.body\.style\.overflow = originalOverflow;/);
  });

  await t.test('Expanded modal container uses high z-index and centered 58vw x 92vh viewport sizing', () => {
    assert.match(content, /fixed inset-0 z-50 bg-black\/80/);
    assert.match(content, /md:w-\[58vw\] md:h-\[92vh\] max-w-\[1200px\] max-h-\[900px\]/);
    assert.match(content, /role="dialog"/);
    assert.match(content, /aria-modal="true"/);
  });
});

test('9. Postman-Style JSON Syntax Highlighting', async (t) => {
  await t.test('Tokenizes property keys, strings, numbers, booleans, and nulls with proper classifications', () => {
    const line = '  "requestId": "req-photoshoot-01",';
    const tokens = context.tokenizeJsonLine(line);

    assert.ok(tokens.some(t => t.type === 'key' && t.text === '"requestId"'));
    assert.ok(tokens.some(t => t.type === 'string' && t.text === '"req-photoshoot-01"'));
    assert.ok(tokens.some(t => t.type === 'punctuation' && t.text === ':'));
    assert.ok(tokens.some(t => t.type === 'punctuation' && t.text === ','));
  });

  await t.test('Tokenizes numbers, booleans, and null values accurately', () => {
    const numLine = '  "status": 200,';
    const numTokens = context.tokenizeJsonLine(numLine);
    assert.ok(numTokens.some(t => t.type === 'number' && t.text === '200'));

    const boolLine = '  "success": true,';
    const boolTokens = context.tokenizeJsonLine(boolLine);
    assert.ok(boolTokens.some(t => t.type === 'boolean' && t.text === 'true'));

    const nullLine = '  "error": null,';
    const nullTokens = context.tokenizeJsonLine(nullLine);
    assert.ok(nullTokens.some(t => t.type === 'null' && t.text === 'null'));
  });

  await t.test('Tokenizes complex nested arrays and objects with escaped strings', () => {
    const complexLine = '    "prompt": "Style \\"Old Money\\" portrait",';
    const tokens = context.tokenizeJsonLine(complexLine);
    assert.ok(tokens.some(t => t.type === 'key' && t.text === '"prompt"'));
    assert.ok(tokens.some(t => t.type === 'string' && t.text === '"Style \\"Old Money\\" portrait"'));
  });

  await t.test('LiveLogViewer uses JsonSyntaxViewer component with Postman color classes', () => {
    assert.match(content, /text-\[#79C0FF\]/); // Light blue keys
    assert.match(content, /text-\[#A5D6A7\]/); // Light green strings
    assert.match(content, /text-\[#FFB86C\]/); // Orange numbers
    assert.match(content, /text-\[#C792EA\]/); // Purple booleans
    assert.match(content, /text-\[#F07178\]/); // Muted red nulls
    assert.match(content, /text-\[#C9D1D9\]/); // Light gray brackets/braces/commas
  });
});

test('10. Long JSON Line Wrapping & Structure', async (t) => {
  await t.test('JsonSyntaxViewer applies whitespace-pre-wrap, break-words, and overflow-wrap for natural wrapping', () => {
    assert.match(content, /whitespace-pre-wrap/);
    assert.match(content, /break-words/);
    assert.match(content, /\[overflow-wrap:anywhere\]/);
    assert.match(content, /table-fixed/);
  });

  await t.test('Preserves 2-space indentation and valid JSON formatting across wrapped lines', () => {
    const raw = {
      description: 'Very long parameter string that should automatically wrap across multiple lines without requiring horizontal scrolling while preserving indentation',
      nested: {
        endpointUrl: 'http://192.168.0.110/photo_editor_lab_backend/api/public/api/generatePhotoshoot?long_query_param_key=long_query_param_value_1234567890_abcdefghij'
      }
    };
    const formatted = JSON.stringify(raw, null, 2);
    const lines = formatted.split('\n');
    assert.strictEqual(lines[1].startsWith('  "description":'), true);
    assert.strictEqual(lines[2].startsWith('  "nested":'), true);
    assert.strictEqual(lines[3].startsWith('    "endpointUrl":'), true);
  });
});

test('11. Copy Formatted JSON & Sanitization', async (t) => {
  await t.test('Copies sanitized JSON when in json view mode', () => {
    assert.match(content, /const transactionObj = getStructuredTransactionJson\(entry\);/);
    assert.match(content, /reportText = JSON\.stringify\(transactionObj, null, 2\);/);
    assert.match(content, /navigator\.clipboard\.writeText\(sanitizeSensitiveData\(reportText\)\);/);
    assert.match(content, /currentMode === 'json' \? 'Copied JSON' : 'Copied Report'/);
    assert.match(content, /currentMode === 'json' \? 'Copy JSON' : 'Copy Details'/);
  });
});

test('12. Unified Transaction Object & Toggle Integrity', async (t) => {
  await t.test('Inspector and JSON views share the exact same underlying transaction data', () => {
    const entry = {
      id: 'log-unified-01',
      time: '15:10:00',
      status: 200,
      duration: '1.5 s',
      category: 'API',
      apiDetails: {
        requestId: 'req-unified-99',
        method: 'POST',
        endpoint: 'http://192.168.0.110/api/v1/test',
        queryParams: [{ key: 'page', value: '1' }],
        requestHeaders: 'Authorization: Bearer [MASKED]',
        requestBody: { text: '{"action":"start"}' },
        responseHeaders: 'Content-Type: application/json',
        responseBody: { text: '{"status":"ok"}' },
        responseSize: '150 B',
        status: 200,
        statusText: 'OK',
        duration: '1.5 s',
        error: null
      }
    };

    const jsonObj = context.getStructuredTransactionJson(entry);
    assert.strictEqual(jsonObj.requestId, entry.apiDetails.requestId);
    assert.strictEqual(jsonObj.request.method, entry.apiDetails.method);
    assert.strictEqual(jsonObj.request.url, entry.apiDetails.endpoint);
    assert.strictEqual(jsonObj.response.status, entry.apiDetails.status);
    assert.strictEqual(jsonObj.response.duration, entry.apiDetails.duration);
    assert.strictEqual(jsonObj.response.size, entry.apiDetails.responseSize);
  });
});

test('13. Immutable API Transaction History & Event Retention (Phase 3A)', async (t) => {
  await t.test('Multiple consecutive calls to the same endpoint produce separate permanent records', () => {
    const rawLogs = [
      // Request 1
      'API_TO_CALL: URL :- http://192.168.0.110/api/generateImage Request: {"prompt":"A"}',
      'Volley : NetworkUtility.logSlowRequests: HTTP response for request=<[POST] http://192.168.0.110/api/generateImage> [lifetime=2100], [size=1024], [rc=200]',
      'PhotoMultipartRequest: {"status":"success","url":"http://cdn.test/imgA.png"}',

      // Request 2 (same URL, different body, different response)
      'API_TO_CALL: URL :- http://192.168.0.110/api/generateImage Request: {"prompt":"B"}',
      'Volley : NetworkUtility.logSlowRequests: HTTP response for request=<[POST] http://192.168.0.110/api/generateImage> [lifetime=1800], [size=2048], [rc=200]',
      'PhotoMultipartRequest: {"status":"success","url":"http://cdn.test/imgB.png"}',

      // Request 3 (same URL, different body, error response 500)
      'API_TO_CALL: URL :- http://192.168.0.110/api/generateImage Request: {"prompt":"C"}',
      'Volley : NetworkUtility.logSlowRequests: HTTP response for request=<[POST] http://192.168.0.110/api/generateImage> [lifetime=3200], [size=512], [rc=500]',
      'PhotoMultipartRequest: {"status":"error","message":"Out of memory"}'
    ];

    const correlated = context.correlateLogs(rawLogs);
    const apiRecords = correlated.filter(e => e.category === 'API');

    assert.strictEqual(apiRecords.length, 3, 'Must produce exactly 3 separate API transactions, no overwrites');

    // Verify Record 1
    assert.strictEqual(apiRecords[0].status, 200);
    assert.strictEqual(apiRecords[0].duration, '2.10 s');
    assert.strictEqual(apiRecords[0].apiDetails.endpoint, 'http://192.168.0.110/api/generateImage');
    assert.match(apiRecords[0].apiDetails.requestBody.text, /"prompt":\s*"A"/);
    assert.match(apiRecords[0].apiDetails.responseBody.text, /imgA\.png/);

    // Verify Record 2
    assert.strictEqual(apiRecords[1].status, 200);
    assert.strictEqual(apiRecords[1].duration, '1.80 s');
    assert.strictEqual(apiRecords[1].apiDetails.endpoint, 'http://192.168.0.110/api/generateImage');
    assert.match(apiRecords[1].apiDetails.requestBody.text, /"prompt":\s*"B"/);
    assert.match(apiRecords[1].apiDetails.responseBody.text, /imgB\.png/);

    // Verify Record 3
    assert.strictEqual(apiRecords[2].status, 500);
    assert.strictEqual(apiRecords[2].duration, '3.20 s');
    assert.strictEqual(apiRecords[2].apiDetails.endpoint, 'http://192.168.0.110/api/generateImage');
    assert.match(apiRecords[2].apiDetails.requestBody.text, /"prompt":\s*"C"/);
    assert.match(apiRecords[2].apiDetails.responseBody.text, /Out of memory/);

    // Verify unique IDs
    assert.notStrictEqual(apiRecords[0].id, apiRecords[1].id);
    assert.notStrictEqual(apiRecords[1].id, apiRecords[2].id);
    assert.notStrictEqual(apiRecords[0].apiDetails.requestId, apiRecords[1].apiDetails.requestId);
    assert.notStrictEqual(apiRecords[1].apiDetails.requestId, apiRecords[2].apiDetails.requestId);
  });

  await t.test('Full [VOLLEY_HTTP_TRANSACTION] entries repeated to the same endpoint create distinct entries', () => {
    const rawLogs = [
      '[VOLLEY_HTTP_TRANSACTION] ' + JSON.stringify({
        url: 'http://192.168.0.110/api/getTemplates',
        method: 'GET',
        status: 200,
        durationMs: 120,
        response: { status: 200, body: JSON.stringify({ count: 10 }) }
      }),
      '[VOLLEY_HTTP_TRANSACTION] ' + JSON.stringify({
        url: 'http://192.168.0.110/api/getTemplates',
        method: 'GET',
        status: 200,
        durationMs: 95,
        response: { status: 200, body: JSON.stringify({ count: 15 }) }
      }),
      '[VOLLEY_HTTP_TRANSACTION] ' + JSON.stringify({
        url: 'http://192.168.0.110/api/getTemplates',
        method: 'GET',
        status: 304,
        durationMs: 40,
        response: { status: 304, body: '' }
      })
    ];

    const correlated = context.correlateLogs(rawLogs);
    const apiRecords = correlated.filter(e => e.category === 'API');

    assert.strictEqual(apiRecords.length, 3);
    assert.strictEqual(apiRecords[0].status, 200);
    assert.strictEqual(apiRecords[0].duration, '120 ms');
    assert.strictEqual(apiRecords[1].status, 200);
    assert.strictEqual(apiRecords[1].duration, '95 ms');
    assert.strictEqual(apiRecords[2].status, 304);
    assert.strictEqual(apiRecords[2].duration, '40 ms');
  });

  await t.test('Concurrent in-flight requests to same endpoint pair responses in FIFO order', () => {
    const rawLogs = [
      'API_TO_CALL: URL :- http://192.168.0.110/api/item?id=1 Request: {"req":1}',
      'API_TO_CALL: URL :- http://192.168.0.110/api/item?id=2 Request: {"req":2}',
      'Volley : NetworkUtility.logSlowRequests: HTTP response for request=<[GET] http://192.168.0.110/api/item?id=1> [lifetime=150], [rc=200]',
      'PhotoMultipartRequest: {"item":1}',
      'Volley : NetworkUtility.logSlowRequests: HTTP response for request=<[GET] http://192.168.0.110/api/item?id=2> [lifetime=250], [rc=200]',
      'PhotoMultipartRequest: {"item":2}'
    ];

    const correlated = context.correlateLogs(rawLogs);
    const apiRecords = correlated.filter(e => e.category === 'API');

    assert.strictEqual(apiRecords.length, 2);
    assert.match(apiRecords[0].apiDetails.requestBody.text, /"req":\s*1/);
    assert.match(apiRecords[0].apiDetails.responseBody.text, /"item":\s*1/);
    assert.strictEqual(apiRecords[0].duration, '150 ms');

    assert.match(apiRecords[1].apiDetails.requestBody.text, /"req":\s*2/);
    assert.match(apiRecords[1].apiDetails.responseBody.text, /"item":\s*2/);
    assert.strictEqual(apiRecords[1].duration, '250 ms');
  });

  await t.test('Secondary Volley logSlowRequests backfills duration without creating duplicate or corrupting prior calls', () => {
    const rawLogs = [
      // Call 1
      '[VOLLEY_HTTP_TRANSACTION] ' + JSON.stringify({
        url: 'http://192.168.0.110/api/profile',
        method: 'POST',
        status: 200,
        response: { status: 200, body: '{"user":"alice"}' }
      }),
      'Volley : NetworkUtility.logSlowRequests: HTTP response for request=<[POST] http://192.168.0.110/api/profile> [lifetime=500], [size=256], [rc=200]',

      // Call 2
      '[VOLLEY_HTTP_TRANSACTION] ' + JSON.stringify({
        url: 'http://192.168.0.110/api/profile',
        method: 'POST',
        status: 200,
        response: { status: 200, body: '{"user":"bob"}' }
      }),
      'Volley : NetworkUtility.logSlowRequests: HTTP response for request=<[POST] http://192.168.0.110/api/profile> [lifetime=650], [size=300], [rc=200]'
    ];

    const correlated = context.correlateLogs(rawLogs);
    const apiRecords = correlated.filter(e => e.category === 'API');

    assert.strictEqual(apiRecords.length, 2);
    assert.strictEqual(apiRecords[0].duration, '500 ms');
    assert.strictEqual(apiRecords[0].apiDetails.responseSize, '256 B');
    assert.match(apiRecords[0].apiDetails.responseBody.text, /alice/);

    assert.strictEqual(apiRecords[1].duration, '650 ms');
    assert.strictEqual(apiRecords[1].apiDetails.responseSize, '300 B');
    assert.match(apiRecords[1].apiDetails.responseBody.text, /bob/);
  });

  await t.test('RunTestPage buffer pruning preserves API transactions while pruning general logcat', () => {
    const runTestPageContent = fs.readFileSync('c:/Projects/ODR Test/frontend/src/pages/RunTestPage.jsx', 'utf-8');
    assert.match(runTestPageContent, /prev\.length > 3000/);
    assert.match(runTestPageContent, /const apiLogs = prev\.filter\(isApi\);/);
    assert.match(runTestPageContent, /const retainedNonApi = nonApiLogs\.slice\(-2000\);/);
    assert.match(runTestPageContent, /return \[\.\.\.apiLogs, \.\.\.retainedNonApi, data\.log\];/);
  });
});



