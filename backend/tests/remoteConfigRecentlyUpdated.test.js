const { describe, it } = require('node:test');
const assert = require('node:assert');

// Pure logic mirror of RemoteConfigPage mutation tracking & sorting helpers
const getCompoundKey = (plt, app, key) => {
  return `${(plt || '').toLowerCase().trim()}:${(app || '').toLowerCase().trim()}:${(key || '').toLowerCase().trim()}`;
};

const parseSessionMutations = (raw) => {
  try {
    if (!raw) return { sequence: 0, items: {} };
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object' && typeof parsed.sequence === 'number' && parsed.items && typeof parsed.items === 'object') {
      return parsed;
    }
    return { sequence: 0, items: {} };
  } catch (err) {
    return { sequence: 0, items: {} };
  }
};

const recordMutationHelper = (tracker, plt, app, newKey, oldKey = null) => {
  const nextSeq = (tracker.sequence || 0) + 1;
  const nextItems = { ...(tracker.items || {}) };

  if (oldKey && oldKey.trim().toLowerCase() !== newKey.trim().toLowerCase()) {
    const oldCompound = getCompoundKey(plt, app, oldKey);
    delete nextItems[oldCompound];
  }

  const newCompound = getCompoundKey(plt, app, newKey);
  nextItems[newCompound] = {
    sequence: nextSeq,
    timestamp: Date.now(),
    platform: (plt || '').toLowerCase().trim(),
    app: (app || '').toLowerCase().trim(),
    key: newKey.trim()
  };

  return { sequence: nextSeq, items: nextItems };
};

const removeMutationHelper = (tracker, plt, app, key) => {
  const compound = getCompoundKey(plt, app, key);
  if (!tracker.items || !tracker.items[compound]) return tracker;
  const nextItems = { ...tracker.items };
  delete nextItems[compound];
  return { sequence: tracker.sequence, items: nextItems };
};

const sortConfigs = (configs, sortBy, platform, app, tracker) => {
  const result = [...configs];
  if (sortBy === 'recent') {
    result.sort((a, b) => {
      const aCompound = getCompoundKey(platform, app, a.key);
      const bCompound = getCompoundKey(platform, app, b.key);
      const aSeq = tracker.items?.[aCompound]?.sequence || 0;
      const bSeq = tracker.items?.[bCompound]?.sequence || 0;

      if (aSeq > 0 || bSeq > 0) {
        if (aSeq > 0 && bSeq > 0) {
          return bSeq - aSeq; // Newest mutation first
        }
        return aSeq > 0 ? -1 : 1; // Mutated comes before unmutated
      }
      return (a.srNo || 0) - (b.srNo || 0); // Unmutated retain server order
    });
  } else if (sortBy === 'server') {
    result.sort((a, b) => (a.srNo || 0) - (b.srNo || 0));
  } else if (sortBy === 'key-asc') {
    result.sort((a, b) => a.key.localeCompare(b.key));
  } else if (sortBy === 'key-desc') {
    result.sort((a, b) => b.key.localeCompare(a.key));
  } else if (sortBy === 'type') {
    result.sort((a, b) => a.type.localeCompare(b.type));
  } else if (sortBy === 'status') {
    result.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0));
  }
  return result;
};

describe('Remote Config Recently Updated Sorting & Mutation Tracking Suite', () => {
  const sampleConfigs = [
    { id: 101, srNo: 1, key: 'analytics_enabled', type: 'boolean', active: true },
    { id: 102, srNo: 2, key: 'billing_retry_limit', type: 'number', active: true },
    { id: 103, srNo: 3, key: 'chat_bot_config', type: 'json', active: false },
    { id: 104, srNo: 4, key: 'dark_mode_default', type: 'boolean', active: true },
    { id: 105, srNo: 5, key: 'experiment_variant', type: 'string', active: true }
  ];

  describe('1. Normalized Compound Identity & Storage Validation', () => {
    it('creates lowercase normalized compound keys', () => {
      const key1 = getCompoundKey('ANDROID', 'DesignWiz ', ' Chat_Bot_Config ');
      assert.strictEqual(key1, 'android:designwiz:chat_bot_config');

      const key2 = getCompoundKey('ios', 'designwiz', 'chat_bot_config');
      assert.strictEqual(key2, 'ios:designwiz:chat_bot_config');
      assert.notStrictEqual(key1, key2, 'Android and iOS identities must remain separated');
    });

    it('safely parses valid and malformed sessionStorage data without crashing', () => {
      // Valid data
      const valid = JSON.stringify({ sequence: 2, items: { 'android:app:key1': { sequence: 1 } } });
      const parsedValid = parseSessionMutations(valid);
      assert.strictEqual(parsedValid.sequence, 2);
      assert.ok(parsedValid.items['android:app:key1']);

      // Null, empty, or corrupt data
      assert.deepStrictEqual(parseSessionMutations(null), { sequence: 0, items: {} });
      assert.deepStrictEqual(parseSessionMutations(''), { sequence: 0, items: {} });
      assert.deepStrictEqual(parseSessionMutations('{ invalid json'), { sequence: 0, items: {} });
      assert.deepStrictEqual(parseSessionMutations('{"broken": true}'), { sequence: 0, items: {} });
      assert.deepStrictEqual(parseSessionMutations(123), { sequence: 0, items: {} });
    });
  });

  describe('2. Mutation Tracking & Monotonic Sequence', () => {
    it('increments sequence monotonically and records compound identity', () => {
      let tracker = { sequence: 0, items: {} };

      tracker = recordMutationHelper(tracker, 'android', 'designwiz', 'billing_retry_limit');
      assert.strictEqual(tracker.sequence, 1);
      assert.strictEqual(tracker.items['android:designwiz:billing_retry_limit'].sequence, 1);

      tracker = recordMutationHelper(tracker, 'android', 'designwiz', 'dark_mode_default');
      assert.strictEqual(tracker.sequence, 2);
      assert.strictEqual(tracker.items['android:designwiz:dark_mode_default'].sequence, 2);
    });

    it('handles key renames by removing old identity and creating new identity', () => {
      let tracker = { sequence: 0, items: {} };
      tracker = recordMutationHelper(tracker, 'android', 'designwiz', 'old_config_key');
      assert.ok(tracker.items['android:designwiz:old_config_key']);

      // Rename from old_config_key to new_config_key
      tracker = recordMutationHelper(tracker, 'android', 'designwiz', 'new_config_key', 'old_config_key');
      assert.strictEqual(tracker.sequence, 2);
      assert.strictEqual(tracker.items['android:designwiz:old_config_key'], undefined, 'Old key must be removed');
      assert.ok(tracker.items['android:designwiz:new_config_key'], 'New key must be registered');
      assert.strictEqual(tracker.items['android:designwiz:new_config_key'].sequence, 2);
    });

    it('handles delete operations by removing item from mutation tracker', () => {
      let tracker = { sequence: 0, items: {} };
      tracker = recordMutationHelper(tracker, 'android', 'designwiz', 'to_delete_key');
      assert.ok(tracker.items['android:designwiz:to_delete_key']);

      tracker = removeMutationHelper(tracker, 'android', 'designwiz', 'to_delete_key');
      assert.strictEqual(tracker.items['android:designwiz:to_delete_key'], undefined);
    });
  });

  describe('3. Recently Updated Sorting Behavior', () => {
    it('moves a single updated configuration to index 0 under Recently Updated', () => {
      let tracker = { sequence: 0, items: {} };
      // Simulate editing row 4 (dark_mode_default)
      tracker = recordMutationHelper(tracker, 'android', 'designwiz', 'dark_mode_default');

      const sorted = sortConfigs(sampleConfigs, 'recent', 'android', 'designwiz', tracker);
      assert.strictEqual(sorted[0].key, 'dark_mode_default', 'Updated item must be at index 0');

      // Remaining items must preserve relative server order (srNo 1, 2, 3, 5)
      assert.strictEqual(sorted[1].key, 'analytics_enabled');
      assert.strictEqual(sorted[2].key, 'billing_retry_limit');
      assert.strictEqual(sorted[3].key, 'chat_bot_config');
      assert.strictEqual(sorted[4].key, 'experiment_variant');
    });

    it('orders multiple mutations newest first (descending sequence)', () => {
      let tracker = { sequence: 0, items: {} };

      // 1st mutation: chat_bot_config (row 3)
      tracker = recordMutationHelper(tracker, 'android', 'designwiz', 'chat_bot_config');
      // 2nd mutation: analytics_enabled (row 1)
      tracker = recordMutationHelper(tracker, 'android', 'designwiz', 'analytics_enabled');
      // 3rd mutation: billing_retry_limit (row 2)
      tracker = recordMutationHelper(tracker, 'android', 'designwiz', 'billing_retry_limit');

      const sorted = sortConfigs(sampleConfigs, 'recent', 'android', 'designwiz', tracker);

      // Newest mutation (seq 3) first, then seq 2, then seq 1
      assert.strictEqual(sorted[0].key, 'billing_retry_limit', '3rd mutation must be #1');
      assert.strictEqual(sorted[1].key, 'analytics_enabled', '2nd mutation must be #2');
      assert.strictEqual(sorted[2].key, 'chat_bot_config', '1st mutation must be #3');

      // Unmutated items below mutated items, sorted by srNo
      assert.strictEqual(sorted[3].key, 'dark_mode_default');
      assert.strictEqual(sorted[4].key, 'experiment_variant');
    });

    it('restores original server order when Server Order is selected', () => {
      let tracker = { sequence: 0, items: {} };
      tracker = recordMutationHelper(tracker, 'android', 'designwiz', 'dark_mode_default');

      const serverSorted = sortConfigs(sampleConfigs, 'server', 'android', 'designwiz', tracker);
      assert.strictEqual(serverSorted[0].key, 'analytics_enabled');
      assert.strictEqual(serverSorted[1].key, 'billing_retry_limit');
      assert.strictEqual(serverSorted[2].key, 'chat_bot_config');
      assert.strictEqual(serverSorted[3].key, 'dark_mode_default');
      assert.strictEqual(serverSorted[4].key, 'experiment_variant');
    });

    it('preserves ordering consistency between Android and iOS without cross-contamination', () => {
      let tracker = { sequence: 0, items: {} };
      // Mutate 'analytics_enabled' on iOS only
      tracker = recordMutationHelper(tracker, 'ios', 'designwiz', 'analytics_enabled');

      // Android list should NOT see this mutation
      const androidSorted = sortConfigs(sampleConfigs, 'recent', 'android', 'designwiz', tracker);
      assert.strictEqual(androidSorted[0].key, 'analytics_enabled'); // default srNo 1
      assert.strictEqual(androidSorted[1].key, 'billing_retry_limit');

      // iOS list should see it at top
      const iosSorted = sortConfigs(sampleConfigs, 'recent', 'ios', 'designwiz', tracker);
      assert.strictEqual(iosSorted[0].key, 'analytics_enabled');
    });
  });

  describe('4. Search, Filter & State Duplicate Prevention', () => {
    it('preserves recent mutation ordering after text search and status filtering', () => {
      let tracker = { sequence: 0, items: {} };
      // Mutate chat_bot_config (inactive)
      tracker = recordMutationHelper(tracker, 'android', 'designwiz', 'chat_bot_config');

      const allRecent = sortConfigs(sampleConfigs, 'recent', 'android', 'designwiz', tracker);
      assert.strictEqual(allRecent[0].key, 'chat_bot_config');

      // Filter inactive only
      const inactive = allRecent.filter(c => c.active === false);
      assert.strictEqual(inactive.length, 1);
      assert.strictEqual(inactive[0].key, 'chat_bot_config');

      // Search query "config"
      const searchMatch = allRecent.filter(c => c.key.includes('config'));
      assert.strictEqual(searchMatch.length, 1);
      assert.strictEqual(searchMatch[0].key, 'chat_bot_config');
    });

    it('prevents duplicate records when state is updated on save', () => {
      let currentConfigs = [...sampleConfigs];
      const newConfig = { id: 200, srNo: 6, key: 'new_feature', type: 'boolean', active: true };

      // Add without duplicating
      const filtered = currentConfigs.filter(c => c.key.toLowerCase() !== newConfig.key.toLowerCase());
      currentConfigs = [newConfig, ...filtered];
      assert.strictEqual(currentConfigs.length, 6);

      // Re-saving same key replaces rather than duplicates
      const updatedConfig = { ...newConfig, active: false };
      const exists = currentConfigs.some(c => c.key === updatedConfig.key);
      assert.ok(exists);
      currentConfigs = currentConfigs.map(c => c.key === updatedConfig.key ? updatedConfig : c);
      assert.strictEqual(currentConfigs.length, 6);
      assert.strictEqual(currentConfigs[0].active, false);
    });
  });
});
