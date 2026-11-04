const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// 1. Direct validation of isFlyerMakerBuild utility logic
test('1. isFlyerMakerBuild validation logic', async (t) => {
  const buildUtilsPath = path.resolve(__dirname, '../../frontend/src/utils/buildUtils.js');
  assert.ok(fs.existsSync(buildUtilsPath), 'frontend/src/utils/buildUtils.js must exist');
  
  const content = fs.readFileSync(buildUtilsPath, 'utf8');
  assert.match(content, /com\.bg\.flyermaker/, 'Must check com.bg.flyermaker');

  // Load implementation in Node context
  const cleanCode = content.replace(/export\s+/g, '');
  const moduleScope = new Function(`${cleanCode}; return { FLYER_MAKER_PACKAGE, isFlyerMakerBuild };`)();
  const { FLYER_MAKER_PACKAGE, isFlyerMakerBuild } = moduleScope;

  await t.test('returns true for exact Flyer Maker package name', () => {
    assert.strictEqual(isFlyerMakerBuild({ packageName: 'com.bg.flyermaker' }), true);
  });

  await t.test('returns true for case-insensitive or untrimmed package name', () => {
    assert.strictEqual(isFlyerMakerBuild({ packageName: 'COM.BG.FLYERMAKER' }), true);
    assert.strictEqual(isFlyerMakerBuild({ packageName: '  com.bg.flyermaker  ' }), true);
  });

  await t.test('returns false for other application builds', () => {
    assert.strictEqual(isFlyerMakerBuild({ packageName: 'com.planner.journal' }), false);
    assert.strictEqual(isFlyerMakerBuild({ packageName: 'com.nra.flyermaker' }), false);
    assert.strictEqual(isFlyerMakerBuild({ packageName: 'com.android.chrome' }), false);
  });

  await t.test('returns false when build is null, undefined, or missing packageName', () => {
    assert.strictEqual(isFlyerMakerBuild(null), false);
    assert.strictEqual(isFlyerMakerBuild(undefined), false);
    assert.strictEqual(isFlyerMakerBuild({}), false);
    assert.strictEqual(isFlyerMakerBuild({ packageName: '' }), false);
    assert.strictEqual(isFlyerMakerBuild({ packageName: null }), false);
  });
});

// 2. Consistency across Header, Recording Controls, and RunTestPage
test('2. UI & Header menu consistency for Delete App User based on selected build', async (t) => {
  const headerPath = path.resolve(__dirname, '../../frontend/src/components/Header.jsx');
  const controlsPath = path.resolve(__dirname, '../../frontend/src/components/BugDeskRecordingControls.jsx');
  const runTestPagePath = path.resolve(__dirname, '../../frontend/src/pages/RunTestPage.jsx');
  const appPath = path.resolve(__dirname, '../../frontend/src/App.jsx');
  const modalPath = path.resolve(__dirname, '../../frontend/src/components/DeleteAppUserModal.jsx');

  const headerContent = fs.readFileSync(headerPath, 'utf8');
  const controlsContent = fs.readFileSync(controlsPath, 'utf8');
  const runTestContent = fs.readFileSync(runTestPagePath, 'utf8');
  const appContent = fs.readFileSync(appPath, 'utf8');
  const modalContent = fs.readFileSync(modalPath, 'utf8');

  await t.test('Header accepts selectedBuild and onOpenDeleteUserModal and forwards them to BugDeskRecordingControls', () => {
    assert.match(headerContent, /selectedBuild/, 'Header must receive selectedBuild prop');
    assert.match(headerContent, /onOpenDeleteUserModal/, 'Header must receive onOpenDeleteUserModal prop');
    assert.match(headerContent, /<BugDeskRecordingControls[\s\S]*?selectedBuild=\{selectedBuild\}[\s\S]*?onOpenDeleteUserModal=\{onOpenDeleteUserModal\}/,
      'Header must forward selectedBuild and onOpenDeleteUserModal to BugDeskRecordingControls');
  });

  await t.test('BugDeskRecordingControls enforces isFlyerMakerBuild check for Delete App User', () => {
    assert.match(controlsContent, /isFlyerMakerBuild\(selectedBuild\)/, 'Controls must evaluate isFlyerMakerBuild(selectedBuild)');
    assert.match(controlsContent, /\{isFlyerMaker && \([\s\S]*?Delete App User[\s\S]*?\)\}/,
      'Controls must conditionally render Delete App User inside Device Actions dropdown');
    assert.match(controlsContent, /Screen Mirror/, 'Preserves Screen Mirror action');
    assert.match(controlsContent, /Record Screen/, 'Preserves Record Screen action');
  });

  await t.test('RunTestPage enforces identical isFlyerMakerBuild check for Delete App User', () => {
    assert.match(runTestContent, /isFlyerMakerBuild\(selectedBuild\)/, 'RunTestPage must evaluate isFlyerMakerBuild(selectedBuild)');
    assert.match(runTestContent, /\{isFlyerMakerBuild\(selectedBuild\) && \([\s\S]*?Delete App User[\s\S]*?\)\}/,
      'RunTestPage must conditionally render Delete App User inside its Device Actions dropdown');
    assert.match(runTestContent, /Screen Mirror/, 'Preserves Screen Mirror action');
    assert.match(runTestContent, /Connect USB/, 'Preserves Connect USB action');
    assert.match(runTestContent, /Pair \(Wi-Fi\)/, 'Preserves Pair (Wi-Fi) action');
  });

  await t.test('App.jsx provides unified DeleteAppUserModal without duplicate implementations', () => {
    assert.match(appContent, /import DeleteAppUserModal from '\.\/components\/DeleteAppUserModal';/,
      'App.jsx must import DeleteAppUserModal');
    assert.match(appContent, /<DeleteAppUserModal[\s\S]*?isOpen=\{deleteUserModalOpen\}/,
      'App.jsx must render unified DeleteAppUserModal');
    assert.match(appContent, /<Header[\s\S]*?selectedBuild=\{selectedBuild\}[\s\S]*?onOpenDeleteUserModal=/,
      'App.jsx must wire selectedBuild and onOpenDeleteUserModal to Header');
    assert.match(appContent, /<RunTestPage[\s\S]*?onOpenDeleteUserModal=/,
      'App.jsx must wire onOpenDeleteUserModal to RunTestPage');
  });

  await t.test('DeleteAppUserModal encapsulates dynamic detection, manual editing, and credits removal', () => {
    assert.match(modalContent, /api\.getAppUser/, 'Modal must call api.getAppUser');
    assert.match(modalContent, /api\.deleteAppUser/, 'Modal must call api.deleteAppUser');
    assert.match(modalContent, /Auto-detected/, 'Modal must show Auto-detected badge');
    assert.match(modalContent, /Manually edited/, 'Modal must show Manually edited badge');
    assert.match(modalContent, /removeCredits/, 'Modal must show upstream notice regarding removeCredits behavior');
  });
});
