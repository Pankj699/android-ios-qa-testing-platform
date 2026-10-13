const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  formatDeviceModelName,
  formatDeviceOsVersion,
  formatDeviceDisplayName,
  formatDeviceSelectorLabel,
  normalizeBrand
} = require('../src/utils/deviceFormatter');

describe('Consistent Device Name + OS Version Formatter Suite', () => {
  describe('Scenario 1: Android VIVO V2143 (Android 13)', () => {
    test('formats VIVO V2143 with release version 13', () => {
      const dev = {
        manufacturer: 'vivo',
        model: 'V2143',
        osVersion: '13',
        serial: '192.168.1.100:5555'
      };
      assert.strictEqual(formatDeviceModelName(dev), 'VIVO V2143');
      assert.strictEqual(formatDeviceOsVersion(dev), 'Android 13');
      assert.strictEqual(formatDeviceDisplayName(dev), 'VIVO V2143 (Android 13)');
      assert.strictEqual(formatDeviceSelectorLabel(dev), 'VIVO V2143 (Android 13) (192.168.1.100:5555)');
    });
  });

  describe('Scenario 2: Android Google Pixel 8 (Android 15)', () => {
    test('formats Google Pixel 8 with osVersion 15', () => {
      const dev = {
        manufacturer: 'Google',
        model: 'Pixel 8',
        osVersion: '15',
        serial: '28231FDH2000AB'
      };
      assert.strictEqual(formatDeviceModelName(dev), 'Google Pixel 8');
      assert.strictEqual(formatDeviceOsVersion(dev), 'Android 15');
      assert.strictEqual(formatDeviceDisplayName(dev), 'Google Pixel 8 (Android 15)');
      assert.strictEqual(formatDeviceSelectorLabel(dev), 'Google Pixel 8 (Android 15) (28231FDH2000AB)');
    });
  });

  describe('Scenario 3: Manufacturer / Model Deduplication', () => {
    test('deduplicates when model already starts with manufacturer', () => {
      const dev = {
        manufacturer: 'Google',
        model: 'Google Pixel 8',
        osVersion: '15'
      };
      assert.strictEqual(formatDeviceModelName(dev), 'Google Pixel 8');
      assert.strictEqual(formatDeviceDisplayName(dev), 'Google Pixel 8 (Android 15)');
    });

    test('deduplicates case-insensitive manufacturer in model and normalizes brand', () => {
      const dev = {
        manufacturer: 'vivo',
        model: 'vivo V2143',
        osVersion: '13'
      };
      assert.strictEqual(formatDeviceModelName(dev), 'VIVO V2143');
      assert.strictEqual(formatDeviceDisplayName(dev), 'VIVO V2143 (Android 13)');
    });

    test('deduplicates Samsung model starting with Samsung', () => {
      const dev = {
        manufacturer: 'samsung',
        model: 'Samsung Galaxy S23',
        osVersion: '14'
      };
      assert.strictEqual(formatDeviceModelName(dev), 'Samsung Galaxy S23');
      assert.strictEqual(formatDeviceDisplayName(dev), 'Samsung Galaxy S23 (Android 14)');
    });

    test('normalizes leading brand when only name is provided (historical test record)', () => {
      const dev = {
        name: 'vivo V2143',
        osVersion: 'Android 13'
      };
      assert.strictEqual(formatDeviceModelName(dev), 'VIVO V2143');
      assert.strictEqual(formatDeviceDisplayName(dev), 'VIVO V2143 (Android 13)');
    });

    test('normalizes Samsung SM model code when manufacturer is missing', () => {
      const dev = {
        model: 'SM-X510',
        osVersion: '16'
      };
      assert.strictEqual(formatDeviceModelName(dev), 'Samsung SM-X510');
      assert.strictEqual(formatDeviceDisplayName(dev), 'Samsung SM-X510 (Android 16)');
    });
  });

  describe('Scenario 4: iOS Devices (iPhone 15 Pro (iOS 18.5))', () => {
    test('formats iPhone 15 Pro with iosVersion 18.5', () => {
      const dev = {
        platform: 'ios',
        manufacturer: 'Apple',
        model: 'iPhone 15 Pro',
        iosVersion: '18.5',
        udid: '00008101-001A2B3C4D5E'
      };
      assert.strictEqual(formatDeviceModelName(dev), 'iPhone 15 Pro');
      assert.strictEqual(formatDeviceOsVersion(dev), 'iOS 18.5');
      assert.strictEqual(formatDeviceDisplayName(dev), 'iPhone 15 Pro (iOS 18.5)');
      assert.strictEqual(formatDeviceSelectorLabel(dev), 'iPhone 15 Pro (iOS 18.5) (00008101-001A2B3C4D5E)');
    });

    test('does not prepend Apple to iPhone or iPad models', () => {
      const dev = {
        platform: 'ios',
        model: 'iPad Air (5th gen)',
        osVersion: '17.4'
      };
      assert.strictEqual(formatDeviceModelName(dev), 'iPad Air (5th gen)');
      assert.strictEqual(formatDeviceDisplayName(dev), 'iPad Air (5th gen) (iOS 17.4)');
    });
  });

  describe('Scenario 5: Missing OS Version (clean model without empty parentheses)', () => {
    test('shows model without empty parentheses when OS is missing', () => {
      const dev = {
        manufacturer: 'vivo',
        model: 'V2143'
      };
      assert.strictEqual(formatDeviceModelName(dev), 'VIVO V2143');
      assert.strictEqual(formatDeviceOsVersion(dev), '');
      assert.strictEqual(formatDeviceDisplayName(dev), 'VIVO V2143');
      assert.strictEqual(formatDeviceDisplayName(dev).includes('('), false);
      assert.strictEqual(formatDeviceDisplayName(dev).includes(')'), false);
    });

    test('handles empty or placeholder OS versions gracefully', () => {
      const placeholders = ['', 'Unknown', 'N/A', 'Android', 'iOS', null, undefined];
      for (const ph of placeholders) {
        const dev = { manufacturer: 'vivo', model: 'V2143', osVersion: ph };
        assert.strictEqual(formatDeviceOsVersion(dev), '');
        assert.strictEqual(formatDeviceDisplayName(dev), 'VIVO V2143');
      }
    });
  });

  describe('Scenario 6: Missing Model / Serial Only', () => {
    test('falls back safely without displaying raw serial as model name', () => {
      const dev = {
        serial: '192.168.1.50:5555'
      };
      assert.strictEqual(formatDeviceModelName(dev), 'Android Device');
      assert.strictEqual(formatDeviceOsVersion(dev), '');
      assert.strictEqual(formatDeviceDisplayName(dev), 'Android Device');
      assert.strictEqual(formatDeviceSelectorLabel(dev), 'Android Device (192.168.1.50:5555)');
    });

    test('falls back safely for iOS device with only UDID', () => {
      const dev = {
        platform: 'ios',
        udid: '00008101-001A'
      };
      assert.strictEqual(formatDeviceModelName(dev), 'iPhone');
      assert.strictEqual(formatDeviceDisplayName(dev), 'iPhone');
      assert.strictEqual(formatDeviceSelectorLabel(dev), 'iPhone (00008101-001A)');
    });
  });

  describe('Scenario 7: Null, Undefined, and Empty Objects', () => {
    test('handles null safely', () => {
      assert.strictEqual(formatDeviceModelName(null), 'Unknown Device');
      assert.strictEqual(formatDeviceOsVersion(null), '');
      assert.strictEqual(formatDeviceDisplayName(null), 'Unknown Device');
      assert.strictEqual(formatDeviceSelectorLabel(null), 'Unknown Device');
    });

    test('handles undefined safely', () => {
      assert.strictEqual(formatDeviceModelName(undefined), 'Unknown Device');
      assert.strictEqual(formatDeviceOsVersion(undefined), '');
      assert.strictEqual(formatDeviceDisplayName(undefined), 'Unknown Device');
      assert.strictEqual(formatDeviceSelectorLabel(undefined), 'Unknown Device');
    });

    test('handles empty object safely', () => {
      assert.strictEqual(formatDeviceModelName({}), 'Unknown Device');
      assert.strictEqual(formatDeviceOsVersion({}), '');
      assert.strictEqual(formatDeviceDisplayName({}), 'Unknown Device');
      assert.strictEqual(formatDeviceSelectorLabel({}), 'Unknown Device');
    });
  });

  describe('Scenario 8: Already Prefixed OS Versions', () => {
    test('avoids duplicate "Android Android 13"', () => {
      const dev = {
        manufacturer: 'Google',
        model: 'Pixel 8',
        osVersion: 'Android 15'
      };
      assert.strictEqual(formatDeviceOsVersion(dev), 'Android 15');
      assert.strictEqual(formatDeviceDisplayName(dev), 'Google Pixel 8 (Android 15)');
    });

    test('avoids duplicate "iOS iOS 18.5"', () => {
      const dev = {
        platform: 'ios',
        model: 'iPhone 15 Pro',
        osVersion: 'iOS 18.5'
      };
      assert.strictEqual(formatDeviceOsVersion(dev), 'iOS 18.5');
      assert.strictEqual(formatDeviceDisplayName(dev), 'iPhone 15 Pro (iOS 18.5)');
    });
  });

  describe('Scenario 9: API Level vs Release Version', () => {
    test('uses release version 13 instead of API level 33', () => {
      const dev = {
        manufacturer: 'vivo',
        model: 'V2143',
        osVersion: '13',
        apiLevel: 33,
        sdkVersion: '33'
      };
      assert.strictEqual(formatDeviceOsVersion(dev), 'Android 13');
      assert.strictEqual(formatDeviceDisplayName(dev), 'VIVO V2143 (Android 13)');
      assert.strictEqual(formatDeviceDisplayName(dev).includes('33'), false);
    });

    test('does not invent Android 33 when only API level 33 is present without release version', () => {
      const dev = {
        manufacturer: 'vivo',
        model: 'V2143',
        apiLevel: 33
      };
      assert.strictEqual(formatDeviceOsVersion(dev), '');
      assert.strictEqual(formatDeviceDisplayName(dev), 'VIVO V2143');
    });
  });

  describe('Scenario 10: Brand Normalization & Casing', () => {
    test('normalizes known acronym brands to uppercase', () => {
      assert.strictEqual(normalizeBrand('vivo'), 'VIVO');
      assert.strictEqual(normalizeBrand('oppo'), 'OPPO');
      assert.strictEqual(normalizeBrand('lg'), 'LG');
      assert.strictEqual(normalizeBrand('asus'), 'ASUS');
      assert.strictEqual(normalizeBrand('htc'), 'HTC');
      assert.strictEqual(normalizeBrand('zte'), 'ZTE');
    });

    test('normalizes other brands appropriately', () => {
      assert.strictEqual(normalizeBrand('oneplus'), 'OnePlus');
      assert.strictEqual(normalizeBrand('xiaomi'), 'Xiaomi');
      assert.strictEqual(normalizeBrand('samsung'), 'Samsung');
      assert.strictEqual(normalizeBrand('google'), 'Google');
    });
  });

  describe('Scenario 11: Idempotency of formatDeviceDisplayName', () => {
    test('does not double format when already formatted string is provided', () => {
      const already = 'VIVO V2143 (Android 13)';
      assert.strictEqual(formatDeviceDisplayName(already), 'VIVO V2143 (Android 13)');
    });

    test('does not double append OS when name already contains (Android 13)', () => {
      const dev = {
        name: 'VIVO V2143 (Android 13)',
        osVersion: '13'
      };
      assert.strictEqual(formatDeviceDisplayName(dev), 'VIVO V2143 (Android 13)');
    });
  });

  describe('Scenario 12: Preserving Internal Identifiers', () => {
    test('internal identifiers remain completely unchanged on device object', () => {
      const originalDev = {
        serial: '192.168.1.100:5555',
        hardwareSerial: 'R52X808W8QK',
        transportId: '12',
        udid: '00008101-001A',
        manufacturer: 'vivo',
        model: 'V2143',
        osVersion: '13'
      };
      const label = formatDeviceSelectorLabel(originalDev);
      assert.strictEqual(label, 'VIVO V2143 (Android 13) (192.168.1.100:5555)');
      // Original object unchanged
      assert.strictEqual(originalDev.serial, '192.168.1.100:5555');
      assert.strictEqual(originalDev.hardwareSerial, 'R52X808W8QK');
      assert.strictEqual(originalDev.transportId, '12');
      assert.strictEqual(originalDev.udid, '00008101-001A');
    });
  });
});
