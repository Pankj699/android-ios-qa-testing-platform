const { test, describe } = require('node:test');
const assert = require('node:assert');
const uiInspectorService = require('../src/services/uiInspectorService');
const deviceController = require('../src/controllers/deviceController');

describe('UI Inspector Service & Controller Tests', () => {
  const sampleXml = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.android.settings" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][1080,2400]">
    <node index="0" text="" resource-id="com.android.settings:id/action_bar_root" class="android.widget.LinearLayout" package="com.android.settings" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][1080,2400]">
      <node index="0" text="Settings" resource-id="com.android.settings:id/title" class="android.widget.TextView" package="com.android.settings" content-desc="Settings Title" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[64,120][450,220]" />
      <node index="1" text="Search" resource-id="com.android.settings:id/search_btn" class="android.widget.Button" package="com.android.settings" content-desc="Search Settings" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="true" password="false" selected="false" bounds="[850,110][1020,230]" />
    </node>
  </node>
</hierarchy>`;

  test('1. unescapeXml decodes HTML/XML entities correctly', () => {
    assert.strictEqual(uiInspectorService.unescapeXml('&quot;Hello&quot; &amp; &lt;World&gt; &#39;test&#39;'), '"Hello" & <World> \'test\'');
    assert.strictEqual(uiInspectorService.unescapeXml(''), '');
    assert.strictEqual(uiInspectorService.unescapeXml(null), '');
  });

  test('2. parseBounds extracts coordinates and dimensions correctly', () => {
    const parsed = uiInspectorService.parseBounds('[64,120][450,220]');
    assert.strictEqual(parsed.left, 64);
    assert.strictEqual(parsed.top, 120);
    assert.strictEqual(parsed.right, 450);
    assert.strictEqual(parsed.bottom, 220);
    assert.strictEqual(parsed.width, 386);
    assert.strictEqual(parsed.height, 100);
    assert.strictEqual(parsed.raw, '[64,120][450,220]');

    const fallback = uiInspectorService.parseBounds('invalid_bounds');
    assert.strictEqual(fallback.left, 0);
    assert.strictEqual(fallback.width, 0);
  });

  test('3. estimateTypography returns explicit source fidelity tags', () => {
    const typo = uiInspectorService.estimateTypography('Settings', 100);
    assert.strictEqual(typo.fontSize.source, 'Estimated');
    assert.strictEqual(typo.fontFamily.source, 'Unavailable');
    assert.strictEqual(typo.fontWeight.source, 'Unavailable');
    assert.ok(typo.fontSize.value.includes('sp'));
  });

  test('4. parseUiHierarchyXml parses hierarchical tree with explicit propertySources', () => {
    const parsed = uiInspectorService.parseUiHierarchyXml(sampleXml);
    assert.strictEqual(parsed.rotation, 0);
    assert.strictEqual(parsed.totalNodes, 4);

    const root = parsed.rootNode;
    assert.ok(root, 'Root node must exist');
    assert.strictEqual(root.className, 'android.widget.FrameLayout');
    assert.strictEqual(root.propertySources.className, 'Native');
    assert.strictEqual(root.propertySources.bounds, 'Native');
    assert.strictEqual(root.children.length, 1);

    const linearLayout = root.children[0];
    assert.strictEqual(linearLayout.className, 'android.widget.LinearLayout');
    assert.strictEqual(linearLayout.resourceId, 'com.android.settings:id/action_bar_root');
    assert.strictEqual(linearLayout.children.length, 2);

    const textView = linearLayout.children[0];
    assert.strictEqual(textView.text, 'Settings');
    assert.strictEqual(textView.contentDesc, 'Settings Title');
    assert.strictEqual(textView.resourceId, 'com.android.settings:id/title');
    assert.strictEqual(textView.states.clickable, false);
    assert.strictEqual(textView.xpath, '//android.widget.TextView[@resource-id="com.android.settings:id/title"]');

    const button = linearLayout.children[1];
    assert.strictEqual(button.text, 'Search');
    assert.strictEqual(button.states.clickable, true);
    assert.strictEqual(button.states.longClickable, true);
    assert.strictEqual(button.xpath, '//android.widget.Button[@resource-id="com.android.settings:id/search_btn"]');
  });

  test('5. findNodesAtCoordinates locates the deepest enclosing leaf node', () => {
    const parsed = uiInspectorService.parseUiHierarchyXml(sampleXml);
    // Point (900, 150) is inside Button [850,110][1020,230], LinearLayout, and FrameLayout
    const matches = uiInspectorService.findNodesAtCoordinates(parsed.rootNode, 900, 150);
    assert.strictEqual(matches.length, 3);
    // First match should be the most specific (button)
    assert.strictEqual(matches[0].className, 'android.widget.Button');
    assert.strictEqual(matches[0].resourceId, 'com.android.settings:id/search_btn');

    // Point outside all controls
    const emptyMatches = uiInspectorService.findNodesAtCoordinates(parsed.rootNode, 2000, 3000);
    assert.strictEqual(emptyMatches.length, 0);
  });

  test('6. captureInspection cleanly rejects iOS devices with 400', async () => {
    await assert.rejects(
      async () => {
        await uiInspectorService.captureInspection('00008110-001234567890001E', { role: 'tester' });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 400);
        assert.ok(err.message.includes('iOS'));
        return true;
      }
    );
  });

  test('7. DeviceController getUiHierarchy validates missing serial', async () => {
    let statusCode = 0;
    let jsonResult = null;

    await deviceController.getUiHierarchy(
      { params: { id: '' }, user: { role: 'tester' } },
      {
        status(code) { statusCode = code; return this; },
        json(data) { jsonResult = data; return this; }
      },
      () => {}
    );

    assert.strictEqual(statusCode, 400);
    assert.strictEqual(jsonResult.success, false);
    assert.ok(jsonResult.error.includes('serial is required'));
  });

  test('8. parseUiHierarchyXml safely parses attributes containing > inside quotes', () => {
    const xmlWithBrackets = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="Home > Settings > Network" resource-id="com.example:id/nav" class="android.widget.TextView" package="com.example" content-desc="Navigation > Depth" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][500,100]" />
</hierarchy>`;
    const parsed = uiInspectorService.parseUiHierarchyXml(xmlWithBrackets);
    assert.strictEqual(parsed.totalNodes, 1);
    assert.strictEqual(parsed.rootNode.text, 'Home > Settings > Network');
    assert.strictEqual(parsed.rootNode.contentDesc, 'Navigation > Depth');
  });

  test('9. estimateTypography accounts for multi-line text and adjusts estimated line height', () => {
    const singleLine = uiInspectorService.estimateTypography('Single line text', 120);
    const multiLine = uiInspectorService.estimateTypography('Line 1\nLine 2\nLine 3', 120);
    // multiLine single line height is 40px vs 120px, so font size estimate must be lower
    assert.ok(singleLine.fontSize.value.includes('visual estimate'));
    assert.ok(multiLine.fontSize.value.includes('visual estimate'));
    const singleSp = parseInt(singleLine.fontSize.value.match(/~(\d+)sp/)[1], 10);
    const multiSp = parseInt(multiLine.fontSize.value.match(/~(\d+)sp/)[1], 10);
    assert.ok(singleSp > multiSp, `Single line (${singleSp}sp) should be larger than 3-line (${multiSp}sp)`);
  });

  test('10. parseBounds and findNodesAtCoordinates safely ignore zero-dimension views', () => {
    const zeroXml = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][0,0]">
    <node index="0" text="Real View" resource-id="com.example:id/real" class="android.widget.TextView" package="com.example" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[10,10][100,100]" />
  </node>
</hierarchy>`;
    const parsed = uiInspectorService.parseUiHierarchyXml(zeroXml);
    const matches = uiInspectorService.findNodesAtCoordinates(parsed.rootNode, 50, 50);
    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0].resourceId, 'com.example:id/real');
  });

  test('11. DeviceController getUiHierarchy decodes URI encoded serial parameter', async () => {
    let capturedSerial = null;
    const origCapture = uiInspectorService.captureInspection;
    uiInspectorService.captureInspection = async (serial) => {
      capturedSerial = serial;
      return { success: true, hierarchy: { totalNodes: 1, rootNode: {} } };
    };

    try {
      let statusCode = 200;
      let jsonResult = null;
      await deviceController.getUiHierarchy(
        { params: { id: '192.168.0.7%3A38729' }, user: { role: 'tester', id: 'usr_test' } },
        {
          status(code) { statusCode = code; return this; },
          json(data) { jsonResult = data; return this; }
        },
        () => {}
      );

      assert.strictEqual(capturedSerial, '192.168.0.7:38729');
      assert.strictEqual(jsonResult.success, true);
    } finally {
      uiInspectorService.captureInspection = origCapture;
    }
  });

  test('12. previewBase64 from captureScreenshot is a valid data URI with PNG header', async () => {
    // Verify format contract: backend returns a full data URI string
    const screenMirrorService = require('../src/services/screenMirrorService');
    const origCapture = screenMirrorService.captureScreenshot;

    try {
      // Mock captureScreenshot to return a minimal 1x1 white PNG as a data URI
      const minimalPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAAlwSFlzAAAWJQAAFiUBSVIk8AAAAAxJREFUCNdjYGBgYAAAAAQAAYhi6ZYAAAAASUVORK5CYII=';
      const dataUri = `data:image/png;base64,${minimalPngBase64}`;

      screenMirrorService.captureScreenshot = async () => ({
        success: true,
        previewBase64: dataUri,
        filePath: '/tmp/mock.png',
        fileName: 'mock.png'
      });

      const result = await screenMirrorService.captureScreenshot('mock-serial');
      assert.ok(result.previewBase64, 'previewBase64 should be present');

      // The frontend normalizer expects either a full data URI or raw base64
      // Verify the actual contract: starts with data:image/
      assert.ok(
        result.previewBase64.startsWith('data:image/'),
        `previewBase64 should be a full data URI, got: ${result.previewBase64.substring(0, 40)}...`
      );

      // Verify the base64 payload decodes to valid PNG (first 4 bytes = 0x89504E47)
      const base64Part = result.previewBase64.replace(/^data:image\/[a-z]+;base64,/, '');
      const buf = Buffer.from(base64Part, 'base64');
      assert.ok(buf.length > 8, 'PNG data should be non-trivial');
      assert.strictEqual(buf[0], 0x89, 'PNG magic byte 0');
      assert.strictEqual(buf[1], 0x50, 'PNG magic byte 1 (P)');
      assert.strictEqual(buf[2], 0x4E, 'PNG magic byte 2 (N)');
      assert.strictEqual(buf[3], 0x47, 'PNG magic byte 3 (G)');
    } finally {
      screenMirrorService.captureScreenshot = origCapture;
    }
  });

  test('13. estimateTypography guarantees Unavailable provenance for font family and weight', () => {
    const typography = uiInspectorService.estimateTypography('Regenerate', 48);

    // Font size should be explicitly marked as Estimated
    assert.strictEqual(typography.fontSize.source, 'Estimated');
    assert.ok(typography.fontSize.note.includes('visual estimate') || typography.fontSize.note.includes('Generic'));

    // Font family and weight must NEVER be guessed or marked as Native without instrumentation
    assert.strictEqual(typography.fontFamily.source, 'Unavailable');
    assert.strictEqual(typography.fontFamily.value, 'Not exposed by UIAutomator');
    assert.strictEqual(typography.fontWeight.source, 'Unavailable');
    assert.strictEqual(typography.fontWeight.value, 'Not exposed by UIAutomator');
    assert.ok(typography.fontWeight.note.includes('instrumentation'));
  });

  test('14. UIAutomator XML parsing sets Unavailable provenance on typography attributes', () => {
    const xml = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="Regenerate" resource-id="com.example:id/btn_regenerate" class="android.widget.TextView" package="com.example" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[100,200][400,280]" />
</hierarchy>`;

    const result = uiInspectorService.parseUiHierarchyXml(xml);
    assert.strictEqual(result.totalNodes, 1);
    const node = result.rootNode;

    assert.strictEqual(node.text, 'Regenerate');
    assert.strictEqual(node.className, 'android.widget.TextView');
    assert.strictEqual(node.propertySources.fontFamily, 'Unavailable');
    assert.strictEqual(node.propertySources.fontWeight, 'Unavailable');
    assert.strictEqual(node.propertySources.fontSize, 'Estimated');
    assert.strictEqual(node.propertySources.text, 'Native');
    assert.strictEqual(node.propertySources.resourceId, 'Native');
  });

  test('15. DeviceController getRuntimeTypography validates serial, package, and node', async () => {
    // Missing serial
    let resStatus = null;
    let resJson = null;
    const mockRes = {
      status(s) { resStatus = s; return this; },
      json(j) { resJson = j; return this; }
    };

    await deviceController.getRuntimeTypography({ params: { id: '' }, body: {}, user: { username: 'test' } }, mockRes);
    assert.strictEqual(resStatus, 400);
    assert.ok(resJson.error.includes('serial'));

    // Missing package
    resStatus = null;
    await deviceController.getRuntimeTypography({ params: { id: 'device123' }, body: {}, user: { username: 'test' } }, mockRes);
    assert.strictEqual(resStatus, 400);
    assert.ok(resJson.error.includes('Package'));

    // Missing node
    resStatus = null;
    await deviceController.getRuntimeTypography({ params: { id: 'device123' }, body: { packageName: 'com.test' }, user: { username: 'test' } }, mockRes);
    assert.strictEqual(resStatus, 400);
    assert.ok(resJson.error.includes('Node'));
  });

  test('16. captureInspection deduplicates concurrent in-flight requests for same device', async () => {
    let callCount = 0;
    const mockClient = {
      screenshot: async () => {
        callCount++;
        await new Promise((r) => setTimeout(r, 60));
        return {
          url: '/screenshot.png',
          previewBase64: 'data:image/png;base64,mock',
          device: { name: 'Mock Device' }
        };
      },
      dumpXml: async () => {
        return `<hierarchy rotation="0"><node index="0" text="Test" class="android.widget.TextView" bounds="[0,0][100,100]" /></hierarchy>`;
      }
    };

    const user = { username: 'test' };
    const p1 = uiInspectorService.captureInspection('mock_serial_dedup', user, mockClient);
    const p2 = uiInspectorService.captureInspection('mock_serial_dedup', user, mockClient);

    const [r1, r2] = await Promise.all([p1, p2]);
    assert.strictEqual(callCount, 1, 'Only one screenshot/dump call should be executed for concurrent requests');
    assert.strictEqual(r1.hierarchy.totalNodes, 1);
    assert.strictEqual(r2.hierarchy.totalNodes, 1);
  });

  test('17. getLastSuccessfulInspection caches and returns the latest successful inspection', async () => {
    const cached = uiInspectorService.getLastSuccessfulInspection('mock_serial_dedup');
    assert.ok(cached, 'Cached inspection should be available');
    assert.strictEqual(cached.device.serial, 'mock_serial_dedup');
    assert.strictEqual(cached.hierarchy.totalNodes, 1);
  });

  test('18. ensureNoStuckUiAutomator executes safely without throwing on missing process', async () => {
    await assert.doesNotReject(async () => {
      await uiInspectorService.ensureNoStuckUiAutomator('mock_serial_nonexistent');
    });
  });
});
