/**
 * Pure utility functions for the Mixpanel Bug Writer.
 * Generates Redmine-ready bug statements from validated event attributes.
 */

/**
 * Format a raw value for presentation in bug statements.
 * Correctly handles falsy values (0, false, null, ""), arrays, and nested objects.
 *
 * @param {*} val
 * @returns {string}
 */
export function formatValueForBug(val) {
  if (val === undefined) return 'undefined';
  if (val === null) return 'null';
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return String(val);
  if (typeof val === 'object') {
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  }
  return String(val);
}

/**
 * Extract resolved expected and actual values from an attribute validation result.
 *
 * @param {object} attr
 * @returns {{ actual: *, expected: * }}
 */
export function getAttributeDisplayValues(attr = {}) {
  let actualRaw = undefined;
  if (attr.actualValue !== undefined) {
    actualRaw = attr.actualValue;
  } else if (attr.actual !== undefined) {
    actualRaw = attr.actual;
  }

  let expectedRaw = undefined;
  if (attr.expectedValue !== undefined && attr.expectedValue !== null && attr.expectedValue !== '') {
    expectedRaw = attr.expectedValue;
  } else if (attr.value !== undefined && attr.value !== null && attr.value !== '') {
    expectedRaw = attr.value;
  } else if (attr.expectedType) {
    expectedRaw = attr.expectedType;
  } else if (attr.type) {
    expectedRaw = attr.type;
  } else if (attr.expected !== undefined && attr.expected !== null) {
    expectedRaw = attr.expected;
  }

  return {
    actual: actualRaw,
    expected: expectedRaw
  };
}

/**
 * Generate a single Redmine-ready statement for an event attribute based on its validation status.
 *
 * Default templates:
 * - Missing:
 *   `In the "<event_name>" event, the expected "<attribute_name>" attribute is missing from the actual payload.`
 * - Extra:
 *   `In the "<event_name>" event, the "<attribute_name>" attribute is present in the actual payload but is not defined in the Excel specification. Actual value: <actual_value>.`
 * - Incorrect:
 *   `In the "<event_name>" event, the "<attribute_name>" attribute has an incorrect value. Expected: <expected_value>; Actual: <actual_value>.`
 * - Matched:
 *   `In the "<event_name>" event, the "<attribute_name>" attribute matches the Excel specification. Expected: <expected_value>; Actual: <actual_value>.`
 *
 * @param {string} eventName
 * @param {object} attr
 * @returns {string}
 */
export function generateBugStatement(eventName, attr = {}) {
  const cleanEvent = eventName || 'unknown_event';
  const name = attr.name || 'unnamed_attribute';
  const status = (attr.status || '').toUpperCase();
  const { actual, expected } = getAttributeDisplayValues(attr);

  const formattedActual = formatValueForBug(actual);
  const formattedExpected = formatValueForBug(expected);

  switch (status) {
    case 'MISSING':
      return `In the "${cleanEvent}" event, the expected "${name}" attribute is missing from the actual payload.`;

    case 'EXTRA':
      return `In the "${cleanEvent}" event, the "${name}" attribute is present in the actual payload but is not defined in the Excel specification. Actual value: ${formattedActual}.`;

    case 'INCORRECT':
      return `In the "${cleanEvent}" event, the "${name}" attribute has an incorrect value. Expected: ${formattedExpected}; Actual: ${formattedActual}.`;

    case 'MATCHED':
      return `In the "${cleanEvent}" event, the "${name}" attribute matches the Excel specification. Expected: ${formattedExpected}; Actual: ${formattedActual}.`;

    default:
      return `In the "${cleanEvent}" event, the "${name}" attribute status is ${status}. Actual value: ${formattedActual}.`;
  }
}

/**
 * Generate full multiline bug description from a list of selected attributes.
 * Each statement is separated by a blank line (double newline).
 *
 * @param {string} eventName
 * @param {Array<object>} selectedAttrs
 * @returns {string}
 */
export function generateBugDescription(eventName, selectedAttrs = []) {
  if (!Array.isArray(selectedAttrs) || selectedAttrs.length === 0) {
    return '';
  }

  const statements = selectedAttrs.map(attr => generateBugStatement(eventName, attr));
  return statements.join('\n\n');
}

/**
 * Group attributes by their validation status.
 *
 * @param {Array<object>} attributes
 * @returns {{ MISSING: Array, EXTRA: Array, INCORRECT: Array, MATCHED: Array }}
 */
export function groupAttributesByStatus(attributes = []) {
  const groups = {
    MISSING: [],
    EXTRA: [],
    INCORRECT: [],
    MATCHED: []
  };

  if (!Array.isArray(attributes)) {
    return groups;
  }

  for (const attr of attributes) {
    const status = (attr.status || '').toUpperCase();
    if (groups[status]) {
      groups[status].push(attr);
    } else {
      // Default unmapped or unrecognized status to EXTRA
      groups.EXTRA.push(attr);
    }
  }

  return groups;
}
