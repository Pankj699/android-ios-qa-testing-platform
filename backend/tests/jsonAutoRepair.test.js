const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

describe('JSON Auto Repair & Syntax Diagnostics Suite', async () => {
  // Dynamically import ESM utility into CommonJS test runner
  const modulePath = path.resolve(__dirname, '../../frontend/src/utils/jsonAutoRepair.js');
  const { analyzeJsonSyntax, repairJson, getLineColFromPosition, tokenizeJson } = await import(`file://${modulePath.replace(/\\/g, '/')}`);

  it('1. Valid JSON remains completely unchanged', () => {
    const validInputs = [
      '{\n  "trial_total_credit": 300,\n  "yearly_total_credit": 3600\n}',
      '{"active": true, "count": 0, "name": "test"}',
      '[1, 2, 3, "four", false, null]',
      '{"nested": {"array": [true, false], "str": "hello world"}}'
    ];

    for (const input of validInputs) {
      const analysis = analyzeJsonSyntax(input);
      assert.equal(analysis.valid, true, `Analysis should report valid for: ${input}`);

      const res = repairJson(input);
      assert.equal(res.success, true);
      assert.equal(res.repairedText, input);
      assert.equal(res.repairsApplied.length, 0);
      assert.equal(res.reasonCode, 'ALREADY_VALID');
    }
  });

  it('2. Trailing commas in objects and arrays are repaired', () => {
    // Object with trailing comma
    const objWithTrailingComma = '{\n  "a": 1,\n  "b": 2,\n}';
    const objRepaired = repairJson(objWithTrailingComma);
    assert.equal(objRepaired.success, true);
    assert.equal(JSON.parse(objRepaired.repairedText).b, 2);
    assert.ok(!objRepaired.repairedText.includes('2,'));
    assert.ok(objRepaired.repairsApplied.some(r => r.includes('trailing commas')));

    // Array with trailing comma
    const arrWithTrailingComma = '[10, 20, 30,]';
    const arrRepaired = repairJson(arrWithTrailingComma);
    assert.equal(arrRepaired.success, true);
    assert.deepEqual(JSON.parse(arrRepaired.repairedText), [10, 20, 30]);
  });

  it('3. A clearly missing comma between object properties is repaired', () => {
    const missingCommaObj = '{\n  "trial_total_credit": 300\n  "yearly_total_credit": 3600\n}';
    const repaired = repairJson(missingCommaObj);
    assert.equal(repaired.success, true);
    const parsed = JSON.parse(repaired.repairedText);
    assert.equal(parsed.trial_total_credit, 300);
    assert.equal(parsed.yearly_total_credit, 3600);
    assert.ok(repaired.repairsApplied.some(r => r.includes('missing commas')));
  });

  it('4. A clearly missing comma between array elements is repaired', () => {
    const missingCommaArr = '[\n  "apple"\n  "banana"\n  "cherry"\n]';
    const repaired = repairJson(missingCommaArr);
    assert.equal(repaired.success, true);
    const parsed = JSON.parse(repaired.repairedText);
    assert.deepEqual(parsed, ["apple", "banana", "cherry"]);
    assert.ok(repaired.repairsApplied.some(r => r.includes('missing commas')));
  });

  it('5. Unambiguous unquoted keys are repaired', () => {
    const unquotedKeys = '{\n  trial_total_credit: 300,\n  yearly_total_credit: 3600\n}';
    const repaired = repairJson(unquotedKeys);
    assert.equal(repaired.success, true);
    const parsed = JSON.parse(repaired.repairedText);
    assert.equal(parsed.trial_total_credit, 300);
    assert.equal(parsed.yearly_total_credit, 3600);
    assert.ok(repaired.repairsApplied.some(r => r.includes('Enclosed unquoted property keys')));
  });

  it('6. Single-quoted strings and keys are repaired without changing their contents', () => {
    const singleQuoted = "{\n  'feature_flag': 'new_experience',\n  'greeting': 'It\\'s awesome'\n}";
    const repaired = repairJson(singleQuoted);
    assert.equal(repaired.success, true);
    const parsed = JSON.parse(repaired.repairedText);
    assert.equal(parsed.feature_flag, 'new_experience');
    assert.equal(parsed.greeting, "It's awesome");
    assert.ok(repaired.repairsApplied.some(r => r.includes('single-quoted')));
  });

  it('7. Unclosed delimiters are repaired only when safe', () => {
    const unclosed = '{\n  "user": {\n    "name": "QA Tester"\n';
    const repaired = repairJson(unclosed);
    assert.equal(repaired.success, true);
    const parsed = JSON.parse(repaired.repairedText);
    assert.equal(parsed.user.name, 'QA Tester');
    assert.ok(repaired.repairsApplied.some(r => r.includes('missing closing delimiters')));
  });

  it('8. Dangling colons and missing values are NEVER guessed (Critical Non-Destructive Rule)', () => {
    const danglingCases = [
      '{\n  "trial_total_credit": 300,\n  "yearly_total_credit": 3600,\n  "weekly_total_credit":\n}',
      '{\n  "weekly_total_credit":\n}',
      '{"weekly_total_credit": , "other": 1}',
      '{\n  "key": \n}'
    ];

    for (const input of danglingCases) {
      const analysis = analyzeJsonSyntax(input);
      assert.equal(analysis.valid, false, 'Must be detected as invalid');
      assert.equal(analysis.reasonCode, 'DANGLING_COLON_MISSING_VALUE');
      assert.ok(analysis.message.includes('missing a value'));
      assert.ok(analysis.message.includes('Values cannot be guessed'));

      const res = repairJson(input);
      assert.equal(res.success, false, 'Repair must NOT succeed on dangling colon');
      assert.equal(res.repairedText, input, 'Original text must remain identical');
      assert.equal(res.reasonCode, 'DANGLING_COLON_MISSING_VALUE');
      assert.ok(res.message.includes('missing a value'));
    }
  });

  it('9. Strings containing commas, colons, braces, brackets, and escaped quotes remain intact', () => {
    const complexStrings = JSON.stringify({
      regex_pattern: "([a-z]+):\\s*\\{[0-9],\\}",
      html_snippet: "<div class=\"btn, active\">Hello: World</div>",
      escaped_quotes: "He said, \\\"Hello, world!\\\" and left.",
      url: "https://example.com/api?a=1&b=2,3",
      json_inside_string: "{\"internal_key\": 123, \"arr\": [1, 2]}"
    }, null, 2);

    const analysis = analyzeJsonSyntax(complexStrings);
    assert.equal(analysis.valid, true);

    const res = repairJson(complexStrings);
    assert.equal(res.success, true);
    assert.equal(res.repairedText, complexStrings);
    const parsed = JSON.parse(res.repairedText);
    assert.equal(parsed.escaped_quotes, 'He said, \\"Hello, world!\\" and left.');
  });

  it('10. Escaped backslashes and Unicode characters are preserved', () => {
    const unicodeInput = '{\n  "path": "C:\\\\Projects\\\\Test\\\\file.txt",\n  "unicode": "\\u0041\\u0042\\u0043 \u2764\ufe0f",\n  "multiline": "line1\\nline2\\tindent"\n}';
    const analysis = analyzeJsonSyntax(unicodeInput);
    assert.equal(analysis.valid, true);

    const res = repairJson(unicodeInput);
    assert.equal(res.success, true);
    assert.equal(res.repairedText, unicodeInput);
    const parsed = JSON.parse(res.repairedText);
    assert.equal(parsed.path, 'C:\\Projects\\Test\\file.txt');
    assert.equal(parsed.unicode, 'ABC ❤️');
  });

  it('11. Nested arrays and objects with multiple errors are repaired safely', () => {
    // Missing commas, unquoted keys, and trailing commas combined
    const complexDirty = `
    {
      app_config: {
        timeout_ms: 5000
        retry_count: 3,
      }
      endpoints: [
        'https://api1.test'
        'https://api2.test',
      ]
    }
    `;

    const repaired = repairJson(complexDirty);
    assert.equal(repaired.success, true);
    const parsed = JSON.parse(repaired.repairedText);
    assert.equal(parsed.app_config.timeout_ms, 5000);
    assert.equal(parsed.app_config.retry_count, 3);
    assert.deepEqual(parsed.endpoints, ['https://api1.test', 'https://api2.test']);
  });

  it('12. Literal normalization does not modify matching text inside strings', () => {
    const inputWithStrings = `
    {
      "note": "This is True and that is None and not False",
      "flag": True,
      "empty_field": None,
      "disabled": False
    }
    `;

    const repaired = repairJson(inputWithStrings);
    assert.equal(repaired.success, true);
    const parsed = JSON.parse(repaired.repairedText);
    // Inside the string, "True", "None", "False" must be preserved!
    assert.equal(parsed.note, "This is True and that is None and not False");
    // As standalone values, they must be converted to true, null, false
    assert.strictEqual(parsed.flag, true);
    assert.strictEqual(parsed.empty_field, null);
    assert.strictEqual(parsed.disabled, false);
  });

  it('13. Ambiguous or unsupported input remains unchanged with helpful error', () => {
    // Completely random corrupted binary or syntax garbage
    const garbage = '<<<--- SOME CORRUPT DATA --->>>';
    const res = repairJson(garbage);
    assert.equal(res.success, false);
    assert.equal(res.repairedText, garbage);
    assert.ok(res.message.includes('could not safely determine'));
    assert.equal(res.reasonCode, 'UNSAFE_OR_AMBIGUOUS');
  });

  it('14. Every successful result strictly passes JSON.parse()', () => {
    const testCases = [
      '{ a: 1 b: 2 }',
      '[\'one\' \'two\']',
      '{ "x": 10, "y": 20, }',
      '{ "open": { "nested": 1 }',
      '{ TrueKey: True, FalseKey: False, NoneKey: None }'
    ];

    for (const tc of testCases) {
      const res = repairJson(tc);
      if (res.success) {
        assert.doesNotThrow(() => JSON.parse(res.repairedText), `Repaired text must parse cleanly for: ${tc}`);
      }
    }
  });

  it('15. Line and Column accurate positioning test', () => {
    const sample = '{\n  "first": 100,\n  "second":\n}';
    const analysis = analyzeJsonSyntax(sample);
    assert.equal(analysis.valid, false);
    assert.equal(analysis.reasonCode, 'DANGLING_COLON_MISSING_VALUE');
    // Line 3 has "second":
    assert.equal(analysis.line, 3);
  });

  it('16. Form validation logic rejects invalid or incomplete JSON', () => {
    const invalidInputs = [
      '{ "key": }',
      'invalid raw text',
      '{ "open": "unclosed',
      '{ "trailing": 1, }'
    ];

    for (const input of invalidInputs) {
      const analysis = analyzeJsonSyntax(input);
      assert.equal(analysis.valid, false);
      assert.throws(() => JSON.parse(input));
    }
  });

  it('17. Auto Repair returns candidates without mutating persistence or triggering auto-save', () => {
    const input = '{\n  unquoted_key: 123,\n}';
    const res = repairJson(input);
    assert.equal(res.success, true);
    // Function is pure: originalText is intact, repairedText is a separate string
    assert.equal(res.originalText, input);
    assert.notEqual(res.repairedText, input);
    assert.doesNotThrow(() => JSON.parse(res.repairedText));
  });

  it('18. Format and Minify remain functional on valid repaired output', () => {
    const dirty = '{\n  feature_flag: true,\n  count: 5,\n}';
    const res = repairJson(dirty);
    assert.equal(res.success, true);

    const parsed = JSON.parse(res.repairedText);
    const formatted = JSON.stringify(parsed, null, 2);
    const minified = JSON.stringify(parsed);

    assert.ok(formatted.includes('\n  "feature_flag": true,'));
    assert.equal(minified, '{"feature_flag":true,"count":5}');
  });

  it('19. Full-width unicode commas and colons are normalized and repaired', () => {
    const unicodePunctuation = '{\n  "trial_total_credit": 300，\n  "yearly_total_credit"： 3600\n}';
    const res = repairJson(unicodePunctuation);
    assert.equal(res.success, true);
    const parsed = JSON.parse(res.repairedText);
    assert.equal(parsed.trial_total_credit, 300);
    assert.equal(parsed.yearly_total_credit, 3600);
  });

  it('20. Smart/curly quotes around keys and values are normalized and repaired', () => {
    const curlyQuotes = '{\n  “feature_name”: “AI Studio”,\n  ‘plan’: ‘Pro’\n}';
    const res = repairJson(curlyQuotes);
    assert.equal(res.success, true);
    const parsed = JSON.parse(res.repairedText);
    assert.equal(parsed.feature_name, 'AI Studio');
    assert.equal(parsed.plan, 'Pro');
  });

  it('21. JavaScript comments (// and /* */) outside strings are stripped', () => {
    const withComments = `
    {
      // Billing configurations
      "trial_total_credit": 300, /* trial credits */
      "yearly_total_credit": 3600
    }
    `;
    const res = repairJson(withComments);
    assert.equal(res.success, true);
    const parsed = JSON.parse(res.repairedText);
    assert.equal(parsed.trial_total_credit, 300);
    assert.equal(parsed.yearly_total_credit, 3600);
  });

  it('22. Unescaped control characters in strings (newlines and tabs) are escaped', () => {
    const unescapedCtrl = '{\n  "message": "Line 1\nLine 2\tTabbed",\n  "active": true\n}';
    const res = repairJson(unescapedCtrl);
    assert.equal(res.success, true);
    const parsed = JSON.parse(res.repairedText);
    assert.equal(parsed.message, 'Line 1\nLine 2\tTabbed');
    assert.equal(parsed.active, true);
  });

  it('23. Non-standard numbers (.5, 5., +5) are normalized to valid JSON', () => {
    const weirdNumbers = '{\n  "rate": .5,\n  "count": 5.,\n  "boost": +10\n}';
    const res = repairJson(weirdNumbers);
    assert.equal(res.success, true);
    const parsed = JSON.parse(res.repairedText);
    assert.equal(parsed.rate, 0.5);
    assert.equal(parsed.count, 5.0);
    assert.equal(parsed.boost, 10);
  });

  it('24. Missing colons between property names and values are inserted', () => {
    const missingColon = '{\n  "first": 10,\n  "second" 20,\n  "third" "hello"\n}';
    const res = repairJson(missingColon);
    assert.equal(res.success, true);
    const parsed = JSON.parse(res.repairedText);
    assert.equal(parsed.first, 10);
    assert.equal(parsed.second, 20);
    assert.equal(parsed.third, 'hello');
  });

  it('25. Multi-error compound documents resolve via iterative convergence', () => {
    const compound = `
    {
      // Configuration header
      “app_name”: ‘DesignWiz’
      trial_rate: .75,
      endpoint: "https://api.test\n/v1"
      features: [
        'ai_flyer'
        'ai_chatbot',
      ]
    `;
    const res = repairJson(compound);
    assert.equal(res.success, true);
    const parsed = JSON.parse(res.repairedText);
    assert.equal(parsed.app_name, 'DesignWiz');
    assert.equal(parsed.trial_rate, 0.75);
    assert.deepEqual(parsed.features, ['ai_flyer', 'ai_chatbot']);
  });

  it('26. Representative Reference Cases (Test A through F)', () => {
    // Test A: Missing comma between properties
    const testA = '{ "first": 10 "second": 20 }';
    const resA = repairJson(testA);
    assert.equal(resA.success, true);
    assert.deepEqual(JSON.parse(resA.repairedText), { first: 10, second: 20 });

    // Test B: Missing value -> MUST NOT guess, halts safely
    const testB = '{ "first": 10, "weekly_total_credit": }';
    const resB = repairJson(testB);
    assert.equal(resB.success, false);
    assert.equal(resB.reasonCode, 'DANGLING_COLON_MISSING_VALUE');
    assert.ok(resB.message.includes('weekly_total_credit'));

    // Test C: Trailing comma
    const testC = '{ "first": 10, "second": 20, }';
    const resC = repairJson(testC);
    assert.equal(resC.success, true);
    assert.deepEqual(JSON.parse(resC.repairedText), { first: 10, second: 20 });

    // Test D: Invalid number / missing value in middle -> halts safely
    const testD = '{ "first": 10, "second": , "third": 30 }';
    const resD = repairJson(testD);
    assert.equal(resD.success, false);
    assert.equal(resD.reasonCode, 'DANGLING_COLON_MISSING_VALUE');

    // Test E: Missing closing delimiter
    const testE = '{ "first": { "second": 20 }';
    const resE = repairJson(testE);
    assert.equal(resE.success, true);
    assert.deepEqual(JSON.parse(resE.repairedText), { first: { second: 20 } });

    // Test F: Single quotes, escaped quotes, and curly quotes
    const testF = "{ “title”: 'John\\'s \"Special\" Flyer' }";
    const resF = repairJson(testF);
    assert.equal(resF.success, true);
    assert.equal(JSON.parse(resF.repairedText).title, 'John\'s "Special" Flyer');
  });

  it('27. Missing quotation mark on string value before closing delimiter (ai_chatbot_config scenario)', () => {
    const input = `{
  "ai_chatbot_url": "http://192.168.0.110/photo_editor_lab_backend/api/public/flyer-chat?",
  "ai_cta_text": "Ask AI to Edit",
  "edit_cta_text": "Edit",
  "is_ai_chatbot_enable_with_edit": 0,
  "is_ai_chatbot_enable_without_edit": 0,
  "is_show_paywall_on_chatbot": 0,
  "is_allow_to_open_chatbot_without_purchase": 0,
  "open_ask_ai_edit_on_template_preview": 0,
  "chatbot_title": "Customize with AI
}`;
    // Syntax analysis must identify unterminated string at end of line (Col 38)
    const analysis = analyzeJsonSyntax(input);
    assert.equal(analysis.valid, false);
    assert.equal(analysis.reasonCode, 'UNTERMINATED_STRING');
    assert.equal(analysis.line, 10);
    assert.equal(analysis.column, 38);
    assert.ok(analysis.message.includes('Line 10, Col 38'));

    // Auto repair must safely close the quotation mark and pass JSON.parse
    const res = repairJson(input);
    assert.equal(res.success, true);
    const parsed = JSON.parse(res.repairedText);
    assert.equal(parsed.chatbot_title, 'Customize with AI');
    assert.ok(res.repairsApplied.some(r => r.includes('missing closing quote on line 10')));
  });

  it('28. Missing quotation mark before trailing comma', () => {
    const input = `{\n  "chatbot_title": "Customize with AI,\n  "is_active": true\n}`;
    const res = repairJson(input);
    assert.equal(res.success, true);
    const parsed = JSON.parse(res.repairedText);
    assert.equal(parsed.chatbot_title, 'Customize with AI');
    assert.equal(parsed.is_active, true);
    assert.ok(res.repairsApplied.some(r => r.includes('before comma')));
  });

  it('29. Missing opening quotation mark on property key', () => {
    const input = `{\n  chatbot_title": "Customize with AI"\n}`;
    const res = repairJson(input);
    assert.equal(res.success, true);
    const parsed = JSON.parse(res.repairedText);
    assert.equal(parsed.chatbot_title, 'Customize with AI');
    assert.ok(res.repairsApplied.some(r => r.includes("missing opening quote to property 'chatbot_title'")));
  });

  it('30. Missing closing quotation mark on property key before colon', () => {
    const input = `{\n  "chatbot_title: "Customize with AI"\n}`;
    const res = repairJson(input);
    assert.equal(res.success, true);
    const parsed = JSON.parse(res.repairedText);
    assert.equal(parsed.chatbot_title, 'Customize with AI');
    assert.ok(res.repairsApplied.some(r => r.includes("missing closing quote to property 'chatbot_title'")));
  });

  it('31. Missing closing quotation mark in array elements', () => {
    const input = `[\n  "first item",\n  "second item\n]`;
    const res = repairJson(input);
    assert.equal(res.success, true);
    const parsed = JSON.parse(res.repairedText);
    assert.deepEqual(parsed, ["first item", "second item"]);
  });

  it('32. Error location and cursor positioning are 100% accurate', () => {
    const input = `{\n  "chatbot_title": "Customize with AI\n}`;
    const analysis = analyzeJsonSyntax(input);
    assert.equal(analysis.valid, false);
    assert.equal(analysis.line, 2);
    assert.equal(analysis.column, 38);
    // Position 41 corresponds to the exact end of "Customize with AI before newline
    assert.equal(input.slice(analysis.position - 2, analysis.position), 'AI');
  });

  it('33. Diagnostic consistency: analyzeJsonSyntax and repairJson failure diagnostics never conflict', () => {
    const invalidInput = '{\n  "first": 10,\n  "weekly_total_credit":\n}';
    const analysis = analyzeJsonSyntax(invalidInput);
    const repairRes = repairJson(invalidInput);

    assert.equal(analysis.valid, false);
    assert.equal(repairRes.success, false);
    assert.equal(analysis.line, repairRes.line);
    assert.equal(analysis.column, repairRes.column);
    assert.equal(analysis.position, repairRes.position);
    assert.equal(analysis.reasonCode, repairRes.reasonCode);
  });
});


