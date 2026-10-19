const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('Mixpanel Attribute Filter Utility Suite', async () => {
  const {
    ATTRIBUTE_STATUSES,
    filterAttributesByStatus,
    getStatusTitle,
    getEmptyStateMessage
  } = await import('../../frontend/src/utils/mixpanelFilter.js');

  const sampleAttributes = [
    { name: 'distinct_id', status: 'MATCHED', actualValue: 'user_123' },
    { name: 'app_version', status: 'MATCHED', actualValue: '1.2.0' },
    { name: 'is_pro', status: 'MISSING', expectedValue: true },
    { name: 'debug_mode', status: 'EXTRA', actualValue: false },
    { name: 'extra_tag_1', status: 'EXTRA', actualValue: 'xyz' },
    { name: 'extra_tag_2', status: 'EXTRA', actualValue: 'abc' },
    { name: 'credit_count', status: 'INCORRECT', actualValue: 5, expectedValue: 10 }
  ];

  describe('filterAttributesByStatus', () => {
    it('returns all attributes when filter is ALL or undefined', () => {
      assert.deepStrictEqual(filterAttributesByStatus(sampleAttributes, 'ALL'), sampleAttributes);
      assert.deepStrictEqual(filterAttributesByStatus(sampleAttributes, undefined), sampleAttributes);
      assert.deepStrictEqual(filterAttributesByStatus(sampleAttributes, null), sampleAttributes);
      assert.deepStrictEqual(filterAttributesByStatus(sampleAttributes, ''), sampleAttributes);
    });

    it('filters strictly by MATCHED status', () => {
      const filtered = filterAttributesByStatus(sampleAttributes, 'MATCHED');
      assert.strictEqual(filtered.length, 2);
      assert.ok(filtered.every(a => a.status === 'MATCHED'));
      assert.deepStrictEqual(filtered.map(a => a.name), ['distinct_id', 'app_version']);
    });

    it('filters strictly by MISSING status', () => {
      const filtered = filterAttributesByStatus(sampleAttributes, 'MISSING');
      assert.strictEqual(filtered.length, 1);
      assert.strictEqual(filtered[0].name, 'is_pro');
      assert.strictEqual(filtered[0].status, 'MISSING');
    });

    it('filters strictly by EXTRA status', () => {
      const filtered = filterAttributesByStatus(sampleAttributes, 'EXTRA');
      assert.strictEqual(filtered.length, 3);
      assert.ok(filtered.every(a => a.status === 'EXTRA'));
      assert.deepStrictEqual(filtered.map(a => a.name), ['debug_mode', 'extra_tag_1', 'extra_tag_2']);
    });

    it('filters strictly by INCORRECT status', () => {
      const filtered = filterAttributesByStatus(sampleAttributes, 'INCORRECT');
      assert.strictEqual(filtered.length, 1);
      assert.strictEqual(filtered[0].name, 'credit_count');
      assert.strictEqual(filtered[0].status, 'INCORRECT');
    });

    it('returns empty array when no attributes match filter status', () => {
      const noMatched = sampleAttributes.filter(a => a.status !== 'MATCHED');
      const filtered = filterAttributesByStatus(noMatched, 'MATCHED');
      assert.deepStrictEqual(filtered, []);
    });

    it('handles empty or non-array inputs safely without throwing', () => {
      assert.deepStrictEqual(filterAttributesByStatus([], 'MATCHED'), []);
      assert.deepStrictEqual(filterAttributesByStatus(null, 'MATCHED'), []);
      assert.deepStrictEqual(filterAttributesByStatus(undefined, 'ALL'), []);
    });
  });

  describe('getStatusTitle', () => {
    it('returns formatted human-readable title for each status', () => {
      assert.strictEqual(getStatusTitle('MATCHED'), 'Matched');
      assert.strictEqual(getStatusTitle('MISSING'), 'Missing');
      assert.strictEqual(getStatusTitle('EXTRA'), 'Extra');
      assert.strictEqual(getStatusTitle('INCORRECT'), 'Incorrect');
      assert.strictEqual(getStatusTitle('ALL'), 'All Attributes');
      assert.strictEqual(getStatusTitle('CUSTOM'), 'CUSTOM');
    });
  });

  describe('getEmptyStateMessage', () => {
    it('returns standard empty message for ALL status', () => {
      assert.strictEqual(getEmptyStateMessage('ALL'), 'No parameter attributes found for this event.');
      assert.strictEqual(getEmptyStateMessage(null), 'No parameter attributes found for this event.');
    });

    it('returns exact requested status-specific empty message', () => {
      assert.strictEqual(
        getEmptyStateMessage('MISSING'),
        'No attributes with Missing status for this event.'
      );
      assert.strictEqual(
        getEmptyStateMessage('MATCHED'),
        'No attributes with Matched status for this event.'
      );
      assert.strictEqual(
        getEmptyStateMessage('EXTRA'),
        'No attributes with Extra status for this event.'
      );
      assert.strictEqual(
        getEmptyStateMessage('INCORRECT'),
        'No attributes with Incorrect status for this event.'
      );
    });
  });
});
