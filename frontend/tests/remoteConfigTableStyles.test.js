import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Remote Config Table Row Height and Key Typography Suite', () => {
  const filePath = path.resolve(__dirname, '../src/pages/RemoteConfigPage.jsx');
  const fileContent = fs.readFileSync(filePath, 'utf8');

  it('1. Verifies Key column uses global theme font (font-sans) instead of monospace (font-mono)', () => {
    // Locate the Key column td block
    const keyColumnMatch = fileContent.match(/\{\/\* Key \*\/\}\s*<td className="([^"]*)">\s*<div[^>]*>\s*<span className="([^"]*)">\s*\{cfg\.key\}/);
    assert.ok(keyColumnMatch, 'Key column <td> and <span> structure should be present');

    const [_, tdClass, spanClass] = keyColumnMatch;

    // Check Key span font
    assert.ok(spanClass.includes('font-sans'), 'Key column span must use font-sans');
    assert.ok(!spanClass.includes('font-mono'), 'Key column span must NOT use font-mono');
    assert.ok(spanClass.includes('font-bold'), 'Key column span must preserve font-bold');
    assert.ok(spanClass.includes('text-xs'), 'Key column span must preserve text-xs');
    assert.ok(spanClass.includes('break-all'), 'Key column span must preserve break-all for long keys');
  });

  it('2. Verifies table row height increased via py-4 and align-middle on all cells', () => {
    // Match the table row in tbody
    const trMatch = fileContent.match(/<tr\s+key=\{cfg\.id \|\| cfg\.key\}[^>]*>([\s\S]*?)<\/tr>/);
    assert.ok(trMatch, 'Table row definition should exist in filteredConfigs.map');

    const rowContent = trMatch[1];
    const tdMatches = [...rowContent.matchAll(/<td className="([^"]*)"/g)];

    assert.strictEqual(tdMatches.length, 7, 'Remote Config row must contain exactly 7 cells');

    tdMatches.forEach(([_, className], index) => {
      assert.ok(
        className.includes('py-4'),
        `Cell ${index + 1} with class "${className}" must have py-4 vertical padding`
      );
      assert.ok(
        !className.includes('py-3.5'),
        `Cell ${index + 1} with class "${className}" must NOT have old py-3.5 padding`
      );
      assert.ok(
        className.includes('align-middle'),
        `Cell ${index + 1} with class "${className}" must have align-middle for vertical centering`
      );
    });
  });

  it('3. Verifies monospace is preserved in code/data areas (ConfigValuePreview, JSON Editor)', () => {
    // ConfigValuePreview should retain font-mono
    assert.ok(
      fileContent.includes("font-mono text-[11.5px] leading-tight truncate px-2.5 py-1.5 rounded-lg bg-[#07090E]"),
      'JSON value preview must retain font-mono'
    );
    // Line numbers in JSON editor should retain font-mono
    assert.ok(
      fileContent.includes("font-mono text-[13px] text-slate-600"),
      'JSON editor line numbers must retain font-mono'
    );
  });
});
