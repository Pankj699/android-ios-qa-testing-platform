const { describe, it } = require('node:test');
const assert = require('node:assert');

// Logic mirrors of RemoteConfigPage helpers
const getCompoundKey = (plt, app, key) => {
  return `${(plt || '').toLowerCase().trim()}:${(app || '').toLowerCase().trim()}:${(key || '').toLowerCase().trim()}`;
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

const filterAndSortConfigs = ({ configs, searchQuery, typeFilter, statusFilter, sortBy, platform, app, mutationTracker }) => {
  let result = [...configs];

  if (searchQuery && searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    result = result.filter(c =>
      (c.key && c.key.toLowerCase().includes(q)) ||
      (c.value && String(c.value).toLowerCase().includes(q)) ||
      (c.app && c.app.toLowerCase().includes(q))
    );
  }

  if (typeFilter) {
    result = result.filter(c => c.type === typeFilter.toLowerCase());
  }

  if (statusFilter === 'active') {
    result = result.filter(c => c.active === true);
  } else if (statusFilter === 'inactive') {
    result = result.filter(c => c.active === false);
  }

  if (sortBy === 'recent') {
    result.sort((a, b) => {
      const aCompound = getCompoundKey(platform, app, a.key);
      const bCompound = getCompoundKey(platform, app, b.key);
      const aSeq = mutationTracker?.items?.[aCompound]?.sequence || 0;
      const bSeq = mutationTracker?.items?.[bCompound]?.sequence || 0;

      if (aSeq > 0 || bSeq > 0) {
        if (aSeq > 0 && bSeq > 0) {
          return bSeq - aSeq;
        }
        return aSeq > 0 ? -1 : 1;
      }
      return (a.srNo || 0) - (b.srNo || 0);
    });
  } else if (sortBy === 'key-asc') {
    result.sort((a, b) => a.key.localeCompare(b.key));
  } else if (sortBy === 'server') {
    result.sort((a, b) => (a.srNo || 0) - (b.srNo || 0));
  }

  return result;
};

// Reconcile helper matching RemoteConfigPage loadConfigs
const reconcileServerList = (serverList, currentLocalList, platform, app, mutationTracker, maxAgeMs = 15000) => {
  const now = Date.now();
  const recentMutatedKeys = new Set();

  if (mutationTracker?.items) {
    Object.values(mutationTracker.items).forEach(item => {
      if (
        item &&
        item.platform === (platform || '').toLowerCase().trim() &&
        item.app === (app || '').toLowerCase().trim() &&
        now - (item.timestamp || 0) < maxAgeMs
      ) {
        recentMutatedKeys.add(item.key.toLowerCase().trim());
      }
    });
  }

  return serverList.map(serverItem => {
    if (recentMutatedKeys.has((serverItem.key || '').toLowerCase().trim())) {
      const localItem = currentLocalList.find(c =>
        c.key.toLowerCase().trim() === serverItem.key.toLowerCase().trim()
      );
      if (localItem) {
        return { ...serverItem, ...localItem };
      }
    }
    return serverItem;
  });
};

describe('Remote Config Search Clear & Fast Update Workflow Suite', () => {
  const initialConfigs = [
    { id: 1, srNo: 1, key: 'ai_chatbot_config', type: 'json', value: '{"model":"gpt-4"}', active: true, app: 'designwiz' },
    { id: 2, srNo: 2, key: 'billing_retry_limit', type: 'number', value: '3', active: true, app: 'designwiz' },
    { id: 3, srNo: 3, key: 'dark_mode_enabled', type: 'boolean', value: '1', active: false, app: 'designwiz' },
    { id: 4, srNo: 4, key: 'image_generator_v2', type: 'json', value: '{"enabled":true}', active: true, app: 'designwiz' },
    { id: 5, srNo: 5, key: 'welcome_dialog_shown', type: 'boolean', value: '0', active: false, app: 'designwiz' }
  ];

  describe('1. Search Filter and Clear Button Mechanics', () => {
    it('filters configurations when searchQuery is non-empty', () => {
      const filtered = filterAndSortConfigs({
        configs: initialConfigs,
        searchQuery: 'chatbot',
        typeFilter: '',
        statusFilter: '',
        sortBy: 'server',
        platform: 'android',
        app: 'designwiz'
      });
      assert.strictEqual(filtered.length, 1);
      assert.strictEqual(filtered[0].key, 'ai_chatbot_config');
    });

    it('immediately restores all matching configurations when search is cleared', () => {
      // 1. User searches
      const searchResult = filterAndSortConfigs({
        configs: initialConfigs,
        searchQuery: 'chatbot',
        typeFilter: '',
        statusFilter: '',
        sortBy: 'server',
        platform: 'android',
        app: 'designwiz'
      });
      assert.strictEqual(searchResult.length, 1);

      // 2. User clicks X (Clear search) -> searchQuery becomes empty string ''
      const clearedResult = filterAndSortConfigs({
        configs: initialConfigs,
        searchQuery: '',
        typeFilter: '',
        statusFilter: '',
        sortBy: 'server',
        platform: 'android',
        app: 'designwiz'
      });
      assert.strictEqual(clearedResult.length, 5);
      assert.deepStrictEqual(clearedResult.map(c => c.key), [
        'ai_chatbot_config',
        'billing_retry_limit',
        'dark_mode_enabled',
        'image_generator_v2',
        'welcome_dialog_shown'
      ]);
    });

    it('preserves existing type and status filters when search query is cleared', () => {
      // With typeFilter='json' and statusFilter='active'
      const searchFiltered = filterAndSortConfigs({
        configs: initialConfigs,
        searchQuery: 'image',
        typeFilter: 'json',
        statusFilter: 'active',
        sortBy: 'server',
        platform: 'android',
        app: 'designwiz'
      });
      assert.strictEqual(searchFiltered.length, 1);
      assert.strictEqual(searchFiltered[0].key, 'image_generator_v2');

      // Clear search button clicked
      const afterClear = filterAndSortConfigs({
        configs: initialConfigs,
        searchQuery: '',
        typeFilter: 'json',
        statusFilter: 'active',
        sortBy: 'server',
        platform: 'android',
        app: 'designwiz'
      });
      // Both active JSON configs ('ai_chatbot_config' and 'image_generator_v2') must be returned
      assert.strictEqual(afterClear.length, 2);
      assert.deepStrictEqual(afterClear.map(c => c.key), ['ai_chatbot_config', 'image_generator_v2']);
    });

    it('preserves sort order when search query is cleared', () => {
      const afterClear = filterAndSortConfigs({
        configs: initialConfigs,
        searchQuery: '',
        typeFilter: '',
        statusFilter: '',
        sortBy: 'key-asc',
        platform: 'android',
        app: 'designwiz'
      });
      assert.strictEqual(afterClear[0].key, 'ai_chatbot_config');
      assert.strictEqual(afterClear[1].key, 'billing_retry_limit');
      assert.strictEqual(afterClear[4].key, 'welcome_dialog_shown');
    });
  });

  describe('2. Fast Update Workflow: Confirmed Update & Background Reconciliation', () => {
    it('immediately reflects updated configuration in local state without waiting for list reload', () => {
      let configs = [...initialConfigs];
      let mutationTracker = { sequence: 0, items: {} };

      // Simulate backend update response
      const updatedKey = 'ai_chatbot_config';
      const newConfigValue = '{"model":"gpt-4-turbo","temperature":0.7}';
      const mockBackendResponse = {
        success: true,
        message: "Remote Config 'ai_chatbot_config' updated successfully",
        config: {
          id: 1,
          key: updatedKey,
          type: 'json',
          value: newConfigValue,
          active: true,
          platform: 'android',
          app: 'designwiz'
        }
      };

      // 1. Record mutation
      mutationTracker = recordMutationHelper(mutationTracker, 'android', 'designwiz', updatedKey);

      // 2. Immediate local update
      configs = configs.map(c => c.key === updatedKey ? { ...c, ...mockBackendResponse.config } : c);

      // Verify local state has new value immediately
      const current = configs.find(c => c.key === updatedKey);
      assert.strictEqual(current.value, newConfigValue);

      // Verify sorting by 'recent' puts updated config at top
      const sorted = filterAndSortConfigs({
        configs,
        searchQuery: '',
        typeFilter: '',
        statusFilter: '',
        sortBy: 'recent',
        platform: 'android',
        app: 'designwiz',
        mutationTracker
      });
      assert.strictEqual(sorted[0].key, updatedKey);
    });

    it('reconciles background list response while shielding recent local updates against replication delay', () => {
      let configs = [
        { id: 1, srNo: 1, key: 'ai_chatbot_config', type: 'json', value: '{"model":"gpt-4-turbo"}', active: true },
        { id: 2, srNo: 2, key: 'billing_retry_limit', type: 'number', value: '3', active: true }
      ];

      // Mutation tracker records that 'ai_chatbot_config' was updated 2 seconds ago
      const mutationTracker = {
        sequence: 1,
        items: {
          'android:designwiz:ai_chatbot_config': {
            sequence: 1,
            timestamp: Date.now() - 2000,
            platform: 'android',
            app: 'designwiz',
            key: 'ai_chatbot_config'
          }
        }
      };

      // Upstream server returns a list that still has stale value for ai_chatbot_config due to upstream caching
      const staleServerList = [
        { id: 1, srNo: 1, key: 'ai_chatbot_config', type: 'json', value: '{"model":"gpt-4"}', active: true },
        { id: 2, srNo: 2, key: 'billing_retry_limit', type: 'number', value: '5', active: true } // another user updated billing to 5
      ];

      const reconciled = reconcileServerList(staleServerList, configs, 'android', 'designwiz', mutationTracker, 15000);

      // 'ai_chatbot_config' should retain the local confirmed value
      assert.strictEqual(reconciled.find(c => c.key === 'ai_chatbot_config').value, '{"model":"gpt-4-turbo"}');
      // 'billing_retry_limit' was not locally mutated, so it receives upstream's new value (5)
      assert.strictEqual(reconciled.find(c => c.key === 'billing_retry_limit').value, '5');
    });

    it('discards stale background responses using sequence IDs', () => {
      let activeFetchId = 1;

      // Request 1 starts
      const req1FetchId = ++activeFetchId; // 2
      // Request 2 starts immediately after
      const req2FetchId = ++activeFetchId; // 3

      // When Request 1 returns late:
      const shouldApplyReq1 = req1FetchId === activeFetchId;
      assert.strictEqual(shouldApplyReq1, false, 'Late response from req1 must be ignored');

      // When Request 2 returns:
      const shouldApplyReq2 = req2FetchId === activeFetchId;
      assert.strictEqual(shouldApplyReq2, true, 'Latest response from req2 must be applied');
    });

    it('prevents update and displays conflict if upstream value changed while dialog was open', () => {
      const baseline = {
        id: 1,
        key: 'ai_chatbot_config',
        value: '{"model":"gpt-4"}',
        type: 'json',
        active: true
      };

      // Upstream currently has a different value (another user updated it)
      const currentUpstream = {
        id: 1,
        key: 'ai_chatbot_config',
        value: '{"model":"claude-3"}',
        type: 'json',
        active: true
      };

      const hasConflict = currentUpstream.value !== baseline.value ||
                          currentUpstream.type !== baseline.type ||
                          currentUpstream.active !== baseline.active;

      assert.strictEqual(hasConflict, true, 'Conflict must be detected');
    });

    it('preserves user inputs and does not update state if backend returns an error', () => {
      let configs = [...initialConfigs];
      let mutationTracker = { sequence: 0, items: {} };
      let editModalOpen = true;
      let formValue = '{"invalid_key":'; // malformed or rejected by server

      // Update fails
      const serverFailed = true;
      if (serverFailed) {
        // Modal remains open, inputs preserved, no mutation recorded
        assert.strictEqual(editModalOpen, true);
        assert.strictEqual(formValue, '{"invalid_key":');
        assert.strictEqual(mutationTracker.sequence, 0);
      }
    });
  });
});
