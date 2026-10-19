const { describe, test, before, after } = require('node:test');
const assert = require('node:assert');
const bugDeskService = require('../src/services/bugDeskService');
const bugDeskController = require('../src/controllers/bugDeskController');

describe('BugDesk Backend Service & Controller Suite', () => {
  const originalFetch = global.fetch;

  after(() => {
    global.fetch = originalFetch;
  });

  test('1. rewriteBug rejects missing API key with 400', async () => {
    await assert.rejects(
      async () => {
        await bugDeskService.rewriteBug({ rawNotes: 'Test note', apiKey: '' });
      },
      (err) => {
        assert.strictEqual(err.status, 400);
        assert.match(err.message, /Missing Gemini API key/i);
        return true;
      }
    );
  });

  test('2. rewriteBug rejects empty raw notes with 400', async () => {
    await assert.rejects(
      async () => {
        await bugDeskService.rewriteBug({ rawNotes: '   ', apiKey: 'fake_key_123' });
      },
      (err) => {
        assert.strictEqual(err.status, 400);
        assert.match(err.message, /Raw QA notes are required/i);
        return true;
      }
    );
  });

  test('3. rewriteBug successfully parses valid Gemini JSON response', async () => {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    title: 'Coin icon disappears after plan purchase inside editor',
                    steps: [
                      'Open Flyer Maker application as a free user',
                      'Tap Generate Custom Flyer option',
                      'Purchase any subscription plan inside the editor',
                      'Return to the result screen'
                    ],
                    actualResult: 'Coin icon is not visible and Regenerate button is disabled',
                    expectedResult: 'Coin icon should remain visible with updated balance and Regenerate button should be active'
                  })
                }
              ]
            }
          }
        ]
      })
    });

    const result = await bugDeskService.rewriteBug({
      rawNotes: 'Coin icon missing after buying plan in editor',
      apiKey: 'valid_mock_key',
      model: 'gemini-2.5-flash'
    });

    assert.strictEqual(result.title, 'Coin icon disappears after plan purchase inside editor');
    assert.strictEqual(result.steps.length, 4);
    assert.strictEqual(result.actualResult, 'Coin icon is not visible and Regenerate button is disabled');
    assert.ok(result.expectedResult.includes('Coin icon should remain visible'));
  });

  test('4. testConnection rejects missing API key with 400', async () => {
    await assert.rejects(
      async () => {
        await bugDeskService.testConnection({ apiKey: '' });
      },
      (err) => {
        assert.strictEqual(err.status, 400);
        assert.match(err.message, /Missing Gemini API key/i);
        return true;
      }
    );
  });

  test('5. testConnection returns { connected: true } on 200 response', async () => {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [] })
    });

    const res = await bugDeskService.testConnection({ apiKey: 'valid_mock_key' });
    assert.strictEqual(res.connected, true);
  });

  test('6. bugDeskController blocks unauthenticated requests with 401', async () => {
    let statusCode = null;
    let jsonBody = null;
    const res = {
      status: (code) => { statusCode = code; return res; },
      json: (data) => { jsonBody = data; return res; }
    };

    // rewriteBug without user
    await bugDeskController.rewriteBug({ user: null, body: { rawNotes: 'note' } }, res, () => {});
    assert.strictEqual(statusCode, 401);
    assert.match(jsonBody.error, /Authentication required/i);

    // testConnection without user
    statusCode = null;
    jsonBody = null;
    await bugDeskController.testConnection({ user: null, body: { apiKey: 'key' } }, res, () => {});
    assert.strictEqual(statusCode, 401);
    assert.strictEqual(jsonBody.connected, false);
    assert.match(jsonBody.error, /Authentication required/i);
  });

  test('7. bugDeskController processes request for authenticated user', async () => {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    title: 'Authenticated User Bug',
                    steps: ['Step 1'],
                    actualResult: 'Failed',
                    expectedResult: 'Pass'
                  })
                }
              ]
            }
          }
        ]
      })
    });

    let statusCode = 200;
    let jsonBody = null;
    const res = {
      status: (code) => { statusCode = code; return res; },
      json: (data) => { jsonBody = data; return res; }
    };

    const mockUser = { id: 'usr_auth_tester', name: 'Tester', email: 'tester@qa.test' };
    await bugDeskController.rewriteBug(
      { user: mockUser, body: { rawNotes: 'sample note', apiKey: 'key_123' } },
      res,
      () => {}
    );

    assert.strictEqual(statusCode, 200);
    assert.strictEqual(jsonBody.title, 'Authenticated User Bug');
    assert.deepStrictEqual(jsonBody.steps, ['Step 1']);
  });
});

describe('BugDesk Optional Round & Report Formatting Suite', () => {
  let reportFormat;

  before(async () => {
    reportFormat = await import('../../frontend/src/bugdesk/lib/report-format.js');
  });

  test('1. buildHeading includes round when round is populated', () => {
    const report = {
      project: 'Flyer Maker (V 187.0.187)',
      module: 'AI Video Editor',
      round: 'R-1',
      title: 'Crash on clicking save'
    };
    const heading = reportFormat.buildHeading(report);
    assert.strictEqual(heading, 'Flyer Maker (V 187.0.187) AI Video Editor (R-1) : Crash on clicking save');
  });

  test('2. buildHeading omits round when round is empty string', () => {
    const report = {
      project: 'Flyer Maker (V 187.0.187)',
      module: 'AI Video Editor',
      round: '',
      title: 'Crash on clicking save'
    };
    const heading = reportFormat.buildHeading(report);
    assert.strictEqual(heading, 'Flyer Maker (V 187.0.187) AI Video Editor : Crash on clicking save');
    assert.ok(!heading.includes('()'));
    assert.ok(!heading.includes('undefined'));
    assert.ok(!heading.includes('null'));
    assert.ok(!heading.includes('R-1'));
  });

  test('3. buildHeading omits round when round is whitespace only', () => {
    const report = {
      project: 'Flyer Maker (V 187.0.187)',
      module: 'AI Video Editor',
      round: '   ',
      title: 'Crash on clicking save'
    };
    const heading = reportFormat.buildHeading(report);
    assert.strictEqual(heading, 'Flyer Maker (V 187.0.187) AI Video Editor : Crash on clicking save');
    assert.ok(!heading.includes('()'));
  });

  test('4. buildHeading omits round when round is null or undefined', () => {
    const reportWithNull = {
      project: 'Flyer Maker (V 187.0.187)',
      module: 'AI Video Editor',
      round: null,
      title: 'Crash on clicking save'
    };
    assert.strictEqual(
      reportFormat.buildHeading(reportWithNull),
      'Flyer Maker (V 187.0.187) AI Video Editor : Crash on clicking save'
    );

    const reportWithUndefined = {
      project: 'Flyer Maker (V 187.0.187)',
      module: 'AI Video Editor',
      round: undefined,
      title: 'Crash on clicking save'
    };
    assert.strictEqual(
      reportFormat.buildHeading(reportWithUndefined),
      'Flyer Maker (V 187.0.187) AI Video Editor : Crash on clicking save'
    );
  });

  test('5. SwitchModule validation allows saving when round is empty', () => {
    function validateAndBuildModuleSettings(project, module, round) {
      if (!project || !project.trim() || !module || !module.trim()) {
        return null; // rejected
      }
      return {
        project: project.trim(),
        module: module.trim(),
        round: round ? round.trim() : ""
      };
    }

    // Case A: Round empty
    const resA = validateAndBuildModuleSettings('Flyer Maker', 'Export', '');
    assert.deepStrictEqual(resA, {
      project: 'Flyer Maker',
      module: 'Export',
      round: ''
    });

    // Case B: Round provided
    const resB = validateAndBuildModuleSettings('Flyer Maker', 'Export', '  R-2  ');
    assert.deepStrictEqual(resB, {
      project: 'Flyer Maker',
      module: 'Export',
      round: 'R-2'
    });

    // Case C: Missing Project
    const resC = validateAndBuildModuleSettings('', 'Export', 'R-1');
    assert.strictEqual(resC, null);

    // Case D: Missing Module
    const resD = validateAndBuildModuleSettings('Flyer Maker', '   ', 'R-1');
    assert.strictEqual(resD, null);
  });

  test('6. buildPMSReportText and buildPMSReportHTML omit round without unwanted placeholders', () => {
    const report = {
      project: 'Flyer Maker',
      module: 'Editor',
      round: '',
      title: 'Missing back button',
      steps: ['Launch app', 'Open canvas'],
      includeResults: true,
      actualResult: 'Back button is hidden',
      expectedResult: 'Back button should be visible',
      generatedEveryTime: true,
      generatedInLive: false,
      hasAttachment: false
    };

    const text = reportFormat.buildPMSReportText(report);
    assert.ok(text.startsWith('Flyer Maker Editor : Missing back button'));
    assert.ok(!text.includes('()'));
    assert.ok(!text.includes('undefined'));
    assert.ok(!text.includes('null'));

    const html = reportFormat.buildPMSReportHTML(report);
    assert.ok(html.includes('Flyer Maker Editor : Missing back button'));
    assert.ok(!html.includes('()'));
  });
});
