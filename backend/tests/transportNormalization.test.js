const test = require('node:test');
const assert = require('node:assert');

// Simulate AndroidDeviceTransport.normalizeCommandResult
function normalizeCommandResult(rawResult) {
  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  let error = null;

  if (rawResult === null || rawResult === undefined) {
    stdout = '';
    stderr = '';
    exitCode = 0;
  } else if (typeof rawResult === 'string') {
    stdout = rawResult;
  } else if (rawResult instanceof Uint8Array || rawResult instanceof ArrayBuffer) {
    stdout = new TextDecoder().decode(rawResult);
  } else if (typeof rawResult === 'object') {
    if (rawResult.stdout !== undefined) {
      if (typeof rawResult.stdout === 'string') {
        stdout = rawResult.stdout;
      } else if (rawResult.stdout instanceof Uint8Array || rawResult.stdout instanceof ArrayBuffer) {
        stdout = new TextDecoder().decode(rawResult.stdout);
      } else {
        stdout = String(rawResult.stdout || '');
      }
    }

    if (rawResult.stderr !== undefined) {
      if (typeof rawResult.stderr === 'string') {
        stderr = rawResult.stderr;
      } else if (rawResult.stderr instanceof Uint8Array || rawResult.stderr instanceof ArrayBuffer) {
        stderr = new TextDecoder().decode(rawResult.stderr);
      } else {
        stderr = String(rawResult.stderr || '');
      }
    }

    if (typeof rawResult.exitCode === 'number') {
      exitCode = rawResult.exitCode;
    } else if (typeof rawResult.code === 'number') {
      exitCode = rawResult.code;
    }

    if (rawResult.error) {
      error = typeof rawResult.error === 'string' ? rawResult.error : (rawResult.error.message || String(rawResult.error));
    }
  } else {
    stdout = String(rawResult);
  }

  stdout = typeof stdout === 'string' ? stdout : '';
  stderr = typeof stderr === 'string' ? stderr : '';

  const isSuccess = exitCode === 0 && !error;
  const combinedRaw = stdout + (stderr ? (stdout ? '\n' : '') + stderr : '');

  return {
    success: isSuccess,
    stdout,
    stderr,
    exitCode,
    error: isSuccess ? null : (error || stderr || stdout || 'Command failed'),
    raw: combinedRaw
  };
}

test('Android Device Transport Normalization Suite', async (t) => {
  await t.test('1. Normalizes string output from noneProtocol', () => {
    const raw = 'Success\r\n';
    const norm = normalizeCommandResult(raw);
    assert.strictEqual(norm.success, true);
    assert.strictEqual(typeof norm.stdout, 'string');
    assert.strictEqual(norm.stdout.includes('Success'), true);
    assert.strictEqual(norm.exitCode, 0);
  });

  await t.test('2. Normalizes ShellProtocol object output ({ stdout, stderr, exitCode })', () => {
    const raw = {
      stdout: 'Success\r\n',
      stderr: '',
      exitCode: 0
    };
    const norm = normalizeCommandResult(raw);
    assert.strictEqual(norm.success, true);
    assert.strictEqual(typeof norm.stdout, 'string');
    assert.strictEqual(norm.stdout.includes('Success'), true);
    assert.strictEqual(norm.exitCode, 0);
  });

  await t.test('3. Normalizes binary Uint8Array output', () => {
    const encoder = new TextEncoder();
    const raw = encoder.encode('package:com.example.app\r\n');
    const norm = normalizeCommandResult(raw);
    assert.strictEqual(norm.success, true);
    assert.strictEqual(typeof norm.stdout, 'string');
    assert.strictEqual(norm.stdout.includes('package:com.example.app'), true);
  });

  await t.test('4. Normalizes ArrayBuffer output', () => {
    const encoder = new TextEncoder();
    const raw = encoder.encode('1080x2400').buffer;
    const norm = normalizeCommandResult(raw);
    assert.strictEqual(norm.success, true);
    assert.strictEqual(typeof norm.stdout, 'string');
    assert.strictEqual(norm.stdout.includes('1080'), true);
  });

  await t.test('5. Handles null and undefined outputs safely without exceptions', () => {
    const normNull = normalizeCommandResult(null);
    assert.strictEqual(typeof normNull.stdout, 'string');
    assert.strictEqual(normNull.stdout.includes('Success'), false);

    const normUndef = normalizeCommandResult(undefined);
    assert.strictEqual(typeof normUndef.stdout, 'string');
    assert.strictEqual(normUndef.stdout.includes('Success'), false);
  });

  await t.test('6. Normalizes error and non-zero exit codes', () => {
    const raw = {
      stdout: '',
      stderr: 'Error: package not found',
      exitCode: 1
    };
    const norm = normalizeCommandResult(raw);
    assert.strictEqual(norm.success, false);
    assert.strictEqual(typeof norm.stdout, 'string');
    assert.strictEqual(typeof norm.stderr, 'string');
    assert.strictEqual(norm.stderr.includes('package not found'), true);
    assert.strictEqual(norm.exitCode, 1);
  });

  await t.test('7. Repeated operations on WebADB outputs never fail with .includes is not a function', () => {
    const webAdbResponses = [
      { stdout: 'Success\r\n', stderr: '', exitCode: 0 },
      { stdout: 'Success\r\n', stderr: '', exitCode: 0 },
      { stdout: 'Success\r\n', stderr: '', exitCode: 0 },
      { stdout: 'Success\r\n', stderr: '', exitCode: 0 },
      { stdout: 'Success\r\n', stderr: '', exitCode: 0 }
    ];

    for (let i = 0; i < webAdbResponses.length; i++) {
      const norm = normalizeCommandResult(webAdbResponses[i]);
      assert.doesNotThrow(() => {
        const isSuccess = norm.stdout.includes('Success');
        assert.strictEqual(isSuccess, true);
      }, `Iteration ${i + 1} must not throw`);
    }
  });
});
