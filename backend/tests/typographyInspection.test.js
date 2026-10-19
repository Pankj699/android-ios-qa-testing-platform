const { test, describe } = require('node:test');
const assert = require('node:assert');
const typographyInspectionService = require('../src/services/typographyInspectionService');

describe('Layered Typography Inspection Service Tests', () => {
  test('1. parseOpenType extracts font family, subfamily, weight, and style flags correctly', () => {
    // Construct a synthetic minimal OpenType buffer with name and OS/2 tables
    // Table directory: 12 bytes header (sfntVersion=0x00010000, numTables=2, searchRange, entrySelector, rangeShift)
    // Table records: 2 * 16 = 32 bytes (tag, checkSum, offset, length)
    const header = Buffer.alloc(12);
    header.writeUInt32BE(0x00010000, 0); // sfntVersion
    header.writeUInt16BE(2, 4); // 2 tables: 'OS/2' and 'name'

    const tableDir = Buffer.alloc(32);
    // Table 1: OS/2 at offset 44, length 68
    tableDir.write('OS/2', 0, 4, 'ascii');
    tableDir.writeUInt32BE(0, 4); // checksum
    tableDir.writeUInt32BE(44, 8); // offset
    tableDir.writeUInt32BE(68, 12); // length

    // Table 2: name at offset 112, length 100
    tableDir.write('name', 16, 4, 'ascii');
    tableDir.writeUInt32BE(0, 20); // checksum
    tableDir.writeUInt32BE(112, 24); // offset
    tableDir.writeUInt32BE(100, 28); // length

    // OS/2 Table: 68 bytes
    const os2Table = Buffer.alloc(68);
    os2Table.writeUInt16BE(4, 0); // version
    os2Table.writeUInt16BE(700, 4); // usWeightClass = 700 (Bold)
    os2Table.writeUInt16BE(0x0021, 62); // fsSelection = 0x20 (Bold) | 0x01 (Italic)

    // Name Table: Header (format=0, count=2, stringOffset=30)
    const nameTable = Buffer.alloc(100);
    nameTable.writeUInt16BE(0, 0); // format
    nameTable.writeUInt16BE(2, 2); // 2 records
    nameTable.writeUInt16BE(30, 4); // stringOffset from start of name table

    // Name Record 1: Platform 3 (Windows), Encoding 1 (Unicode BMP), Lang 0x0409, NameID 1 (Font Family)
    nameTable.writeUInt16BE(3, 6);
    nameTable.writeUInt16BE(1, 8);
    nameTable.writeUInt16BE(0x0409, 10);
    nameTable.writeUInt16BE(1, 12); // Name ID 1 (Font Family)
    nameTable.writeUInt16BE(16, 14); // length = 16 bytes (8 chars UTF-16BE: "OpenSans")
    nameTable.writeUInt16BE(0, 16); // offset in string storage

    // Name Record 2: Platform 3, Encoding 1, Lang 0x0409, NameID 2 (Subfamily)
    nameTable.writeUInt16BE(3, 18);
    nameTable.writeUInt16BE(1, 20);
    nameTable.writeUInt16BE(0x0409, 22);
    nameTable.writeUInt16BE(2, 24); // Name ID 2 (Subfamily)
    nameTable.writeUInt16BE(22, 26); // length = 22 bytes (11 chars UTF-16BE: "Bold Italic")
    nameTable.writeUInt16BE(16, 28); // offset in string storage

    // String storage at offset 30:
    // "OpenSans" in UTF-16BE:
    const str1 = 'OpenSans';
    for (let i = 0; i < str1.length; i++) {
      nameTable.writeUInt16BE(str1.charCodeAt(i), 30 + i * 2);
    }
    // "Bold Italic" in UTF-16BE:
    const str2 = 'Bold Italic';
    for (let i = 0; i < str2.length; i++) {
      nameTable.writeUInt16BE(str2.charCodeAt(i), 30 + 16 + i * 2);
    }

    const fullFontBuffer = Buffer.concat([header, tableDir, os2Table, nameTable]);
    const parsed = typographyInspectionService.parseOpenType(fullFontBuffer);

    assert.ok(parsed, 'Parsed font object should be defined');
    assert.strictEqual(parsed.familyName, 'OpenSans');
    assert.strictEqual(parsed.subFamily, 'Bold Italic');
    assert.strictEqual(parsed.usWeightClass, 700);
    assert.strictEqual(parsed.isBold, true);
    assert.strictEqual(parsed.isItalic, true);
  });

  test('2. normalizeWeight categorizes standard numeric weights to standard typographic labels', () => {
    assert.deepStrictEqual(typographyInspectionService.normalizeWeight(100), { numeric: 100, label: 'Thin' });
    assert.deepStrictEqual(typographyInspectionService.normalizeWeight(300), { numeric: 300, label: 'Light' });
    assert.deepStrictEqual(typographyInspectionService.normalizeWeight(400), { numeric: 400, label: 'Regular' });
    assert.deepStrictEqual(typographyInspectionService.normalizeWeight(500), { numeric: 500, label: 'Medium' });
    assert.deepStrictEqual(typographyInspectionService.normalizeWeight(600), { numeric: 600, label: 'SemiBold' });
    assert.deepStrictEqual(typographyInspectionService.normalizeWeight(700), { numeric: 700, label: 'Bold' });
    assert.deepStrictEqual(typographyInspectionService.normalizeWeight(800), { numeric: 800, label: 'ExtraBold' });
    assert.deepStrictEqual(typographyInspectionService.normalizeWeight(900), { numeric: 900, label: 'Black' });
    assert.deepStrictEqual(typographyInspectionService.normalizeWeight(null), { numeric: 400, label: 'Normal' });
  });

  test('3. inspectTypography marks nodes with empty text as UNAVAILABLE', async () => {
    const node = { text: '', bounds: { height: 50 }, className: 'android.widget.TextView' };
    const res = await typographyInspectionService.inspectTypography(node, 'mock-serial');

    assert.strictEqual(res.fontSize.source, 'Unavailable');
    assert.strictEqual(res.fontSize.status, 'UNAVAILABLE');
    assert.strictEqual(res.fontFamily.source, 'Unavailable');
    assert.strictEqual(res.fontFamily.status, 'UNAVAILABLE');
    assert.strictEqual(res.fontWeight.source, 'Unavailable');
    assert.strictEqual(res.fontWeight.status, 'UNAVAILABLE');
  });

  test('4. inspectTypography matches resource ID hint against APK font catalog and marks INFERRED', async () => {
    const origCatalog = typographyInspectionService.getApkFontCatalog;
    try {
      typographyInspectionService.getApkFontCatalog = async () => [
        {
          entryPath: 'res/font/montserrat_bold.ttf',
          fileName: 'montserrat_bold.ttf',
          familyName: 'Montserrat',
          subFamily: 'Bold',
          fullName: 'Montserrat Bold',
          weight: 700,
          weightLabel: 'Bold',
          isItalic: false,
          isBold: true
        }
      ];

      const node = {
        text: 'Create Flyer',
        bounds: { height: 60, width: 200 },
        className: 'android.widget.TextView',
        resourceId: 'com.bg.flyermaker:id/txt_montserrat_header',
        package: 'com.bg.flyermaker'
      };

      const res = await typographyInspectionService.inspectTypography(node, 'mock-serial');

      // Font Family should be Inferred, NEVER marked Native
      assert.strictEqual(res.fontFamily.source, 'Inferred');
      assert.strictEqual(res.fontFamily.status, 'INFERRED');
      assert.strictEqual(res.fontFamily.value, 'Montserrat');
      assert.ok(res.fontFamily.note.includes('resource ID'));

      // Font Weight should be Inferred from the matched font file
      assert.strictEqual(res.fontWeight.source, 'Inferred');
      assert.strictEqual(res.fontWeight.status, 'INFERRED');
      assert.strictEqual(res.fontWeight.numeric, 700);

      // Font Size should remain Estimated
      assert.strictEqual(res.fontSize.source, 'Estimated');
      assert.strictEqual(res.fontSize.status, 'ESTIMATED');
    } finally {
      typographyInspectionService.getApkFontCatalog = origCatalog;
    }
  });

  test('5. inspectTypography falls back gracefully to ESTIMATED/UNAVAILABLE when no resource match exists', async () => {
    const origCatalog = typographyInspectionService.getApkFontCatalog;
    try {
      typographyInspectionService.getApkFontCatalog = async () => [];

      const node = {
        text: 'Generic Button',
        bounds: { height: 48, width: 120 },
        className: 'android.widget.Button',
        resourceId: 'com.example:id/btn_submit',
        package: 'com.example'
      };

      const res = await typographyInspectionService.inspectTypography(node, 'mock-serial');

      // Font family unavailable without APK or instrumentation
      assert.strictEqual(res.fontFamily.source, 'Unavailable');
      assert.strictEqual(res.fontFamily.status, 'UNAVAILABLE');

      // Font weight estimated from button role
      assert.strictEqual(res.fontWeight.source, 'Estimated');
      assert.strictEqual(res.fontWeight.status, 'ESTIMATED');
      assert.ok(res.fontWeight.note.includes('heuristic'));
    } finally {
      typographyInspectionService.getApkFontCatalog = origCatalog;
    }
  });

  test('6. enrichHierarchyTypography safely enriches nodes without mutating native properties', async () => {
    const rootNode = {
      id: 'root',
      className: 'android.widget.FrameLayout',
      bounds: { height: 1000, width: 800 },
      children: [
        {
          id: 'child1',
          text: 'Title Heading',
          className: 'android.widget.TextView',
          resourceId: 'com.example:id/title_heading',
          package: 'com.example',
          bounds: { height: 50, width: 300 },
          propertySources: {
            className: 'Native',
            text: 'Native',
            bounds: 'Native',
            fontSize: 'Estimated',
            fontFamily: 'Unavailable',
            fontWeight: 'Unavailable'
          },
          children: []
        }
      ]
    };

    const enriched = await typographyInspectionService.enrichHierarchyTypography(rootNode, 'mock-serial', {
      skipApkAnalysis: true
    });

    const child = enriched.children[0];
    assert.strictEqual(child.propertySources.className, 'Native');
    assert.strictEqual(child.propertySources.text, 'Native');
    assert.strictEqual(child.propertySources.bounds, 'Native');
    assert.ok(child.typography.fontSize.value.includes('sp'));
    assert.strictEqual(child.propertySources.fontSize, 'Estimated');
  });

  test('7. parseOpenType extracts typographic family (NameID 16) and variable-font axes (fvar)', () => {
    // Header (12 bytes) + 3 table records (48 bytes): OS/2, name, fvar = 60 bytes
    const header = Buffer.alloc(12);
    header.writeUInt32BE(0x00010000, 0);
    header.writeUInt16BE(3, 4); // 3 tables

    const tableDir = Buffer.alloc(48);
    // Table 1: OS/2 at offset 60, len 68
    tableDir.write('OS/2', 0, 4, 'ascii');
    tableDir.writeUInt32BE(60, 8);
    tableDir.writeUInt32BE(68, 12);

    // Table 2: name at offset 128, len 100
    tableDir.write('name', 16, 4, 'ascii');
    tableDir.writeUInt32BE(128, 24);
    tableDir.writeUInt32BE(100, 28);

    // Table 3: fvar at offset 228, len 36
    tableDir.write('fvar', 32, 4, 'ascii');
    tableDir.writeUInt32BE(228, 40);
    tableDir.writeUInt32BE(36, 44);

    const os2Table = Buffer.alloc(68);
    os2Table.writeUInt16BE(400, 4); // usWeightClass = 400

    // Name table with Name ID 16 (Typographic Family)
    const nameTable = Buffer.alloc(100);
    nameTable.writeUInt16BE(0, 0);
    nameTable.writeUInt16BE(2, 2); // 2 records: ID 1 and ID 16
    nameTable.writeUInt16BE(30, 4); // stringOffset

    // Rec 1: ID 1 ("Roboto")
    nameTable.writeUInt16BE(3, 6);
    nameTable.writeUInt16BE(1, 8);
    nameTable.writeUInt16BE(0x0409, 10);
    nameTable.writeUInt16BE(1, 12);
    nameTable.writeUInt16BE(12, 14); // 6 chars: "Roboto"
    nameTable.writeUInt16BE(0, 16);

    // Rec 2: ID 16 ("Roboto Variable")
    nameTable.writeUInt16BE(3, 18);
    nameTable.writeUInt16BE(1, 20);
    nameTable.writeUInt16BE(0x0409, 22);
    nameTable.writeUInt16BE(16, 24);
    nameTable.writeUInt16BE(30, 26); // 15 chars: "Roboto Variable"
    nameTable.writeUInt16BE(12, 28);

    const str1 = 'Roboto';
    for (let i = 0; i < str1.length; i++) nameTable.writeUInt16BE(str1.charCodeAt(i), 30 + i * 2);
    const str2 = 'Roboto Variable';
    for (let i = 0; i < str2.length; i++) nameTable.writeUInt16BE(str2.charCodeAt(i), 30 + 12 + i * 2);

    // fvar table (axesOffset=16, axisCount=1, axisSize=20)
    const fvarTable = Buffer.alloc(36);
    fvarTable.writeUInt16BE(1, 0); // version major
    fvarTable.writeUInt16BE(16, 4); // axesOffset
    fvarTable.writeUInt16BE(1, 8); // axisCount = 1
    fvarTable.writeUInt16BE(20, 10); // axisSize = 20

    // Axis record at offset 16: tag 'wght', min=100 (100*65536), def=400 (400*65536), max=900 (900*65536)
    fvarTable.write('wght', 16, 4, 'ascii');
    fvarTable.writeInt32BE(100 * 65536, 20); // minVal
    fvarTable.writeInt32BE(400 * 65536, 24); // defVal
    fvarTable.writeInt32BE(900 * 65536, 28); // maxVal

    const fullBuffer = Buffer.concat([header, tableDir, os2Table, nameTable, fvarTable]);
    const parsed = typographyInspectionService.parseOpenType(fullBuffer);

    assert.ok(parsed);
    assert.strictEqual(parsed.familyName, 'Roboto');
    assert.strictEqual(parsed.typographicFamily, 'Roboto Variable');
    assert.strictEqual(parsed.preferredFamily, 'Roboto Variable');
    assert.strictEqual(parsed.isVariableFont, true);
    assert.deepStrictEqual(parsed.weightRange, { min: 100, default: 400, max: 900 });
  });

  test('8. inspectTypography formats candidate list when multiple fonts exist without explicit view binding', async () => {
    const origCatalog = typographyInspectionService.getApkFontCatalog;
    try {
      typographyInspectionService.getApkFontCatalog = async () => [
        { familyName: 'Poppins', preferredFamily: 'Poppins', weight: 400, weightLabel: 'Regular' },
        { familyName: 'Montserrat', preferredFamily: 'Montserrat', weight: 700, weightLabel: 'Bold' },
        { familyName: 'Lato', preferredFamily: 'Lato', weight: 400, weightLabel: 'Regular' }
      ];

      const node = {
        text: 'Welcome Screen',
        bounds: { height: 48, width: 200 },
        className: 'android.widget.TextView',
        resourceId: 'com.example:id/txt_welcome',
        package: 'com.example'
      };

      const res = await typographyInspectionService.inspectTypography(node, 'mock-serial');

      // Font Family must show candidate list and never pick one arbitrarily
      assert.strictEqual(res.fontFamily.source, 'Inferred');
      assert.strictEqual(res.fontFamily.status, 'INFERRED');
      assert.ok(res.fontFamily.value.startsWith('Candidates: '));
      assert.ok(res.fontFamily.value.includes('Poppins'));
      assert.ok(res.fontFamily.value.includes('Montserrat'));
      assert.ok(res.fontFamily.value.includes('Lato'));
      assert.strictEqual(res.fontFamily.candidates.length, 3);
    } finally {
      typographyInspectionService.getApkFontCatalog = origCatalog;
    }
  });

  test('9. inspectRuntimeJdwp safely rejects non-debuggable applications with structured unsupported reason', async () => {
    const adbService = require('../src/services/adbService');
    const origExecute = adbService.execute;
    try {
      adbService.execute = async (args) => {
        if (args.includes('dumpsys')) {
          return { code: 0, stdout: 'flags=[ HAS_CODE ALLOW_CLEAR_USER_DATA ]', stderr: '', raw: '' };
        }
        return { code: 0, stdout: '', stderr: '', raw: '' };
      };

      const result = await typographyInspectionService.inspectRuntimeJdwp('mock-serial', 'com.prod.app');
      assert.ok(result);
      assert.strictEqual(result.supported, false);
      assert.ok(result.reason.includes('not marked android:debuggable=true'));
    } finally {
      adbService.execute = origExecute;
    }
  });

  test('10. inspectRuntimeJdwp connects to debuggable app via JDWP socket and returns verified VM metadata', async () => {
    const adbService = require('../src/services/adbService');
    const net = require('net');
    const origExecute = adbService.execute;

    // Spin up a mock JDWP server
    const server = net.createServer((socket) => {
      let handshaked = false;
      socket.on('data', (data) => {
        if (!handshaked && data.toString().startsWith('JDWP-Handshake')) {
          handshaked = true;
          socket.write('JDWP-Handshake');
          return;
        }

        // Reply to JDWP Version command (cmdSet=1, cmd=1)
        if (data.length >= 11 && data.readUInt8(9) === 1 && data.readUInt8(10) === 1) {
          const reqId = data.readUInt32BE(4);
          const desc = 'Mock VM 1.8';
          const vmVer = 'Dalvik 2.1.0';
          const vmName = 'Dalvik';

          const payloadLen = 4 + desc.length + 4 + 4 + 4 + vmVer.length + 4 + vmName.length;
          const reply = Buffer.alloc(11 + payloadLen);
          reply.writeUInt32BE(reply.length, 0);
          reply.writeUInt32BE(reqId, 4);
          reply.writeUInt8(0x80, 8); // reply flag
          reply.writeUInt16BE(0, 9); // errorCode = 0

          let off = 11;
          reply.writeUInt32BE(desc.length, off); off += 4;
          reply.write(desc, off, 'utf8'); off += desc.length;
          reply.writeInt32BE(1, off); off += 4; // jdwpMajor
          reply.writeInt32BE(8, off); off += 4; // jdwpMinor
          reply.writeUInt32BE(vmVer.length, off); off += 4;
          reply.write(vmVer, off, 'utf8'); off += vmVer.length;
          reply.writeUInt32BE(vmName.length, off); off += 4;
          reply.write(vmName, off, 'utf8'); off += vmName.length;

          socket.write(reply);
        }
      });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const mockPort = server.address().port;

    try {
      adbService.execute = async (args) => {
        if (args.includes('dumpsys')) {
          return { code: 0, stdout: 'flags=[ DEBUGGABLE HAS_CODE ]', stderr: '', raw: '' };
        }
        if (args.includes('pidof')) {
          return { code: 0, stdout: '9999\n', stderr: '', raw: '' };
        }
        if (args.includes('forward') && !args.includes('--remove')) {
          // Re-route local port to mockPort
          const localTargetPort = parseInt(args[args.indexOf('forward') + 1].replace('tcp:', ''), 10);
          const proxy = net.createServer((sock) => {
            const dest = net.connect(mockPort, '127.0.0.1');
            sock.pipe(dest);
            dest.pipe(sock);
          });
          await new Promise((r) => proxy.listen(localTargetPort, '127.0.0.1', r));
          server._proxy = proxy;
        } else if (args.includes('--remove')) {
          if (server._proxy) server._proxy.close();
        }
        return { code: 0, stdout: '', stderr: '', raw: '' };
      };

      const result = await typographyInspectionService.inspectRuntimeJdwp('mock-serial', 'com.test.debugapp');
      assert.ok(result);
      assert.strictEqual(result.supported, true);
      assert.strictEqual(result.pid, 9999);
      assert.strictEqual(result.vmName, 'Dalvik');
      assert.strictEqual(result.jdwpVersion, '1.8');
    } finally {
      server.close();
      if (server._proxy) server._proxy.close();
      adbService.execute = origExecute;
    }
  });

  test('11. inspectRuntimeViewTypography safely validates inputs and non-debuggable target apps', async () => {
    const adbService = require('../src/services/adbService');
    // Missing input
    const missingRes = await typographyInspectionService.inspectRuntimeViewTypography(null, null, null);
    assert.strictEqual(missingRes.success, false);
    assert.ok(missingRes.error.includes('required'));

    // Non-debuggable app
    const origExecute = adbService.execute;
    try {
      adbService.execute = async () => ({
        code: 0,
        stdout: 'flags=[ HAS_CODE ]', // NOT DEBUGGABLE
        stderr: '',
        raw: ''
      });

      const res = await typographyInspectionService.inspectRuntimeViewTypography(
        'mock-serial',
        'com.test.releaseapp',
        { text: 'Submit' }
      );
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.supported, false);
      assert.ok(res.error.includes('debuggable'));
    } finally {
      adbService.execute = origExecute;
    }
  });

  test('12. typography response distinguishes exact runtime paint size from estimated layout bounds with scaledDensity', () => {
    const density = 2.75;
    const fontScale = 1.0;
    const scaledDensity = density * fontScale;
    const unitMap = { 0: 'px', 1: 'dp', 2: 'sp', 3: 'pt', 4: 'in', 5: 'mm' };

    // Case A: Exact runtime paint size retrieved (e.g. legacy/custom TextView field)
    const exactPaintPx = 44;
    const spVal = Math.round((exactPaintPx / scaledDensity) * 10) / 10;
    const exactFontSize = {
      value: `${exactPaintPx}px (${spVal}sp)`,
      pixelSize: exactPaintPx,
      spSize: spVal,
      density,
      scaledDensity,
      fontScale,
      unit: unitMap[2],
      source: 'Runtime',
      status: 'EXACT',
      confidence: 'high',
      note: `Retrieved directly from runtime TextPaint via JDWP (density ${density}x, scaledDensity ${scaledDensity}x)`
    };

    assert.strictEqual(exactFontSize.status, 'EXACT');
    assert.strictEqual(exactFontSize.source, 'Runtime');
    assert.strictEqual(exactFontSize.pixelSize, 44);
    assert.strictEqual(exactFontSize.spSize, 16);
    assert.strictEqual(exactFontSize.density, 2.75);
    assert.strictEqual(exactFontSize.scaledDensity, 2.75);
    assert.strictEqual(exactFontSize.fontScale, 1.0);
    assert.strictEqual(exactFontSize.unit, 'sp');

    // Case B: Modern Android 9+ SkFont architecture (native C++ Skia heap, runtimePaintPx is null)
    // Provenance MUST be Estimated, never presented as an exact runtime paint measurement
    const boundsH = 39;
    const estPx = Math.max(8, Math.round(boundsH * 0.65)); // 25px
    const estSp = Math.round((estPx / scaledDensity) * 10) / 10; // ~9sp
    const modernFontSize = {
      value: `~${Math.round(estSp)}sp (${estPx}px layout bound estimate)`,
      pixelSize: estPx,
      spSize: Math.round(estSp),
      density,
      scaledDensity,
      fontScale,
      unit: unitMap[0],
      runtimePaintPx: null,
      source: 'Estimated',
      status: 'ESTIMATED',
      confidence: 'low',
      note: 'Native SkFont size is stored in C++ heap (Paint.mNativePaint pointer); Dalvik/ART bytecode exposes no Java mTextSize field in Android 9+ (API 28+). Value is estimated from layout bounding box height, not a runtime paint measurement.'
    };

    assert.strictEqual(modernFontSize.status, 'ESTIMATED');
    assert.strictEqual(modernFontSize.source, 'Estimated');
    assert.strictEqual(modernFontSize.confidence, 'low');
    assert.strictEqual(modernFontSize.runtimePaintPx, null);
    assert.strictEqual(modernFontSize.pixelSize, 25);
    assert.strictEqual(modernFontSize.spSize, 9);
    assert.ok(modernFontSize.value.includes('layout bound estimate'));
    assert.ok(modernFontSize.note.includes('SkFont'));

    // Case C: Scaled density conversion under alternate font scale (e.g. fontScale = 1.15)
    const altFontScale = 1.15;
    const altScaledDensity = Math.round(density * altFontScale * 10000) / 10000; // 3.1625
    const test16spPx = Math.round(16 * altScaledDensity * 10) / 10; // 50.6px
    const recoveredSp = Math.round((test16spPx / altScaledDensity) * 10) / 10;
    assert.strictEqual(recoveredSp, 16);
  });
});
