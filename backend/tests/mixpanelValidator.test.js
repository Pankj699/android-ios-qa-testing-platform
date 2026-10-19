const { test, describe, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

const db = require('../src/db');
const { runMigrations } = require('../src/db/migrate');
const mixpanelSpecificationService = require('../src/services/mixpanelSpecificationService');
const { validateEvent } = require('../src/services/mixpanelValidationEngine');
const mixpanelCollectorService = require('../src/services/mixpanelCollectorService');
const mixpanelController = require('../src/controllers/mixpanelController');
const deviceLockService = require('../src/services/deviceLockService');
const config = require('../src/config');

describe('Mixpanel Event Validator & Multi-User Testing Suite', () => {
  let userAlice;
  let userBob;
  let adminUser;

  // Helper to generate a minimal valid .xlsx buffer with given 2D rows
  function createTestWorkbookBuffer(sheetRows) {
    const zip = new AdmZip();

    // [Content_Types].xml
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`;
    zip.addFile('[Content_Types].xml', Buffer.from(contentTypes, 'utf8'));

    // _rels/.rels
    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
    zip.addFile('_rels/.rels', Buffer.from(rootRels, 'utf8'));

    // xl/_rels/workbook.xml.rels
    const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;
    zip.addFile('xl/_rels/workbook.xml.rels', Buffer.from(wbRels, 'utf8'));

    // xl/workbook.xml
    const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Analytics_Events" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;
    zip.addFile('xl/workbook.xml', Buffer.from(workbookXml, 'utf8'));

    // Shared Strings & Worksheet XML
    const sharedStrings = [];
    const stringMap = new Map();

    function getStringIndex(str) {
      if (stringMap.has(str)) return stringMap.get(str);
      const idx = sharedStrings.length;
      sharedStrings.push(str);
      stringMap.set(str, idx);
      return idx;
    }

    let rowsXml = '';
    sheetRows.forEach((row, rIdx) => {
      const rowNum = rIdx + 1;
      let cellsXml = '';
      row.forEach((cellVal, cIdx) => {
        if (cellVal === undefined || cellVal === null) return;
        const colLetter = String.fromCharCode(65 + cIdx);
        const cellRef = `${colLetter}${rowNum}`;
        const sIdx = getStringIndex(String(cellVal));
        cellsXml += `<c r="${cellRef}" t="s"><v>${sIdx}</v></c>`;
      });
      rowsXml += `<row r="${rowNum}">${cellsXml}</row>`;
    });

    // xl/worksheets/sheet1.xml
    const sheet1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${rowsXml}</sheetData>
</worksheet>`;
    zip.addFile('xl/worksheets/sheet1.xml', Buffer.from(sheet1Xml, 'utf8'));

    // xl/sharedStrings.xml
    let siElements = '';
    for (const str of sharedStrings) {
      siElements += `<si><t>${str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</t></si>`;
    }
    const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">
  ${siElements}
</sst>`;
    zip.addFile('xl/sharedStrings.xml', Buffer.from(sharedStringsXml, 'utf8'));

    return zip.toBuffer();
  }

  before(async () => {
    await runMigrations();

    // Create test users in DB
    const u1Res = await db.query(
      `INSERT INTO users (email, name, password_hash, role)
       VALUES ('alice.mp@test.internal', 'Alice Tester', 'dummy_hash', 'tester')
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, email, name, role`
    );
    userAlice = u1Res.rows[0];

    const u2Res = await db.query(
      `INSERT INTO users (email, name, password_hash, role)
       VALUES ('bob.mp@test.internal', 'Bob Tester', 'dummy_hash', 'tester')
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, email, name, role`
    );
    userBob = u2Res.rows[0];

    const u3Res = await db.query(
      `INSERT INTO users (email, name, password_hash, role)
       VALUES ('admin.mp@test.internal', 'Admin User', 'dummy_hash', 'ADMIN')
       ON CONFLICT (email) DO UPDATE SET role = 'ADMIN'
       RETURNING id, email, name, role`
    );
    adminUser = u3Res.rows[0];
  });

  after(async () => {
    // Cleanup sessions and test events
    if (userAlice?.id && userBob?.id) {
      await db.query('DELETE FROM mixpanel_sessions WHERE user_id IN ($1, $2)', [userAlice.id, userBob.id]);
      await db.query('DELETE FROM mixpanel_specifications WHERE user_id IN ($1, $2)', [userAlice.id, userBob.id]);
    }
  });

  // -------------------------------------------------------------
  // Test 1: Excel Parsing with adm-zip and multiline parameter specifications
  // -------------------------------------------------------------
  test('1. Workbook Parser: correctly parses table headers, multiline parameters, types, and descriptions', () => {
    const rawRows = [
      ['Event Name', 'Parameter Attributes', 'Data Type', 'Description'],
      [
        'app_open',
        '• app_version: string (semantic version)\n• screen_name: string\n• is_first_open: boolean\n• session_count: number',
        'string',
        'Triggered when app finishes cold launch'
      ],
      [
        'purchase_completed',
        'item_id (string)\nprice (number)\ncurrency (string)\nis_discounted (boolean)',
        '',
        'Fired on checkout completion'
      ]
    ];

    const buffer = createTestWorkbookBuffer(rawRows);
    const parsed = mixpanelSpecificationService.parseWorkbook(buffer, 'test_spec.xlsx');

    assert.equal(parsed.eventsCount, 2);
    assert.equal(parsed.rules.length, 2);

    const appOpenRule = parsed.rules.find(r => r.eventName === 'app_open');
    assert.ok(appOpenRule, 'app_open rule should be found');
    assert.equal(appOpenRule.parameters.length, 4);

    const appVer = appOpenRule.parameters.find(p => p.name === 'app_version');
    assert.ok(appVer);
    assert.equal(appVer.type, 'string');

    const isFirst = appOpenRule.parameters.find(p => p.name === 'is_first_open');
    assert.ok(isFirst);
    assert.equal(isFirst.type, 'boolean');

    const purchaseRule = parsed.rules.find(r => r.eventName === 'purchase_completed');
    assert.ok(purchaseRule);
    assert.equal(purchaseRule.parameters.length, 4);
    const priceParam = purchaseRule.parameters.find(p => p.name === 'price');
    assert.ok(priceParam);
    assert.equal(priceParam.type, 'number');
  });

  // -------------------------------------------------------------
  // Test 2: Validation Engine (MATCHED, MISSING, EXTRA, INCORRECT, UNMAPPED)
  // -------------------------------------------------------------
  test('2. Validation Engine: verifies MATCHED status when all parameters conform to spec', () => {
    const specRules = [
      {
        eventName: 'button_clicked',
        parameters: [
          { name: 'button_id', type: 'string', required: true },
          { name: 'screen_name', type: 'string', required: true },
          { name: 'click_count', type: 'number', required: false }
        ]
      }
    ];

    const payload = {
      event: 'button_clicked',
      properties: {
        button_id: 'btn_submit',
        screen_name: 'LoginScreen',
        click_count: 3
      }
    };

    const result = validateEvent(payload, specRules);
    assert.equal(result.status, 'MATCHED');
    assert.equal(result.metrics.matched, 3);
    assert.equal(result.metrics.missing, 0);
    assert.equal(result.metrics.extra, 0);
    assert.equal(result.metrics.incorrect, 0);
  });

  test('3. Validation Engine: detects MISSING required parameters', () => {
    const specRules = [
      {
        eventName: 'user_signup',
        parameters: [
          { name: 'user_id', type: 'string', required: true },
          { name: 'signup_method', type: 'string', required: true },
          { name: 'referral_code', type: 'string', required: false }
        ]
      }
    ];

    const payload = {
      event: 'user_signup',
      properties: {
        user_id: 'usr_9981'
        // signup_method is missing
      }
    };

    const result = validateEvent(payload, specRules);
    assert.equal(result.status, 'MISSING');
    assert.equal(result.metrics.missing, 1);
    const missingAttr = result.attributes.find(a => a.name === 'signup_method');
    assert.ok(missingAttr);
    assert.equal(missingAttr.status, 'MISSING');
  });

  test('4. Validation Engine: detects EXTRA unexpected parameters', () => {
    const specRules = [
      {
        eventName: 'screen_view',
        parameters: [
          { name: 'screen_name', type: 'string', required: true }
        ]
      }
    ];

    const payload = {
      event: 'screen_view',
      properties: {
        screen_name: 'HomeScreen',
        secret_tracking_token: 'xyz_777'
      }
    };

    const result = validateEvent(payload, specRules);
    assert.equal(result.status, 'EXTRA');
    assert.equal(result.metrics.extra, 1);
    const extraAttr = result.attributes.find(a => a.name === 'secret_tracking_token');
    assert.ok(extraAttr);
    assert.equal(extraAttr.status, 'EXTRA');
  });

  test('5. Validation Engine: detects INCORRECT types and invalid enum values', () => {
    const specRules = [
      {
        eventName: 'level_completed',
        parameters: [
          { name: 'level_number', type: 'number', required: true },
          { name: 'difficulty', type: 'string', expectedValue: 'easy,medium,hard', required: true }
        ]
      }
    ];

    // Payload with string instead of number, and invalid enum value
    const payload = {
      event: 'level_completed',
      properties: {
        level_number: 'level_5', // String instead of number
        difficulty: 'extreme' // Not in easy,medium,hard
      }
    };

    const result = validateEvent(payload, specRules);
    assert.equal(result.status, 'INCORRECT');
    assert.equal(result.metrics.incorrect, 2);
  });

  test('6. Validation Engine: returns UNMAPPED when event is not present in specification', () => {
    const specRules = [
      {
        eventName: 'known_event',
        parameters: []
      }
    ];

    const payload = {
      event: 'completely_unknown_event',
      properties: { foo: 'bar' }
    };

    const result = validateEvent(payload, specRules);
    assert.equal(result.status, 'UNMAPPED');
  });

  // -------------------------------------------------------------
  // Test 7: Multi-User Isolation on Specifications & Sessions
  // -------------------------------------------------------------
  test('7. Multi-User Isolation: User B cannot start session on device owned by User A', async () => {
    const deviceSerial = 'DEV_SERIAL_ALICE_ONLY';
    deviceLockService.setOwner(deviceSerial, userAlice);

    // Alice should be able to start session
    const session = await mixpanelCollectorService.startSession({
      user: userAlice,
      deviceSerial,
      deviceName: 'Alice Google Pixel 7'
    });
    assert.ok(session.id);
    assert.equal(session.user_id, userAlice.id);

    // Bob attempting to start capture on Alice's device must be rejected with 403
    await assert.rejects(
      async () => {
        await mixpanelCollectorService.startSession({
          user: userBob,
          deviceSerial,
          deviceName: 'Bob Trying Alice Device'
        });
      },
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.match(err.message, /owned by another user/i);
        return true;
      }
    );

    // Cleanup
    await mixpanelCollectorService.stopSession(session.id, userAlice);
    deviceLockService.clearOwner(deviceSerial);
  });

  test('8. Multi-User Isolation: User B cannot stop or inject events into User A session', async () => {
    const deviceSerial = 'DEV_SERIAL_UNOWNED_SHARED';
    deviceLockService.clearOwner(deviceSerial);

    const session = await mixpanelCollectorService.startSession({
      user: userAlice,
      deviceSerial,
      deviceName: 'Shared Tablet'
    });

    // Bob trying to inject event into Alice's session must fail
    await assert.rejects(
      async () => {
        await mixpanelCollectorService.injectEvent(session.id, userBob, {
          event: 'test_leak',
          properties: {}
        });
      },
      (err) => {
        assert.equal(err.statusCode, 403);
        return true;
      }
    );

    // Bob trying to stop Alice's session must fail
    await assert.rejects(
      async () => {
        await mixpanelCollectorService.stopSession(session.id, userBob);
      },
      (err) => {
        assert.equal(err.statusCode, 403);
        return true;
      }
    );

    // Alice can stop her own session
    const stopped = await mixpanelCollectorService.stopSession(session.id, userAlice);
    assert.equal(stopped.status, 'STOPPED');
  });

  // -------------------------------------------------------------
  // Test 9: Deduplication & Ingestion into Database
  // -------------------------------------------------------------
  test('9. Ingestion & Deduplication: duplicate $insert_id events are suppressed', async () => {
    const deviceSerial = 'DEV_SERIAL_DEDUP_TEST';
    deviceLockService.clearOwner(deviceSerial);

    const session = await mixpanelCollectorService.startSession({
      user: userAlice,
      deviceSerial,
      deviceName: 'Dedup Phone'
    });

    const eventPayload = {
      event: 'banner_impression',
      properties: {
        $insert_id: 'unique_uuid_insert_9912',
        time: Date.now(),
        banner_id: 'sale_2026'
      }
    };

    // First injection
    const res1 = await mixpanelCollectorService.injectEvent(session.id, userAlice, eventPayload);
    assert.equal(res1.session.events_count, 1);

    // Second injection with identical $insert_id
    const res2 = await mixpanelCollectorService.injectEvent(session.id, userAlice, eventPayload);
    assert.equal(res2.session.events_count, 1, 'Duplicate event must be deduplicated and not increment count');

    await mixpanelCollectorService.stopSession(session.id, userAlice);
  });

  // -------------------------------------------------------------
  // Test 10: Graceful Fallback / Status Configuration Check
  // -------------------------------------------------------------
  test('10. Status & Degradation: collector reports non-crashing status when credentials unconfigured', () => {
    const status = mixpanelCollectorService.isConfigured();
    assert.equal(typeof status.enabled, 'boolean');
    assert.equal(typeof status.configured, 'boolean');
    assert.equal(typeof status.region, 'string');
  });

  // -------------------------------------------------------------
  // Test 11: Exclusive Capture Locking — Same User Concurrent Conflict
  // -------------------------------------------------------------
  test('11. Exclusive Capture Locking: same user concurrent request on same device rejects with 409', async () => {
    const deviceSerial = 'DEV_SERIAL_CONCURRENT_SAME_USER';
    deviceLockService.clearOwner(deviceSerial);

    const session1 = await mixpanelCollectorService.startSession({
      user: userAlice,
      deviceSerial,
      deviceName: 'Pixel 7 Pro'
    });
    assert.ok(session1.id);
    assert.equal(mixpanelCollectorService.captureLocks.has(deviceSerial), true);

    // Concurrent request by same user on the same serial must fail with 409
    await assert.rejects(
      async () => {
        await mixpanelCollectorService.startSession({
          user: userAlice,
          deviceSerial,
          deviceName: 'Pixel 7 Pro Attempt 2'
        });
      },
      (err) => {
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, 'CAPTURE_DEVICE_CONFLICT');
        assert.match(err.message, /already have an active capture session/i);
        return true;
      }
    );

    await mixpanelCollectorService.stopSession(session1.id, userAlice);
    assert.equal(mixpanelCollectorService.captureLocks.has(deviceSerial), false);
  });

  // -------------------------------------------------------------
  // Test 12: Exclusive Capture Locking — Different Users on Unowned Device
  // -------------------------------------------------------------
  test('12. Exclusive Capture Locking: different users on unowned device reject second request with 409', async () => {
    const deviceSerial = 'DEV_SERIAL_UNOWNED_LOCKING';
    deviceLockService.clearOwner(deviceSerial);

    // User Alice starts capture on unowned device
    const sessionAlice = await mixpanelCollectorService.startSession({
      user: userAlice,
      deviceSerial,
      deviceName: 'Unowned Tablet'
    });
    assert.ok(sessionAlice.id);

    // User Bob tries to start capture on same unowned device -> rejected with 409
    await assert.rejects(
      async () => {
        await mixpanelCollectorService.startSession({
          user: userBob,
          deviceSerial,
          deviceName: 'Unowned Tablet (Bob)'
        });
      },
      (err) => {
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, 'CAPTURE_DEVICE_CONFLICT');
        assert.match(err.message, /has an active capture session/i);
        return true;
      }
    );

    // Cleanup: Alice stops session, releasing lock
    await mixpanelCollectorService.stopSession(sessionAlice.id, userAlice);
    assert.equal(mixpanelCollectorService.captureLocks.has(deviceSerial), false);

    // Now Bob can start capture session successfully
    const sessionBob = await mixpanelCollectorService.startSession({
      user: userBob,
      deviceSerial,
      deviceName: 'Unowned Tablet (Bob Now)'
    });
    assert.ok(sessionBob.id);
    await mixpanelCollectorService.stopSession(sessionBob.id, userBob);
  });

  // -------------------------------------------------------------
  // Test 13: Exclusive Capture Locking — Startup Failure Releases In-Flight Lock
  // -------------------------------------------------------------
  test('13. Exclusive Capture Locking: failed session startup cleanly releases starting lock', async () => {
    const deviceSerial = 'DEV_SERIAL_FAIL_CLEANUP';
    deviceLockService.clearOwner(deviceSerial);

    // Pass invalid spec ID to trigger error during startup
    await assert.rejects(
      async () => {
        await mixpanelCollectorService.startSession({
          user: userAlice,
          deviceSerial,
          deviceName: 'Fail Phone',
          specId: '00000000-0000-0000-0000-000000000000' // Non-existent spec
        });
      },
      (err) => {
        assert.equal(err.statusCode, 404);
        return true;
      }
    );

    // Lock must not remain stuck
    assert.equal(mixpanelCollectorService._startingLocks.has(deviceSerial), false);
    assert.equal(mixpanelCollectorService.captureLocks.has(deviceSerial), false);

    // Subsequent valid request succeeds immediately
    const validSession = await mixpanelCollectorService.startSession({
      user: userAlice,
      deviceSerial,
      deviceName: 'Fail Phone Recovered'
    });
    assert.ok(validSession.id);
    await mixpanelCollectorService.stopSession(validSession.id, userAlice);
  });

  // -------------------------------------------------------------
  // Test 14: Exclusive Capture Locking — Disconnect Releases Capture Lock
  // -------------------------------------------------------------
  test('14. Exclusive Capture Locking: device disconnect stops capture and releases lock', async () => {
    const deviceSerial = 'DEV_SERIAL_DISCONNECT_TEST';
    deviceLockService.clearOwner(deviceSerial);

    const session = await mixpanelCollectorService.startSession({
      user: userAlice,
      deviceSerial,
      deviceName: 'Disconnect Phone'
    });
    assert.ok(session.id);
    assert.equal(mixpanelCollectorService.captureLocks.has(deviceSerial), true);

    // Trigger device disconnect via deviceLockService.clearOwner
    deviceLockService.clearOwner(deviceSerial);
    await new Promise(r => setTimeout(r, 60));

    // Capture lock should now be released
    assert.equal(mixpanelCollectorService.captureLocks.has(deviceSerial), false);

    // Session in DB should now be STOPPED
    const checkDb = await db.query('SELECT status, error_message FROM mixpanel_sessions WHERE id = $1', [session.id]);
    assert.equal(checkDb.rows[0].status, 'STOPPED');
    assert.match(checkDb.rows[0].error_message, /Device disconnected/i);
  });

  // -------------------------------------------------------------
  // Test 15: Event Source Provenance — Synthetic vs Device Stream vs Legacy
  // -------------------------------------------------------------
  test('15. Event Source Provenance: synthetic injection and ADB stream receive explicit provenance tags', async () => {
    const deviceSerial = 'DEV_SERIAL_PROVENANCE_TEST';
    deviceLockService.clearOwner(deviceSerial);

    const session = await mixpanelCollectorService.startSession({
      user: userAlice,
      deviceSerial,
      deviceName: 'Provenance Phone'
    });

    // 1. Synthetic event injection
    const synthRes = await mixpanelCollectorService.injectEvent(session.id, userAlice, {
      event: 'test_synthetic_click',
      properties: { button: 'submit', time: Date.now() }
    });
    assert.ok(synthRes.event);
    assert.equal(synthRes.event.source, 'SYNTHETIC_INJECTION');

    // 2. Real device ADB stream event
    await mixpanelCollectorService._processAndStoreEvent(
      session,
      { event: 'real_adb_click', properties: { button: 'home', time: Date.now() } },
      [],
      'ADB_STREAM'
    );

    // 3. Mixpanel export API event
    await mixpanelCollectorService._processAndStoreEvent(
      session,
      { event: 'export_api_event', properties: { distinct_id: 'u1', time: Date.now() } },
      [],
      'MIXPANEL_EXPORT'
    );

    // Verify all 3 stored events with their explicit provenance
    const allEvents = await db.query(
      'SELECT event_name, source FROM mixpanel_events WHERE session_id = $1 ORDER BY created_at ASC',
      [session.id]
    );
    assert.equal(allEvents.rows.length, 3);
    assert.equal(allEvents.rows[0].event_name, 'test_synthetic_click');
    assert.equal(allEvents.rows[0].source, 'SYNTHETIC_INJECTION');

    assert.equal(allEvents.rows[1].event_name, 'real_adb_click');
    assert.equal(allEvents.rows[1].source, 'ADB_STREAM');

    assert.equal(allEvents.rows[2].event_name, 'export_api_event');
    assert.equal(allEvents.rows[2].source, 'MIXPANEL_EXPORT');

    await mixpanelCollectorService.stopSession(session.id, userAlice);
  });

  // -------------------------------------------------------------
  // Test 16: Event Source Provenance — Migration and Legacy Default
  // -------------------------------------------------------------
  test('16. Event Source Provenance: legacy records default to LEGACY_UNSPECIFIED', async () => {
    const deviceSerial = 'DEV_SERIAL_LEGACY_TEST';
    deviceLockService.clearOwner(deviceSerial);

    const session = await mixpanelCollectorService.startSession({
      user: userAlice,
      deviceSerial,
      deviceName: 'Legacy Phone'
    });

    // Insert directly without specifying source to simulate historical record
    await db.query(
      `INSERT INTO mixpanel_events (
        session_id, user_id, event_name, distinct_id, insert_id,
        event_time, raw_payload, is_correlated, validation_status, validation_summary
      ) VALUES ($1, $2, $3, $4, $5, NOW(), $6, true, 'MATCHED', '{}')`,
      [session.id, userAlice.id, 'historical_event', 'hist_1', 'hist_ins_1', '{}']
    );

    const rec = await db.query('SELECT source FROM mixpanel_events WHERE insert_id = $1', ['hist_ins_1']);
    assert.equal(rec.rows[0].source, 'LEGACY_UNSPECIFIED');

    await mixpanelCollectorService.stopSession(session.id, userAlice);
  });

  // -------------------------------------------------------------
  // Test 17: Controller API — Filtering by Provenance Source
  // -------------------------------------------------------------
  test('17. Controller API: getSessionEvents supports source query parameter filtering', async () => {
    const mixpanelController = require('../src/controllers/mixpanelController');
    const deviceSerial = 'DEV_SERIAL_CONTROLLER_TEST';
    deviceLockService.clearOwner(deviceSerial);

    const session = await mixpanelCollectorService.startSession({
      user: userAlice,
      deviceSerial,
      deviceName: 'Controller Test Phone'
    });

    // Inject 1 synthetic and 1 stream event
    await mixpanelCollectorService.injectEvent(session.id, userAlice, {
      event: 'synth_evt',
      properties: { $insert_id: 'c_synth_1', time: Date.now() }
    });
    await mixpanelCollectorService._processAndStoreEvent(
      session,
      { event: 'stream_evt', properties: { $insert_id: 'c_stream_1', time: Date.now() } },
      [],
      'ADB_STREAM'
    );

    // Query with source = SYNTHETIC_INJECTION
    let responseDataSynth;
    const reqSynth = {
      user: userAlice,
      params: { id: session.id },
      query: { source: 'SYNTHETIC_INJECTION' }
    };
    const resSynth = {
      json: (d) => { responseDataSynth = d; return resSynth; },
      status: (c) => { resSynth.statusCode = c; return resSynth; }
    };
    await mixpanelController.getSessionEvents(reqSynth, resSynth, (err) => { if (err) throw err; });

    assert.ok(responseDataSynth.success);
    assert.equal(responseDataSynth.data.events.length, 1);
    assert.equal(responseDataSynth.data.events[0].event_name, 'synth_evt');
    assert.equal(responseDataSynth.data.events[0].source, 'SYNTHETIC_INJECTION');

    // Query with source = ADB_STREAM
    let responseDataStream;
    const reqStream = {
      user: userAlice,
      params: { id: session.id },
      query: { source: 'ADB_STREAM' }
    };
    const resStream = {
      json: (d) => { responseDataStream = d; return resStream; },
      status: (c) => { resStream.statusCode = c; return resStream; }
    };
    await mixpanelController.getSessionEvents(reqStream, resStream, (err) => { if (err) throw err; });

    assert.ok(responseDataStream.success);
    assert.equal(responseDataStream.data.events.length, 1);
    assert.equal(responseDataStream.data.events[0].event_name, 'stream_evt');
    assert.equal(responseDataStream.data.events[0].source, 'ADB_STREAM');

    await mixpanelCollectorService.stopSession(session.id, userAlice);
  });

  // -------------------------------------------------------------
  // Test 18: Controller API: clearSessionEvents deletes recorded events & enforces isolation
  // -------------------------------------------------------------
  test('18. Controller API: clearSessionEvents deletes recorded events and enforces multi-user isolation', async () => {
    const deviceSerial = 'DEV_SERIAL_CLEAR_EVENTS_TEST';
    deviceLockService.clearOwner(deviceSerial);

    const session = await mixpanelCollectorService.startSession({
      user: userAlice,
      deviceSerial,
      deviceName: 'Clear Test Device'
    });

    // Inject 2 events
    await mixpanelCollectorService.injectEvent(session.id, userAlice, {
      event: 'event_to_clear_1',
      properties: { key: 'val1' }
    });
    await mixpanelCollectorService.injectEvent(session.id, userAlice, {
      event: 'event_to_clear_2',
      properties: { key: 'val2' }
    });

    // Verify User B cannot clear Alice's session events (Multi-User Isolation)
    let userBStatus = null;
    let userBData = null;
    const reqB = {
      user: userBob,
      params: { id: session.id }
    };
    const resB = {
      status: (c) => { userBStatus = c; return resB; },
      json: (d) => { userBData = d; return resB; }
    };
    await mixpanelController.clearSessionEvents(reqB, resB, (err) => { if (err) throw err; });
    assert.equal(userBStatus, 403);
    assert.equal(userBData.success, false);

    // Alice clears her session events
    let userAData = null;
    const reqA = {
      user: userAlice,
      params: { id: session.id }
    };
    const resA = {
      status: (c) => { return resA; },
      json: (d) => { userAData = d; return resA; }
    };
    await mixpanelController.clearSessionEvents(reqA, resA, (err) => { if (err) throw err; });
    assert.ok(userAData.success);
    assert.equal(userAData.data.deletedCount, 2);

    // Verify events list is now empty for session
    const dbEvents = await db.query('SELECT * FROM mixpanel_events WHERE session_id = $1', [session.id]);
    assert.equal(dbEvents.rows.length, 0);

    // Verify session events_count reset to 0
    const dbSession = await db.query('SELECT events_count FROM mixpanel_sessions WHERE id = $1', [session.id]);
    assert.equal(dbSession.rows[0].events_count, 0);

    await mixpanelCollectorService.stopSession(session.id, userAlice);
  });
});



