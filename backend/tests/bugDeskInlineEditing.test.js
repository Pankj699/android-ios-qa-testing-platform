const { describe, test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

describe('BugDesk Inline Editing Suite', () => {
  const previewPath = path.resolve(__dirname, '../../frontend/src/bugdesk/components/BugReportPreview.jsx');
  const newBugPath = path.resolve(__dirname, '../../frontend/src/bugdesk/pages/BugDeskNewBug.jsx');
  const storagePath = path.resolve(__dirname, '../../frontend/src/bugdesk/lib/scoped-storage.js');

  const previewContent = fs.readFileSync(previewPath, 'utf8');
  const newBugContent = fs.readFileSync(newBugPath, 'utf8');
  const storageContent = fs.readFileSync(storagePath, 'utf8');

  test('1. InlineEditableText component exists and is properly configured', () => {
    assert.ok(
      previewContent.includes('export const InlineEditableText = React.forwardRef'),
      'InlineEditableText component should be defined with forwardRef'
    );
    assert.ok(
      previewContent.includes('contentEditable'),
      'Must have contentEditable attribute'
    );
    assert.ok(
      previewContent.includes('suppressContentEditableWarning'),
      'Must suppress contentEditable warning'
    );
    assert.ok(
      previewContent.includes('role="textbox"'),
      'Must have role="textbox" for accessibility'
    );
    assert.ok(
      previewContent.includes('tabIndex={0}'),
      'Must be focusable with tabIndex={0}'
    );
    assert.ok(
      previewContent.includes('aria-multiline={multiline}'),
      'Must support aria-multiline'
    );
  });

  test('2. Normal state preserves existing styling with zero layout shift', () => {
    assert.ok(
      previewContent.includes('outline-none'),
      'Must remove default harsh browser outline'
    );
    assert.ok(
      previewContent.includes('px-1 -mx-1'),
      'Must use negative margin compensation to align with text baseline without shift'
    );
    assert.ok(
      previewContent.includes('text-slate-700 dark:text-slate-300'),
      'Must preserve theme text colors'
    );
    assert.ok(
      previewContent.includes('break-words whitespace-pre-wrap'),
      'Must preserve word wrapping and whitespace'
    );
  });

  test('3. Focus styling applies subtle ring and tint without disruptive borders', () => {
    assert.ok(
      previewContent.includes('focus:ring-1 focus:ring-amber-400/50 dark:focus:ring-violet-400/40'),
      'Must apply subtle theme-matching focus ring'
    );
    assert.ok(
      previewContent.includes('focus:bg-amber-500/[0.05] dark:focus:bg-violet-500/[0.07]'),
      'Must apply subtle focus background tint'
    );
  });

  test('4. Keyboard lifecycle: Escape cancels and restores original text', () => {
    assert.ok(
      previewContent.includes('if (e.key === "Escape")'),
      'Must handle Escape key'
    );
    assert.ok(
      previewContent.includes('internalRef.current.innerText = originalTextRef.current'),
      'Escape must restore original text from before that editing session'
    );
    assert.ok(
      previewContent.includes('internalRef.current.blur()'),
      'Escape must blur the element'
    );
    assert.ok(
      previewContent.includes('isCancelledRef.current = true'),
      'Escape must set cancellation flag so blur does not commit changes'
    );
  });

  test('5. Keyboard lifecycle: Enter in multiline mode inserts newlines without triggering forms', () => {
    assert.ok(
      previewContent.includes('if (e.key === "Enter")'),
      'Must handle Enter key'
    );
    assert.ok(
      previewContent.includes('if (multiline) {'),
      'Must check if multiline mode is enabled'
    );
    assert.ok(
      previewContent.includes('e.stopPropagation()'),
      'Enter in multiline must call e.stopPropagation to prevent form submission or global shortcuts'
    );
  });

  test('6. Keyboard lifecycle: Enter in Reproduction Steps adds and focuses next step', () => {
    assert.ok(
      previewContent.includes('handleEnterNextStep'),
      'Must define handleEnterNextStep'
    );
    assert.ok(
      previewContent.includes('nextSteps.splice(index + 1, 0, "")'),
      'Must insert empty step at index + 1'
    );
    assert.ok(
      previewContent.includes('focusStepIndexRef.current = index + 1'),
      'Must set focus target to index + 1'
    );
  });

  test('7. Keyboard lifecycle: Backspace on empty step removes step and focuses previous', () => {
    assert.ok(
      previewContent.includes('if (e.key === "Backspace" && !multiline)'),
      'Must handle Backspace in single line mode'
    );
    assert.ok(
      previewContent.includes('handleRemoveEmptyStep'),
      'Must define handleRemoveEmptyStep'
    );
    assert.ok(
      previewContent.includes('if (currentSteps.length <= 1) return;'),
      'Must not remove the last remaining step'
    );
    assert.ok(
      previewContent.includes('focusStepIndexRef.current = Math.max(0, index - 1)'),
      'Must focus previous step on removal'
    );
  });

  test('8. Sequential step numbering is maintained outside editable container', () => {
    assert.ok(
      previewContent.includes('className="text-[#D97706] dark:text-[#F59E0B] font-bold shrink-0 select-none">{i + 1}.</span>'),
      'Step numbers must be rendered sequentially as uneditable badges'
    );
  });

  test('9. Plain text paste strips rich formatting and HTML', () => {
    assert.ok(
      previewContent.includes('handlePaste'),
      'Must define handlePaste'
    );
    assert.ok(
      previewContent.includes('e.clipboardData.getData("text/plain")'),
      'Must extract only plain text from clipboard'
    );
  });

  test('10. Scoped storage supports updating existing bug report in history', () => {
    assert.ok(
      storageContent.includes('export function updateBugReport(userId, updatedReport)'),
      'Must export updateBugReport in scoped-storage.js'
    );
    assert.ok(
      storageContent.includes('r.id === updatedReport.id ? { ...r, ...updatedReport } : r'),
      'Must merge updated fields into existing report by id'
    );
  });

  test('11. BugDeskNewBug connects onReportChange to state and draft persistence', () => {
    assert.ok(
      newBugContent.includes('updateBugReport(session.userId, updated)'),
      'Must call updateBugReport on change'
    );
    assert.ok(
      newBugContent.includes('saveNewBugDraft(session.userId,'),
      'Must save updated report into draft storage'
    );
    assert.ok(
      newBugContent.includes('onReportChange={handleReportChange}'),
      'Must pass handleReportChange to BugReportPreview'
    );
  });

  test('12. All export and PMS actions immediately consume latest edited activeReport', () => {
    assert.ok(
      previewContent.includes('buildHeading(activeReport)'),
      'PMS issue and title copy must use activeReport'
    );
    assert.ok(
      previewContent.includes('buildBodyText(activeReport)'),
      'PMS issue and steps copy must use activeReport'
    );
    assert.ok(
      previewContent.includes('buildPMSReportHTML(activeReport)'),
      'Copy PMS report rich text must use activeReport'
    );
    assert.ok(
      previewContent.includes('buildPMSReportText(activeReport)'),
      'Copy PMS report plain text must use activeReport'
    );
    assert.ok(
      previewContent.includes('exportReportToTXT(activeReport)'),
      'TXT export must use activeReport'
    );
    assert.ok(
      previewContent.includes('exportReportToPDF(activeReport)'),
      'PDF export must use activeReport'
    );
  });
});
