/**
 * UI Inspector Service for Android
 * Provides UIAutomator hierarchy dumping, XML hierarchy parsing,
 * element coordinate matching, and explicit property source tagging.
 */
const config = require('../config');
const logger = require('../utils/logger');
const adbService = require('./adbService');
const deviceLockService = require('./deviceLockService');
const screenMirrorService = require('./screenMirrorService');
const iosService = require('./iosService');
const typographyInspectionService = require('./typographyInspectionService');

/**
 * Unescapes standard XML entities.
 * @param {string} str
 * @returns {string}
 */
function unescapeXml(str = '') {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Parses Android UIAutomator bounds string "[left,top][right,bottom]".
 * @param {string} boundsStr
 * @returns {{ left: number, top: number, right: number, bottom: number, width: number, height: number, raw: string }}
 */
function parseBounds(boundsStr = '') {
  const match = boundsStr.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!match) {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, raw: boundsStr || '' };
  }

  const left = parseInt(match[1], 10);
  const top = parseInt(match[2], 10);
  const right = parseInt(match[3], 10);
  const bottom = parseInt(match[4], 10);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);

  return {
    left,
    top,
    right,
    bottom,
    width,
    height,
    raw: boundsStr
  };
}

/**
 * Estimates font size based on text length and bounding box height.
 * Clearly tagged as 'Estimated'.
 * @param {string} text
 * @param {number} height
 * @returns {{ value: string, source: string, note: string }}
 */
function estimateTypography(text, height) {
  if (!text || height <= 0) {
    return {
      fontSize: { value: 'None', source: 'Unavailable', note: 'No text present on element' },
      fontFamily: { value: 'Not exposed by UIAutomator', source: 'Unavailable', note: 'Android accessibility tree does not expose typeface names' },
      fontWeight: { value: 'Not exposed by UIAutomator', source: 'Unavailable', note: 'Requires app view instrumentation' }
    };
  }

  // Account for multiple lines if text contains newlines
  const explicitLines = Math.max(1, (text.match(/\n/g) || []).length + 1);
  const singleLineHeight = height / explicitLines;

  // On modern Android displays (~xxhdpi 2.625x - 3x density), text cap-height is approximately 60-70% of line height
  const estimatedPx = Math.max(8, Math.round(singleLineHeight * 0.65));
  const estimatedSp = Math.max(6, Math.round(estimatedPx / 2.625));

  return {
    fontSize: {
      value: `~${estimatedSp}sp (${estimatedPx}px visual estimate)`,
      source: 'Estimated',
      note: 'Generic visual estimate from bounding box height; not an exact native measurement'
    },
    fontFamily: {
      value: 'Not exposed by UIAutomator',
      source: 'Unavailable',
      note: 'Android accessibility hierarchy does not provide typeface font family'
    },
    fontWeight: {
      value: 'Not exposed by UIAutomator',
      source: 'Unavailable',
      note: 'Requires runtime app instrumentation to read Paint text styles'
    }
  };
}

/**
 * Generates an XPath selector for a node.
 * @param {object} node
 * @returns {string}
 */
function generateXPath(node) {
  const className = node.className || 'android.view.View';
  if (node.resourceId && node.resourceId.includes(':id/')) {
    return `//${className}[@resource-id="${node.resourceId}"]`;
  }
  if (node.text && node.text.length > 0 && node.text.length < 50) {
    const escapedText = node.text.replace(/"/g, '\\"');
    return `//${className}[@text="${escapedText}"]`;
  }
  if (node.contentDesc) {
    const escapedDesc = node.contentDesc.replace(/"/g, '\\"');
    return `//${className}[@content-desc="${escapedDesc}"]`;
  }
  return node.hierarchyPath || `//${className}[${(node.index || 0) + 1}]`;
}

/**
 * Parses UIAutomator XML string into a structured JSON hierarchy tree.
 * Fast, lightweight zero-dependency parser conforming to Android uiautomator format.
 * @param {string} xmlString
 * @returns {{ rotation: number, rootNode: object|null, totalNodes: number }}
 */
function parseUiHierarchyXml(xmlString) {
  if (!xmlString || typeof xmlString !== 'string') {
    return { rotation: 0, rootNode: null, totalNodes: 0 };
  }

  // Extract rotation from hierarchy root tag
  let rotation = 0;
  const rotationMatch = xmlString.match(/<hierarchy[^>]*rotation="(\d+)"/i);
  if (rotationMatch) {
    rotation = parseInt(rotationMatch[1], 10);
  }

  let nodeCounter = 0;
  const stack = [];
  let rootNode = null;

  // Regex to match <node ...>, </node>, or self-closing <node ... /> (quote-aware to prevent premature termination)
  const tagRegex = /<\/?node\b((?:[^"'>]|"[^"]*"|'[^']*')*?)(\/?)>/gi;
  let match;

  while ((match = tagRegex.exec(xmlString)) !== null) {
    const isClosing = match[0].startsWith('</');
    const isSelfClosing = match[2] === '/';
    const attrString = match[1] || '';

    if (isClosing) {
      if (stack.length > 1) {
        stack.pop();
      }
      continue;
    }

    // Parse attributes from node tag
    const attrs = {};
    const attrRegex = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(attrString)) !== null) {
      attrs[attrMatch[1]] = unescapeXml(attrMatch[2]);
    }

    const bounds = parseBounds(attrs.bounds || '');
    const text = attrs.text || '';
    const typography = estimateTypography(text, bounds.height);
    const className = attrs.class || 'android.view.View';
    const resourceId = attrs['resource-id'] || '';
    const contentDesc = attrs['content-desc'] || '';
    const packageName = attrs.package || '';
    const index = parseInt(attrs.index || '0', 10);

    const parentNode = stack.length > 0 ? stack[stack.length - 1] : null;
    const depth = stack.length;
    const hierarchyPath = parentNode
      ? `${parentNode.hierarchyPath}/${className}[${index + 1}]`
      : `/${className}[${index + 1}]`;

    const node = {
      id: `ui_node_${nodeCounter++}`,
      index,
      depth,
      hierarchyPath,
      className,
      resourceId,
      package: packageName,
      text,
      contentDesc,
      bounds,
      states: {
        clickable: attrs.clickable === 'true',
        enabled: attrs.enabled !== 'false',
        focusable: attrs.focusable === 'true',
        focused: attrs.focused === 'true',
        scrollable: attrs.scrollable === 'true',
        longClickable: attrs['long-clickable'] === 'true',
        password: attrs.password === 'true',
        selected: attrs.selected === 'true',
        checkable: attrs.checkable === 'true',
        checked: attrs.checked === 'true'
      },
      typography,
      propertySources: {
        className: 'Native',
        resourceId: 'Native',
        package: 'Native',
        text: 'Native',
        contentDesc: 'Native',
        bounds: 'Native',
        states: 'Native',
        fontSize: typography.fontSize.source,
        fontFamily: typography.fontFamily.source,
        fontWeight: typography.fontWeight.source
      },
      children: []
    };

    node.xpath = generateXPath(node);

    if (parentNode) {
      parentNode.children.push(node);
    } else if (!rootNode) {
      rootNode = node;
    }

    if (!isSelfClosing) {
      stack.push(node);
    }
  }

  return {
    rotation,
    rootNode,
    totalNodes: nodeCounter
  };
}

/**
 * Finds all nodes whose bounding box contains the specified coordinates,
 * sorted from deepest leaf node to root.
 * @param {object} rootNode
 * @param {number} x
 * @param {number} y
 * @returns {Array<object>}
 */
function findNodesAtCoordinates(rootNode, x, y) {
  if (!rootNode) return [];

  const matches = [];

  function traverse(node) {
    if (!node || !node.bounds) return;
    const { left, top, right, bottom } = node.bounds;
    if (x >= left && x <= right && y >= top && y <= bottom) {
      matches.push(node);
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  }

  traverse(rootNode);

  // Sort by depth descending (deepest first), then by area ascending (smallest area first)
  matches.sort((a, b) => {
    if (b.depth !== a.depth) {
      return b.depth - a.depth;
    }
    const areaA = (a.bounds.width || 0) * (a.bounds.height || 0);
    const areaB = (b.bounds.width || 0) * (b.bounds.height || 0);
    return areaA - areaB;
  });

  return matches;
}

// In-flight inspection deduplication map (serial -> Promise<object>)
const inFlightInspections = new Map();
// Last successful inspection cache per device serial
const lastSuccessfulInspections = new Map();

/**
 * Safely terminates any stuck or lingering uiautomator shell process on the device.
 * @param {string} serial
 */
async function ensureNoStuckUiAutomator(serial) {
  try {
    await adbService.execute(['-s', serial, 'shell', 'pkill', '-f', 'uiautomator'], { timeout: 3000 });
    // Brief settle time for Android AccessibilityManager to unbind previous client
    await new Promise((r) => setTimeout(r, 200));
  } catch {
    // Expected when no uiautomator process is currently active
  }
}

/**
 * Internal worker that captures screenshot and dumps UIAutomator hierarchy.
 * @param {string} serial
 * @param {object} user
 * @param {object} [injectedClient]
 * @returns {Promise<object>}
 */
async function doCaptureInspection(serial, user, injectedClient = null) {
  // 1. Capture high-res screenshot
  const screenshot = injectedClient?.screenshot
    ? await injectedClient.screenshot(serial, user)
    : await screenMirrorService.captureScreenshot(serial, user);

  // 2. Dump UIAutomator hierarchy XML via ADB with unique PID+timestamp temp path
  const dumpFile = `/data/local/tmp/uidump_${Date.now()}_${process.pid}_${Math.random().toString(36).substring(2, 7)}.xml`;
  const dumpTimeout = parseInt(process.env.UIAUTOMATOR_TIMEOUT_MS || '20000', 10);

  let xmlContent = '';
  if (injectedClient?.dumpXml) {
    xmlContent = await injectedClient.dumpXml(serial);
  } else {
    try {
      // First try compressed dump for higher performance and cleaner trees
      let dumpRes = null;
      let compressedFailed = false;

      try {
        dumpRes = await adbService.execute(
          ['-s', serial, 'shell', 'uiautomator', 'dump', '--compressed', dumpFile],
          { timeout: dumpTimeout }
        );

        if (dumpRes.code !== 0 || (dumpRes.raw && dumpRes.raw.includes('ERROR:'))) {
          compressedFailed = true;
        }
      } catch (err) {
        logger.warn(`[UiInspectorService] Compressed dump failed or timed out: ${err.message}. Cleaning device state...`);
        compressedFailed = true;
        await ensureNoStuckUiAutomator(serial);
      }

      // If compressed dump errored or timed out, attempt standard uncompressed dump as fallback
      if (compressedFailed) {
        logger.info(`[UiInspectorService] Retrying with standard uncompressed UIAutomator dump for ${serial}...`);
        try {
          dumpRes = await adbService.execute(
            ['-s', serial, 'shell', 'uiautomator', 'dump', dumpFile],
            { timeout: dumpTimeout }
          );
        } catch (fallbackErr) {
          logger.warn(`[UiInspectorService] Standard UIAutomator dump failed or timed out: ${fallbackErr.message}`);
          await ensureNoStuckUiAutomator(serial);
          throw new Error(`UIAutomator hierarchy dump timed out or failed: ${fallbackErr.message}. Ensure device screen is ON and unlocked.`);
        }
      }

      if (!dumpRes || dumpRes.code !== 0 || (dumpRes.raw && dumpRes.raw.includes('ERROR:'))) {
        const errMsg = dumpRes?.raw?.trim() || 'Unknown error';
        await ensureNoStuckUiAutomator(serial);
        throw new Error(`UIAutomator dump failed: ${errMsg}. Ensure device screen is ON and unlocked.`);
      }

      const catRes = await adbService.execute(
        ['-s', serial, 'shell', 'cat', dumpFile],
        { timeout: 8000 }
      );

      xmlContent = catRes.stdout || catRes.raw || '';
    } finally {
      // Cleanup temporary file asynchronously
      adbService.execute(['-s', serial, 'shell', 'rm', '-f', dumpFile]).catch(() => {});
    }
  }

  if (!xmlContent || !xmlContent.includes('<hierarchy')) {
    const err = new Error('Failed to retrieve UIAutomator hierarchy from device');
    err.statusCode = 500;
    throw err;
  }

  // 3. Parse XML into structured JSON tree
  const parsedHierarchy = parseUiHierarchyXml(xmlContent);

  // 4. Enrich text nodes with layered typography inspection (APK analysis & heuristics)
  try {
    await typographyInspectionService.enrichHierarchyTypography(parsedHierarchy.rootNode, serial);
  } catch (enrichErr) {
    logger.debug(`[UiInspectorService] Typography enrichment non-fatal fallback: ${enrichErr.message}`);
  }

  const result = {
    success: true,
    timestamp: new Date().toISOString(),
    device: {
      serial,
      name: screenshot.device?.name || 'Android Device',
      model: screenshot.device?.model || 'Unknown',
      screenResolution: screenshot.device?.screenResolution || 'Unknown'
    },
    screenshot: {
      url: screenshot.url,
      previewBase64: screenshot.previewBase64,
      sizeBytes: screenshot.sizeBytes,
      filename: screenshot.filename
    },
    hierarchy: {
      rotation: parsedHierarchy.rotation,
      totalNodes: parsedHierarchy.totalNodes,
      rootNode: parsedHierarchy.rootNode
    }
  };

  lastSuccessfulInspections.set(serial, result);
  return result;
}

/**
 * Captures screenshot and dumps UIAutomator hierarchy for inspection.
 * Includes per-device request deduplication so overlapping clicks share the in-flight capture.
 * @param {string} serial
 * @param {object} user
 * @param {object} [injectedClient] Optional mock client for testing
 * @returns {Promise<object>}
 */
async function captureInspection(serial, user, injectedClient = null) {
  if (!serial) {
    const err = new Error('Device serial is required for UI inspection');
    err.statusCode = 400;
    throw err;
  }

  if (iosService.isIosDevice(serial)) {
    const err = new Error('UI Inspector currently supports Android devices via UIAutomator. iOS inspection requires companion agent XCUITest hierarchy provider.');
    err.statusCode = 400;
    throw err;
  }

  if (!deviceLockService.isDeviceAccessible(serial, user)) {
    const err = new Error(`Device ${serial} is not accessible by current user`);
    err.statusCode = 403;
    throw err;
  }

  // Deduplicate overlapping in-flight inspections for the same device
  if (inFlightInspections.has(serial)) {
    logger.info(`[UiInspectorService] Reusing active in-flight inspection for device ${serial}`);
    return inFlightInspections.get(serial);
  }

  const inspectionPromise = (async () => {
    try {
      return await doCaptureInspection(serial, user, injectedClient);
    } finally {
      inFlightInspections.delete(serial);
    }
  })();

  inFlightInspections.set(serial, inspectionPromise);
  return inspectionPromise;
}

/**
 * Retrieves the last successful inspection for a device if available.
 * @param {string} serial
 * @returns {object|null}
 */
function getLastSuccessfulInspection(serial) {
  return lastSuccessfulInspections.get(serial) || null;
}

module.exports = {
  unescapeXml,
  parseBounds,
  estimateTypography,
  generateXPath,
  parseUiHierarchyXml,
  findNodesAtCoordinates,
  captureInspection,
  getLastSuccessfulInspection,
  ensureNoStuckUiAutomator
};
