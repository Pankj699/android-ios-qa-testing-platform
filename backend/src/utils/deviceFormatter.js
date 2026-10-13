/**
 * Consistent Device Name + OS Version Formatter (Backend)
 *
 * Provides standardized formatting for Android and iOS device representations:
 * - Android: "VIVO V2143 (Android 13)" or "Google Pixel 8 (Android 15)"
 * - iOS: "iPhone 15 Pro (iOS 18.5)"
 * - Missing OS: "VIVO V2143" (no empty parentheses)
 * - Missing model/serial only: Safe fallback "Android Device" / "iOS Device"
 * - Selectors: Appends serial suffix " (serial)" when serial is present
 */

const BRAND_MAP = {
  vivo: 'VIVO',
  oppo: 'OPPO',
  lg: 'LG',
  asus: 'ASUS',
  htc: 'HTC',
  zte: 'ZTE',
  tcl: 'TCL',
  oneplus: 'OnePlus',
  xiaomi: 'Xiaomi',
  samsung: 'Samsung',
  google: 'Google',
  apple: 'Apple',
  motorola: 'Motorola',
  sony: 'Sony',
  huawei: 'Huawei',
  realme: 'Realme',
  honor: 'Honor',
  lenovo: 'Lenovo',
  nokia: 'Nokia',
  nothing: 'Nothing'
};

function normalizeBrand(raw = '') {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (BRAND_MAP[lower]) return BRAND_MAP[lower];
  // Title case words by default
  return trimmed.replace(/\b\w+/g, txt => txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase());
}

/**
 * Format clean device model/brand name without OS version.
 * Deduplicates manufacturer prefix and normalizes brand casing.
 */
function formatDeviceModelName(device) {
  if (!device) return 'Unknown Device';
  if (typeof device === 'string') return device.trim() || 'Unknown Device';

  const isIos = device.platform === 'ios' ||
    (device.model && /i(phone|pad|pod)/i.test(device.model)) ||
    (device.name && /i(phone|pad|pod)/i.test(device.name));

  const rawMfg = (device.manufacturer || '').trim();
  const rawModel = (device.model || '').trim();
  const rawName = (device.name || '').trim();

  // If iOS device
  if (isIos) {
    const candidate = rawModel || rawName || 'iPhone';
    // If candidate starts with Apple (e.g. "Apple iPhone 15 Pro"), strip or clean it
    if (/^apple\s+/i.test(candidate)) {
      return candidate.replace(/^apple\s+/i, 'Apple ');
    }
    // Don't prepend "Apple" to "iPhone 15 Pro"
    return candidate;
  }

  // Android / generic
  // Determine best candidate model string
  let candidate = '';
  if (rawModel && rawModel !== 'Unknown Model' && rawModel !== 'Android Device' && rawModel !== 'Unknown') {
    candidate = rawModel;
  } else if (rawName && rawName !== 'Android Device' && rawName !== 'Browser USB Device' && rawName !== 'Unknown Device') {
    candidate = rawName;
  }

  const mfgLower = rawMfg.toLowerCase();
  const isGenericMfg = !rawMfg || mfgLower === 'android' || mfgLower === 'unknown' || mfgLower === 'linux';
  const normMfg = isGenericMfg ? '' : normalizeBrand(rawMfg);

  if (!candidate) {
    if (normMfg) return `${normMfg} Device`;
    if (device.serial) return 'Android Device';
    return 'Unknown Device';
  }

  if (!normMfg) {
    for (const [brandKey, canonicalBrand] of Object.entries(BRAND_MAP)) {
      const brandRegex = new RegExp(`^${brandKey}\\b`, 'i');
      if (brandRegex.test(candidate)) {
        return candidate.replace(brandRegex, canonicalBrand);
      }
    }
    if (/^SM[-_ ]/i.test(candidate)) {
      return `Samsung ${candidate}`;
    }
    return candidate;
  }

  // Check if candidate already starts with manufacturer (case-insensitive)
  const startsWithMfgRegex = new RegExp(`^${normMfg}\\b`, 'i');
  if (startsWithMfgRegex.test(candidate)) {
    // Replace with canonical brand casing (e.g. "vivo V2143" -> "VIVO V2143")
    return candidate.replace(startsWithMfgRegex, normMfg);
  }

  // If manufacturer is not present in model name, prepend canonical brand
  return `${normMfg} ${candidate}`.trim();
}

/**
 * Extract and format clean OS label (e.g. "Android 13" or "iOS 18.5").
 * Returns empty string if OS version is missing, malformed, or only API level.
 */
function formatDeviceOsVersion(device) {
  if (!device || typeof device !== 'object') return '';

  const isIos = device.platform === 'ios' ||
    (device.model && /i(phone|pad|pod)/i.test(device.model)) ||
    (device.name && /i(phone|pad|pod)/i.test(device.name));

  // Determine potential raw release version
  let rawVer = '';

  if (isIos) {
    rawVer = device.iosVersion || device.osVersion || '';
  } else {
    // Android: Prefer actual release version over generic fields or API level
    if (device.osVersion && !/^android$/i.test(String(device.osVersion).trim())) {
      rawVer = device.osVersion;
    } else if (device.androidVersion && !/^android$/i.test(String(device.androidVersion).trim())) {
      rawVer = device.androidVersion;
    } else if (device.releaseVersion) {
      rawVer = device.releaseVersion;
    }
  }

  if (!rawVer) return '';

  const strVer = String(rawVer).trim();

  // Exclude placeholder strings that have no version number
  if (/^(unknown|n\/?a|null|undefined|android|ios)$/i.test(strVer)) {
    return '';
  }

  if (isIos) {
    // Strip leading "iOS" or "ios" if present
    const cleanVer = strVer.replace(/^ios\s*/i, '').trim();
    if (!cleanVer || /^(unknown|null|undefined)$/i.test(cleanVer)) return '';
    return `iOS ${cleanVer}`;
  }

  // Android
  // Strip leading "Android" or "android" if present
  const cleanVer = strVer.replace(/^android\s*/i, '').trim();
  if (!cleanVer || /^(unknown|null|undefined)$/i.test(cleanVer)) return '';
  return `Android ${cleanVer}`;
}

/**
 * Full Display Name in standard format:
 * - "VIVO V2143 (Android 13)"
 * - "Google Pixel 8 (Android 15)"
 * - "iPhone 15 Pro (iOS 18.5)"
 * - "VIVO V2143" (when OS is unavailable)
 */
function formatDeviceDisplayName(device) {
  if (!device) return 'Unknown Device';
  if (typeof device === 'string') {
    const trimmed = device.trim();
    return trimmed || 'Unknown Device';
  }

  const modelName = formatDeviceModelName(device);
  const osLabel = formatDeviceOsVersion(device);

  if (osLabel) {
    // Check if modelName already contains the osLabel
    if (modelName.includes(`(${osLabel})`)) {
      return modelName;
    }
    return `${modelName} (${osLabel})`;
  }

  return modelName;
}

/**
 * Formatter for device dropdown selectors and target selectors:
 * Includes distinguishing serial suffix:
 * E.g. "VIVO V2143 (Android 13) (192.168.1.50:5555)"
 */
function formatDeviceSelectorLabel(device) {
  if (!device) return 'Unknown Device';
  const displayName = formatDeviceDisplayName(device);
  const serial = typeof device === 'object' ? (device.serial || device.id || device.udid) : null;

  if (serial && !displayName.includes(serial)) {
    return `${displayName} (${serial})`;
  }

  return displayName;
}

module.exports = {
  BRAND_MAP,
  normalizeBrand,
  formatDeviceModelName,
  formatDeviceOsVersion,
  formatDeviceDisplayName,
  formatDeviceSelectorLabel
};
