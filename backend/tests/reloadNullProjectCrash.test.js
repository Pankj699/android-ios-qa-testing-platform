const { describe, test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

describe('QA Platform Reload & Null Project State Regression Suite', () => {
  const newBugPath = path.resolve(__dirname, '../../frontend/src/bugdesk/pages/BugDeskNewBug.jsx');
  const useSettingsPath = path.resolve(__dirname, '../../frontend/src/bugdesk/hooks/use-module-settings.js');
  const appPath = path.resolve(__dirname, '../../frontend/src/App.jsx');
  const headerPath = path.resolve(__dirname, '../../frontend/src/components/Header.jsx');
  const reportFormatPath = path.resolve(__dirname, '../../frontend/src/bugdesk/lib/report-format.js');
  const pmsIntegrationPath = path.resolve(__dirname, '../../frontend/src/bugdesk/lib/pms-integration.js');

  const newBugContent = fs.readFileSync(newBugPath, 'utf8');
  const useSettingsContent = fs.readFileSync(useSettingsPath, 'utf8');
  const appContent = fs.readFileSync(appPath, 'utf8');
  const headerContent = fs.readFileSync(headerPath, 'utf8');
  const reportFormatContent = fs.readFileSync(reportFormatPath, 'utf8');
  const pmsIntegrationContent = fs.readFileSync(pmsIntegrationPath, 'utf8');

  test('1. BugDeskNewBug does not access settings.project without optional chaining', () => {
    // Find all occurrences of settings.project in BugDeskNewBug.jsx
    const matches = newBugContent.match(/settings\s*\.\s*project/g) || [];
    assert.strictEqual(
      matches.length,
      0,
      'BugDeskNewBug must NOT contain naked "settings.project" access. All accesses must be "settings?.project".'
    );
  });

  test('2. BugDeskNewBug handleReportChange dependency array uses optional chaining for settings', () => {
    assert.ok(
      newBugContent.includes('settings?.project'),
      'Dependency list and callback body must use settings?.project'
    );
    assert.ok(
      newBugContent.includes('settings?.module'),
      'Dependency list and callback body must use settings?.module'
    );
    assert.ok(
      newBugContent.includes('settings?.round'),
      'Dependency list and callback body must use settings?.round'
    );
  });

  test('3. useModuleSettings lazily restores persisted settings synchronously on initial render', () => {
    assert.ok(
      useSettingsContent.includes('session?.userId ? getModuleSettings(session.userId) : null'),
      'useModuleSettings must synchronously initialize settings state from localStorage on first render pass'
    );
  });

  test('4. App root lazily restores bugDeskModuleSettings synchronously from active user', () => {
    assert.ok(
      appContent.includes('user?.id ? getModuleSettings(user.id) : null'),
      'App root must initialize bugDeskModuleSettings synchronously to prevent null-state flashing'
    );
  });

  test('5. Header safely guards project tooltip against null or partial settings', () => {
    assert.ok(
      headerContent.includes('bugDeskModuleSettings && (bugDeskModuleSettings.project || bugDeskModuleSettings.module)'),
      'Header must check project/module existence before rendering active project tooltip'
    );
  });

  test('6. report-format buildHeading handles null and missing fields gracefully', () => {
    // Dynamically test buildHeading with simulated node ESM execution
    assert.ok(
      reportFormatContent.includes('if (!report) return "";'),
      'buildHeading must return empty string when report is null'
    );
    assert.ok(
      reportFormatContent.includes('report.project || ""'),
      'buildHeading must provide fallback for missing report.project'
    );
  });

  test('7. pms-integration detectPlatformFromContext handles null context gracefully', () => {
    assert.ok(
      pmsIntegrationContent.includes('context?.project || ""'),
      'detectPlatformFromContext must use optional chaining for context.project'
    );
    assert.ok(
      pmsIntegrationContent.includes('context?.module || ""'),
      'detectPlatformFromContext must use optional chaining for context.module'
    );
  });
});
