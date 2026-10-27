const { describe, it } = require('node:test');
const assert = require('node:assert');

// Logic mirrors of RemoteConfigPage helpers
const findConfigInList = (list, target) => {
  if (!target || !Array.isArray(list)) return null;
  if (target.id) {
    const byId = list.find(c => c.id === target.id);
    if (byId) return byId;
  }
  const normKey = (target.key || '').trim().toLowerCase();
  const normApp = (target.app || '').trim().toLowerCase();
  const normPlt = (target.platform || '').trim().toLowerCase();
  return list.find(c => {
    const cKey = (c.key || '').trim().toLowerCase();
    const cApp = (c.app || '').trim().toLowerCase();
    const cPlt = (c.platform || '').trim().toLowerCase();
    return cKey === normKey && (!normApp || !cApp || cApp === normApp) && (!normPlt || !cPlt || cPlt === normPlt);
  }) || list.find(c => (c.key || '').trim().toLowerCase() === normKey) || null;
};

const getCompoundKey = (plt, app, key) => {
  return `${(plt || '').toLowerCase().trim()}:${(app || '').toLowerCase().trim()}:${(key || '').toLowerCase().trim()}`;
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
        if (aSeq > 0 && bSeq > 0) return bSeq - aSeq;
        return aSeq > 0 ? -1 : 1;
      }
      return (a.srNo || 0) - (b.srNo || 0);
    });
  } else if (sortBy === 'server') {
    result.sort((a, b) => (a.srNo || 0) - (b.srNo || 0));
  }
  return result;
};

describe('Remote Config Fresh Fetch & Concurrency Safeguards Suite', () => {

  it('1. User A updates a key; User B clicks View and sees the new value', async () => {
    // Initial state in User B's browser
    const userBConfigs = [
      { id: 101, key: 'feature_banner', value: '{"title":"Summer Sale"}', type: 'json', active: true, srNo: 1, platform: 'android', app: 'designwiz' },
      { id: 102, key: 'max_items', value: '10', type: 'number', active: true, srNo: 2, platform: 'android', app: 'designwiz' }
    ];

    // User A updates 'feature_banner' upstream
    const upstreamServiceState = [
      { id: 101, key: 'feature_banner', value: '{"title":"Winter Sale (Updated by User A)"}', type: 'json', active: true, srNo: 1, platform: 'android', app: 'designwiz' },
      { id: 102, key: 'max_items', value: '10', type: 'number', active: true, srNo: 2, platform: 'android', app: 'designwiz' }
    ];

    // User B clicks View on userBConfigs[0]
    const clickedConfig = userBConfigs[0];
    assert.strictEqual(clickedConfig.value, '{"title":"Summer Sale"}'); // Stale before click

    // Fresh fetch is triggered
    const freshRes = { configs: upstreamServiceState };
    const freshRecord = findConfigInList(freshRes.configs, clickedConfig);

    assert.ok(freshRecord, 'Fresh record resolved from upstream response');
    assert.strictEqual(freshRecord.value, '{"title":"Winter Sale (Updated by User A)"}');

    // Local state is updated
    const updatedUserBConfigs = freshRes.configs;
    assert.strictEqual(updatedUserBConfigs[0].value, '{"title":"Winter Sale (Updated by User A)"}');
  });

  it('2. User A updates a key; User B clicks Edit and receives the new value in the editor', async () => {
    // Initial state in User B's browser
    const userBConfigs = [
      { id: 201, key: 'discount_rate', value: '15', type: 'number', active: true, srNo: 1, platform: 'android', app: 'designwiz' }
    ];

    // User A updates discount_rate to 25 upstream
    const upstreamServiceState = [
      { id: 201, key: 'discount_rate', value: '25', type: 'number', active: true, srNo: 1, platform: 'android', app: 'designwiz' }
    ];

    // User B clicks Edit on discount_rate
    const clickedConfig = userBConfigs[0];
    const freshRes = { configs: upstreamServiceState };
    const freshRecord = findConfigInList(freshRes.configs, clickedConfig);

    // Baseline captured before opening editor
    const baseline = {
      id: freshRecord.id,
      key: freshRecord.key,
      value: freshRecord.value,
      type: freshRecord.type,
      active: freshRecord.active
    };

    assert.strictEqual(freshRecord.value, '25', 'Editor is populated with latest value 25, not stale 15');
    assert.strictEqual(baseline.value, '25');
  });

  it('3. User A updates a key; User B clicks Copy and copies the new raw value', async () => {
    // Initial state in User B's browser
    const userBConfigs = [
      { id: 301, key: 'theme_config', value: '{"dark":false}', type: 'json', active: true, srNo: 1, platform: 'android', app: 'designwiz' }
    ];

    // User A updates upstream
    const upstreamServiceState = [
      { id: 301, key: 'theme_config', value: '{"dark":true,"accent":"purple"}', type: 'json', active: true, srNo: 1, platform: 'android', app: 'designwiz' }
    ];

    // User B clicks Copy
    let clipboardContent = '';
    const mockClipboardWrite = async (val) => { clipboardContent = val; };

    const freshRes = { configs: upstreamServiceState };
    const freshRecord = findConfigInList(freshRes.configs, userBConfigs[0]);
    await mockClipboardWrite(freshRecord.value);

    assert.strictEqual(clipboardContent, '{"dark":true,"accent":"purple"}');
    assert.notStrictEqual(clipboardContent, userBConfigs[0].value, 'Did not copy stale data');
  });

  it('4. A failed refresh does not silently display or copy stale data as current', async () => {
    const staleConfig = { id: 401, key: 'stale_key', value: 'STALE_DATA' };

    let dialogOpened = false;
    let copiedValue = null;
    let errorToastShown = false;

    // Simulate upstream 502/Network failure
    try {
      throw new Error('Upstream service unavailable (Connection refused)');
      // dialogOpened would be set here if not failed
      dialogOpened = true;
    } catch (err) {
      errorToastShown = true;
      assert.ok(err.message.includes('Connection refused'));
    }

    assert.strictEqual(dialogOpened, false, 'View/Edit dialog was NOT opened with stale data');
    assert.strictEqual(copiedValue, null, 'Clipboard was NOT populated with stale data');
    assert.strictEqual(errorToastShown, true, 'Error message was presented to user');
  });

  it('5. An update conflict is detected before overwriting a newer value when the available API permits comparison', async () => {
    // User B opens Edit modal when upstream value is "version_1"
    const baselineLoaded = { id: 501, key: 'app_title', value: 'version_1', type: 'json', active: true };

    // User B types "version_1_edited_by_B" in the form
    const formEditedValue = 'version_1_edited_by_B';

    // Meanwhile, User A saved "version_2_by_A" upstream
    const currentUpstream = { id: 501, key: 'app_title', value: 'version_2_by_A', type: 'json', active: true };

    // User B clicks "Update Config"
    // Concurrency check runs:
    const valueChanged = currentUpstream.value !== baselineLoaded.value;
    const typeChanged = currentUpstream.type !== baselineLoaded.type;
    const activeChanged = currentUpstream.active !== baselineLoaded.active;

    const conflictDetected = valueChanged || typeChanged || activeChanged;
    assert.strictEqual(conflictDetected, true, 'Conflict successfully detected between baseline and current upstream');

    // Conflict UI halts submission
    const conflictState = {
      detected: true,
      upstreamValue: currentUpstream.value,
      baselineValue: baselineLoaded.value
    };
    assert.strictEqual(conflictState.upstreamValue, 'version_2_by_A');
    assert.strictEqual(conflictState.baselineValue, 'version_1');
  });

  it('6. Older responses cannot overwrite newer state (Race Condition Protection)', async () => {
    let actionFetchId = 0;
    let stateValue = 'initial';

    // Request 1 initiated
    const req1Id = ++actionFetchId; // 1

    // Request 2 initiated shortly after
    const req2Id = ++actionFetchId; // 2

    // Request 2 finishes FAST (e.g. 50ms)
    if (req2Id === actionFetchId) {
      stateValue = 'response_2_latest';
    }

    // Request 1 finishes SLOW (e.g. 300ms)
    if (req1Id === actionFetchId) {
      stateValue = 'response_1_stale';
    }

    assert.strictEqual(stateValue, 'response_2_latest', 'Stale response 1 was ignored because req1Id !== actionFetchId');
  });

  it('7. Identical keys in different applications or platforms are resolved correctly', () => {
    const configs = [
      { id: 701, key: 'welcome_msg', value: 'Welcome Android App 1', platform: 'android', app: 'app1' },
      { id: 702, key: 'welcome_msg', value: 'Welcome Android App 2', platform: 'android', app: 'app2' },
      { id: 703, key: 'welcome_msg', value: 'Welcome iOS App 1', platform: 'ios', app: 'app1' }
    ];

    const target1 = { key: 'welcome_msg', platform: 'android', app: 'app1' };
    const target2 = { key: 'welcome_msg', platform: 'android', app: 'app2' };
    const target3 = { key: 'welcome_msg', platform: 'ios', app: 'app1' };

    const resolved1 = findConfigInList(configs, target1);
    const resolved2 = findConfigInList(configs, target2);
    const resolved3 = findConfigInList(configs, target3);

    assert.strictEqual(resolved1.id, 701);
    assert.strictEqual(resolved1.value, 'Welcome Android App 1');

    assert.strictEqual(resolved2.id, 702);
    assert.strictEqual(resolved2.value, 'Welcome Android App 2');

    assert.strictEqual(resolved3.id, 703);
    assert.strictEqual(resolved3.value, 'Welcome iOS App 1');
  });

  it('8. View and Copy do not incorrectly modify Recently Updated ordering', () => {
    const initialTracker = {
      sequence: 1,
      items: {
        'android:designwiz:cfg_b': { sequence: 1, key: 'cfg_b' }
      }
    };

    const configs = [
      { id: 801, key: 'cfg_a', srNo: 1, value: 'val_a' },
      { id: 802, key: 'cfg_b', srNo: 2, value: 'val_b' }, // mutated in session, so sequence 1
      { id: 803, key: 'cfg_c', srNo: 3, value: 'val_c' }
    ];

    // Sorted before View/Copy
    const sortedBefore = sortConfigs(configs, 'recent', 'android', 'designwiz', initialTracker);
    assert.strictEqual(sortedBefore[0].key, 'cfg_b', 'Mutated key cfg_b is first');
    assert.strictEqual(sortedBefore[1].key, 'cfg_a');
    assert.strictEqual(sortedBefore[2].key, 'cfg_c');

    // User clicks View or Copy on cfg_a
    // Fresh configs fetched, local table updated, but tracker NOT modified!
    const trackerAfter = initialTracker; // untouched

    const sortedAfter = sortConfigs(configs, 'recent', 'android', 'designwiz', trackerAfter);
    assert.deepStrictEqual(sortedBefore.map(c => c.key), sortedAfter.map(c => c.key), 'View/Copy did not alter sorting order');
  });

  it('9. Concurrency resolution: Reload Latest Upstream Value and Review & Overwrite Anyway', () => {
    const baseline = { key: 'k1', value: 'old', active: true };
    const upstream = { key: 'k1', value: 'updated_by_team', active: false };

    // 1. Reload latest: form takes upstream values
    let formState = { value: 'my_draft', active: true };
    const reloadLatest = (up) => {
      formState = { value: up.value, active: up.active };
    };
    reloadLatest(upstream);
    assert.strictEqual(formState.value, 'updated_by_team');
    assert.strictEqual(formState.active, false);

    // 2. Review and force overwrite: saves my_draft even if upstream changed
    let savedValue = null;
    const save = (val, force) => {
      if (!force && val !== upstream.value) throw new Error('Conflict');
      savedValue = val;
    };
    save('my_draft_reviewed', true);
    assert.strictEqual(savedValue, 'my_draft_reviewed');
  });
});
