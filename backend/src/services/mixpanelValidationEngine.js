/**
 * Pure, deterministic validation engine for Mixpanel events.
 * Compares an actual event payload against the applicable event specification rules.
 */
class MixpanelValidationEngine {
  /**
   * Validate an actual event payload against an event specification.
   * @param {string} eventName - Actual event name
   * @param {object} rawPayload - Raw Mixpanel event properties or whole object
   * @param {object|null} eventSpec - Event rule object from specification (or null if unmapped)
   * @returns {object} Validation result
   */
  static validate(eventName, rawPayload = {}, eventSpec = null) {
    const expectedAttrs = eventSpec ? (eventSpec.attributes || eventSpec.parameters || []) : null;

    // If no matching specification rule exists, return UNMAPPED
    if (!eventSpec || !Array.isArray(expectedAttrs)) {
      const actualProps = extractEventProperties(rawPayload);
      const actualKeys = Object.keys(actualProps);
      const summary = {
        matched: 0,
        missing: 0,
        extra: actualKeys.length,
        incorrect: 0,
        totalExpected: 0,
        totalActual: actualKeys.length
      };

      return {
        eventName,
        status: 'UNMAPPED',
        isMapped: false,
        summary,
        metrics: summary,
        attributes: actualKeys.map(key => ({
          name: key,
          status: 'EXTRA',
          expected: null,
          expectedType: null,
          type: null,
          expectedValue: null,
          value: null,
          actual: getNestedValue(actualProps, key),
          actualValue: getNestedValue(actualProps, key),
          actualType: getActualType(getNestedValue(actualProps, key)),
          message: 'Event is not defined in the uploaded specification'
        }))
      };
    }

    const actualProps = extractEventProperties(rawPayload);

    const attributeResults = [];
    const expectedNames = new Set();

    let matchedCount = 0;
    let missingCount = 0;
    let extraCount = 0;
    let incorrectCount = 0;

    // 1. Evaluate all expected attributes
    for (const expected of expectedAttrs) {
      expectedNames.add(expected.name);
      const hasKey = hasProperty(actualProps, expected.name);
      const actualVal = getNestedValue(actualProps, expected.name);
      const actualType = getActualType(actualVal);
      const expType = expected.expectedType || expected.type || null;
      const expVal = expected.expectedValue !== undefined ? expected.expectedValue : (expected.value !== undefined ? expected.value : null);

      if (!hasKey) {
        if (expected.required !== false) {
          missingCount++;
        }
        attributeResults.push({
          name: expected.name,
          status: 'MISSING',
          required: expected.required !== false,
          expectedType: expType,
          type: expType,
          expectedValue: expVal,
          value: expVal,
          description: expected.description,
          actual: undefined,
          actualValue: undefined,
          actualType: 'undefined',
          message: 'Expected property is absent in event payload'
        });
      } else {
        // Value is present, validate type and value if specified
        let isIncorrect = false;
        let failReason = '';

        if (expType) {
          const typeMatch = checkTypeMatch(actualVal, expType);
          if (!typeMatch) {
            isIncorrect = true;
            failReason = `Expected type "${expType}", but received "${actualType}"`;
          }
        }

        if (!isIncorrect && expVal !== null && expVal !== undefined && expVal !== '') {
          const valMatch = checkValueMatch(actualVal, expVal);
          if (!valMatch) {
            isIncorrect = true;
            failReason = `Expected value "${expVal}", but received "${JSON.stringify(actualVal)}"`;
          }
        }

        if (isIncorrect) {
          incorrectCount++;
          attributeResults.push({
            name: expected.name,
            status: 'INCORRECT',
            required: expected.required !== false,
            expectedType: expType,
            type: expType,
            expectedValue: expVal,
            value: expVal,
            description: expected.description,
            actual: actualVal,
            actualValue: actualVal,
            actualType,
            message: failReason
          });
        } else {
          matchedCount++;
          attributeResults.push({
            name: expected.name,
            status: 'MATCHED',
            required: expected.required !== false,
            expectedType: expType,
            type: expType,
            expectedValue: expVal,
            value: expVal,
            description: expected.description,
            actual: actualVal,
            actualValue: actualVal,
            actualType,
            message: 'Property matches specification'
          });
        }
      }
    }

    // 2. Identify Extra attributes (present in actual, but not defined in expected specification)
    // Filter out standard Mixpanel internal metadata like $lib, $os, distinct_id, $insert_id from counting as error unless expected
    const actualKeys = Object.keys(actualProps);
    const ignoredMixpanelInternal = new Set([
      '$lib', '$lib_version', '$os', '$os_version', '$model', '$manufacturer',
      '$app_build_number', '$app_version_string', '$carrier', '$screen_width',
      '$screen_height', '$wifi', '$bluetooth_enabled', '$has_telephone',
      '$distinct_id_before_identity', 'distinct_id', '$insert_id', 'time', 'mp_lib'
    ]);

    for (const key of actualKeys) {
      if (!expectedNames.has(key) && !ignoredMixpanelInternal.has(key)) {
        extraCount++;
        attributeResults.push({
          name: key,
          status: 'EXTRA',
          required: false,
          expectedType: null,
          type: null,
          expectedValue: null,
          value: null,
          description: null,
          actual: actualProps[key],
          actualValue: actualProps[key],
          actualType: getActualType(actualProps[key]),
          message: 'Additional property not defined in event specification'
        });
      }
    }

    // Sort: MISSING, INCORRECT, EXTRA, MATCHED
    const statusOrder = { MISSING: 0, INCORRECT: 1, EXTRA: 2, MATCHED: 3 };
    attributeResults.sort((a, b) => {
      const oA = statusOrder[a.status] ?? 4;
      const oB = statusOrder[b.status] ?? 4;
      if (oA !== oB) return oA - oB;
      return a.name.localeCompare(b.name);
    });

    // Overall event status
    let overallStatus = 'MATCHED';
    if (missingCount > 0) {
      overallStatus = 'MISSING';
    } else if (incorrectCount > 0) {
      overallStatus = 'INCORRECT';
    } else if (extraCount > 0) {
      overallStatus = 'EXTRA';
    }

    const summary = {
      matched: matchedCount,
      missing: missingCount,
      extra: extraCount,
      incorrect: incorrectCount,
      totalExpected: expectedAttrs.length,
      totalActual: actualKeys.length
    };

    return {
      eventName,
      status: overallStatus,
      isMapped: true,
      summary,
      metrics: summary,
      attributes: attributeResults
    };
  }
}

/**
 * Validate an event against an array of rules.
 */
function validateEvent(rawPayload, specRules = []) {
  const eventName = rawPayload?.event || rawPayload?.eventName || rawPayload?.name || '';
  const rules = Array.isArray(specRules) ? specRules : [];
  const rule = rules.find(r => r.eventName === eventName);
  return MixpanelValidationEngine.validate(eventName, rawPayload, rule || null);
}

/**
 * Extract properties dictionary from a raw Mixpanel event format.
 */
function extractEventProperties(rawPayload) {
  if (!rawPayload || typeof rawPayload !== 'object') return {};

  // If payload is standard Mixpanel Export/Track JSON: { "event": "...", "properties": { ... } }
  if (rawPayload.properties && typeof rawPayload.properties === 'object' && !Array.isArray(rawPayload.properties)) {
    return { ...rawPayload.properties };
  }

  // If payload is already flattened properties map
  const clone = { ...rawPayload };
  delete clone.event;
  delete clone.eventName;
  delete clone.name;
  return clone;
}

/**
 * Check if property exists using direct key or dot-notation
 */
function hasProperty(obj, path) {
  if (!obj || typeof obj !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(obj, path)) return true;

  if (path.includes('.')) {
    const parts = path.split('.');
    let curr = obj;
    for (const p of parts) {
      if (!curr || typeof curr !== 'object' || !Object.prototype.hasOwnProperty.call(curr, p)) {
        return false;
      }
      curr = curr[p];
    }
    return true;
  }

  return false;
}

/**
 * Resolve nested value via dot notation e.g. "user.profile.tier"
 */
function getNestedValue(obj, path) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, path)) return obj[path];

  if (path.includes('.')) {
    const parts = path.split('.');
    let curr = obj;
    for (const p of parts) {
      if (curr === null || curr === undefined || typeof curr !== 'object') return undefined;
      curr = curr[p];
    }
    return curr;
  }

  return undefined;
}

/**
 * Determine exact runtime type
 */
function getActualType(val) {
  if (val === null) return 'null';
  if (val === undefined) return 'undefined';
  if (Array.isArray(val)) return 'array';
  if (typeof val === 'number') {
    return Number.isInteger(val) ? 'integer' : 'float';
  }
  return typeof val;
}

/**
 * Validate type compatibility
 */
function checkTypeMatch(val, expectedType) {
  if (!expectedType) return true;
  const exp = expectedType.toLowerCase().trim();
  const actual = getActualType(val);

  if (exp === 'any' || exp === '*') return true;
  if (exp === 'string' || exp === 'str' || exp === 'text') return actual === 'string';
  if (exp === 'number' || exp === 'num' || exp === 'int' || exp === 'integer' || exp === 'float') {
    return actual === 'integer' || actual === 'float' || (typeof val === 'number' && !isNaN(val));
  }
  if (exp === 'boolean' || exp === 'bool') return actual === 'boolean';
  if (exp === 'array' || exp === 'list') return actual === 'array';
  if (exp === 'object' || exp === 'json' || exp === 'dict') return actual === 'object';
  if (exp === 'null') return val === null;

  // Union types like "string|number" or "number|null"
  if (exp.includes('|')) {
    const parts = exp.split('|').map(p => p.trim());
    return parts.some(p => checkTypeMatch(val, p));
  }

  return actual === exp;
}

/**
 * Validate value match
 */
function checkValueMatch(actualVal, expectedVal) {
  if (expectedVal === null || expectedVal === undefined || expectedVal === '') return true;

  // If expected value is boolean string
  if (expectedVal === 'true' && typeof actualVal === 'boolean') return actualVal === true;
  if (expectedVal === 'false' && typeof actualVal === 'boolean') return actualVal === false;

  // Numeric check
  if (typeof actualVal === 'number' && !isNaN(Number(expectedVal))) {
    return actualVal === Number(expectedVal);
  }

  // Comma-separated enum options e.g. "home, settings, editor"
  if (typeof expectedVal === 'string' && expectedVal.includes(',')) {
    const options = expectedVal.split(',').map(s => s.trim().toLowerCase());
    return options.includes(String(actualVal).toLowerCase());
  }

  return String(actualVal).trim().toLowerCase() === String(expectedVal).trim().toLowerCase();
}

MixpanelValidationEngine.validateEvent = validateEvent;
module.exports = MixpanelValidationEngine;
module.exports.MixpanelValidationEngine = MixpanelValidationEngine;
module.exports.validateEvent = validateEvent;
