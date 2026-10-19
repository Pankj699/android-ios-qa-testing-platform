const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('Mixpanel Bug Writer Utility Suite', async () => {
  const {
    formatValueForBug,
    getAttributeDisplayValues,
    generateBugStatement,
    generateBugDescription,
    groupAttributesByStatus
  } = await import('../../frontend/src/utils/mixpanelBugWriter.js');

  describe('formatValueForBug', () => {
    it('formats primitives correctly including falsy values 0 and false', () => {
      assert.strictEqual(formatValueForBug(0), '0');
      assert.strictEqual(formatValueForBug(-5), '-5');
      assert.strictEqual(formatValueForBug(false), 'false');
      assert.strictEqual(formatValueForBug(true), 'true');
      assert.strictEqual(formatValueForBug(''), '');
      assert.strictEqual(formatValueForBug('hello world'), 'hello world');
      assert.strictEqual(formatValueForBug(null), 'null');
      assert.strictEqual(formatValueForBug(undefined), 'undefined');
    });

    it('formats arrays and nested objects to JSON strings', () => {
      assert.strictEqual(formatValueForBug([1, 2, 3]), '[1,2,3]');
      assert.strictEqual(formatValueForBug({ key: 'val', num: 42 }), '{"key":"val","num":42}');
      assert.strictEqual(formatValueForBug([]), '[]');
      assert.strictEqual(formatValueForBug({}), '{}');
    });
  });

  describe('getAttributeDisplayValues', () => {
    it('extracts actual and expected values accurately', () => {
      const attr1 = { name: 'user_id', actualValue: 'usr_99', expectedValue: 'usr_99' };
      assert.deepStrictEqual(getAttributeDisplayValues(attr1), { actual: 'usr_99', expected: 'usr_99' });

      // Fallbacks to actual and expectedType
      const attr2 = { name: 'counter', actual: 0, expectedType: 'number' };
      assert.deepStrictEqual(getAttributeDisplayValues(attr2), { actual: 0, expected: 'number' });

      // Falsy expected value false
      const attr3 = { name: 'is_active', actualValue: true, expectedValue: false };
      assert.deepStrictEqual(getAttributeDisplayValues(attr3), { actual: true, expected: false });
    });
  });

  describe('generateBugStatement', () => {
    it('generates exact statement for MISSING status', () => {
      const statement = generateBugStatement('app_open', {
        name: 'session_id',
        status: 'MISSING',
        expectedValue: 'string'
      });
      assert.strictEqual(
        statement,
        'In the "app_open" event, the expected "session_id" attribute is missing from the actual payload.'
      );
    });

    it('generates exact statement for EXTRA status with actual value', () => {
      const statement = generateBugStatement('app_open', {
        name: 'debug_flag',
        status: 'EXTRA',
        actualValue: true
      });
      assert.strictEqual(
        statement,
        'In the "app_open" event, the "debug_flag" attribute is present in the actual payload but is not defined in the Excel specification. Actual value: true.'
      );
    });

    it('generates exact statement for INCORRECT status with expected and actual values', () => {
      const statement = generateBugStatement('app_open', {
        name: 'retry_count',
        status: 'INCORRECT',
        expectedValue: 0,
        actualValue: 3
      });
      assert.strictEqual(
        statement,
        'In the "app_open" event, the "retry_count" attribute has an incorrect value. Expected: 0; Actual: 3.'
      );
    });

    it('generates exact statement for MATCHED status with expected and actual values', () => {
      const statement = generateBugStatement('app_open', {
        name: 'platform',
        status: 'MATCHED',
        expectedValue: 'Android',
        actualValue: 'Android'
      });
      assert.strictEqual(
        statement,
        'In the "app_open" event, the "platform" attribute matches the Excel specification. Expected: Android; Actual: Android.'
      );
    });

    it('handles falsy actual and expected values without treating 0 or false as missing', () => {
      const stmtZero = generateBugStatement('checkout_complete', {
        name: 'discount_amount',
        status: 'INCORRECT',
        expectedValue: 0,
        actualValue: false
      });
      assert.strictEqual(
        stmtZero,
        'In the "checkout_complete" event, the "discount_amount" attribute has an incorrect value. Expected: 0; Actual: false.'
      );
    });
  });

  describe('generateBugDescription', () => {
    it('joins multiple attribute statements with double newlines', () => {
      const selectedAttrs = [
        { name: 'token', status: 'MISSING' },
        { name: 'level', status: 'EXTRA', actualValue: 5 }
      ];

      const desc = generateBugDescription('game_started', selectedAttrs);
      const expected =
        'In the "game_started" event, the expected "token" attribute is missing from the actual payload.\n\n' +
        'In the "game_started" event, the "level" attribute is present in the actual payload but is not defined in the Excel specification. Actual value: 5.';

      assert.strictEqual(desc, expected);
    });

    it('returns empty string if no attributes are provided', () => {
      assert.strictEqual(generateBugDescription('app_open', []), '');
      assert.strictEqual(generateBugDescription('app_open', null), '');
    });
  });

  describe('groupAttributesByStatus', () => {
    it('partitions attributes into MISSING, EXTRA, INCORRECT, and MATCHED', () => {
      const attrs = [
        { name: 'attr1', status: 'MATCHED' },
        { name: 'attr2', status: 'MISSING' },
        { name: 'attr3', status: 'EXTRA' },
        { name: 'attr4', status: 'INCORRECT' },
        { name: 'attr5', status: 'matched' },
        { name: 'attr6', status: 'UNMAPPED' }
      ];

      const groups = groupAttributesByStatus(attrs);
      assert.strictEqual(groups.MATCHED.length, 2);
      assert.strictEqual(groups.MISSING.length, 1);
      assert.strictEqual(groups.EXTRA.length, 2); // attr3 + unmapped attr6
      assert.strictEqual(groups.INCORRECT.length, 1);
    });

    it('returns empty groups when input is empty or invalid', () => {
      const groups = groupAttributesByStatus([]);
      assert.deepStrictEqual(groups, {
        MISSING: [],
        EXTRA: [],
        INCORRECT: [],
        MATCHED: []
      });
    });
  });
});
