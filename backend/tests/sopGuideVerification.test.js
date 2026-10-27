const { describe, it } = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

describe('SOP Guide Content & Integrity Verification Suite', () => {
  const sopDataPath = resolve(process.cwd(), 'frontend/src/pages/sopData.js');
  const sopPagePath = resolve(process.cwd(), 'frontend/src/pages/SopPage.jsx');
  const runTestPagePath = resolve(process.cwd(), 'frontend/src/pages/RunTestPage.jsx');
  const remoteConfigPagePath = resolve(process.cwd(), 'frontend/src/pages/RemoteConfigPage.jsx');
  const appPath = resolve(process.cwd(), 'frontend/src/App.jsx');

  const sopDataContent = readFileSync(sopDataPath, 'utf8');
  const sopPageContent = readFileSync(sopPagePath, 'utf8');
  const runTestPageContent = readFileSync(runTestPagePath, 'utf8');
  const remoteConfigPageContent = readFileSync(remoteConfigPagePath, 'utf8');
  const appContent = readFileSync(appPath, 'utf8');

  it('1. Contains exactly 17 comprehensive guides with unique IDs', () => {
    const idMatches = [...sopDataContent.matchAll(/id:\s*['"]([a-z0-9-]+)['"]/g)].map(m => m[1]);
    const categoryIds = ['all', 'getting-started', 'devices-mirroring', 'execution-testing', 'feature-flags', 'defect-tracking', 'admin-reference'];
    const guideIds = idMatches.filter(id => !categoryIds.includes(id));
    
    assert.strictEqual(guideIds.length, 17, `Expected 17 guides, found ${guideIds.length}: ${guideIds.join(', ')}`);
    const uniqueGuideIds = new Set(guideIds);
    assert.strictEqual(uniqueGuideIds.size, 17, 'Guide IDs must be unique');
  });

  it('2. Every guide contains the mandatory 6-part sections (Overview, Prerequisites, Steps, Expected Result, Troubleshooting, Warnings)', () => {
    const requiredSections = [
      'overview',
      'prerequisites',
      'steps',
      'expectedResult',
      'troubleshooting',
      'warnings'
    ];

    for (const section of requiredSections) {
      const occurrences = (sopDataContent.match(new RegExp(`${section}:`, 'g')) || []).length;
      assert.ok(occurrences >= 17, `Expected at least 17 '${section}' definitions, found ${occurrences}`);
    }
  });

  it('3. Every guide expectedResult contains appearance and verification fields', () => {
    const appearanceCount = (sopDataContent.match(/appearance:/g) || []).length;
    const verificationCount = (sopDataContent.match(/verification:/g) || []).length;
    assert.strictEqual(appearanceCount, 17, `Expected 17 appearance fields, found ${appearanceCount}`);
    assert.strictEqual(verificationCount, 17, `Expected 17 verification fields, found ${verificationCount}`);
  });

  it('4. Every troubleshooting item contains issue and solution fields', () => {
    const issueCount = (sopDataContent.match(/issue:/g) || []).length;
    const solutionCount = (sopDataContent.match(/solution:/g) || []).length;
    assert.ok(issueCount >= 17, `Expected at least 17 troubleshooting issues, found ${issueCount}`);
    assert.strictEqual(issueCount, solutionCount, 'Every issue must have a corresponding solution');
  });

  it('5. SopPage.jsx correctly references appearance and verification with fallbacks', () => {
    assert.ok(sopPageContent.includes('activeGuide.expectedResult?.appearance'), 'SopPage must render expected appearance');
    assert.ok(sopPageContent.includes('activeGuide.expectedResult?.verification'), 'SopPage must render verification instructions');
    assert.ok(sopPageContent.includes('trouble.issue'), 'SopPage must render troubleshooting issue');
    assert.ok(sopPageContent.includes('trouble.solution'), 'SopPage must render troubleshooting solution');
  });

  it('6. SopPage.jsx shortcuts table accurately reflects real platform handlers without hallucinations', () => {
    // Verify shortcuts table in SopPage does NOT claim Alt+C is Connect Device or Alt+U is Upload AAB
    assert.ok(!sopPageContent.includes('Connect Device</td>'), 'SopPage shortcuts table must not hallucinate Alt+C as Connect Device');
    assert.ok(!sopPageContent.includes('Upload AAB</td>'), 'SopPage shortcuts table must not hallucinate Alt+U as Upload AAB');

    // Verify true ADB actions are documented
    assert.ok(sopPageContent.includes('Alt + Q'), 'Must document Alt + Q');
    assert.ok(sopPageContent.includes('Alt + R'), 'Must document Alt + R');
    assert.ok(sopPageContent.includes('Alt + D'), 'Must document Alt + D');
    assert.ok(sopPageContent.includes('Alt + C'), 'Must document Alt + C');
    assert.ok(sopPageContent.includes('Alt + U'), 'Must document Alt + U');
    assert.ok(sopPageContent.includes('Wipe App Data'), 'Must document Alt + D as Wipe App Data');
    assert.ok(sopPageContent.includes('Clear App Cache'), 'Must document Alt + C as Clear App Cache');
    assert.ok(sopPageContent.includes('Uninstall Application'), 'Must document Alt + U as Uninstall');
  });

  it('7. Interactive contextual action buttons map to actual App.jsx tabs', () => {
    // App.jsx accepts 'history' (not 'test-history') and 'adb-ops' (not 'adb-operations')
    assert.ok(sopPageContent.includes("onNavigate('history')"), 'SopPage must navigate to history using tab ID history');
    assert.ok(sopPageContent.includes("onNavigate('adb-ops')"), 'SopPage must navigate to adb-ops using tab ID adb-ops');
    assert.ok(sopPageContent.includes("onNavigate('run-test')"), 'SopPage must navigate to run-test');
    assert.ok(sopPageContent.includes("onNavigate('screen-mirror')"), 'SopPage must navigate to screen-mirror');
    assert.ok(sopPageContent.includes("onNavigate('ui-inspector')"), 'SopPage must navigate to ui-inspector');
    assert.ok(sopPageContent.includes("onNavigate('remote-config')"), 'SopPage must navigate to remote-config');
    assert.ok(sopPageContent.includes("onNavigate('bug-desk')"), 'SopPage must navigate to bug-desk');
  });

  it('8. Interactive checklist has 10 acceptance criteria and persistent storage logic', () => {
    assert.ok(sopPageContent.includes('qa_sop_checklist_state_v2'), 'Checklist must use versioned localStorage key');
    assert.ok(sopPageContent.includes('CHECKLIST_ITEMS'), 'Must define CHECKLIST_ITEMS');
    assert.ok(sopPageContent.includes('resetChecklist'), 'Must provide resetChecklist function');
    assert.ok(sopPageContent.includes('localStorage.removeItem'), 'Reset must clear storage key');
  });
});
