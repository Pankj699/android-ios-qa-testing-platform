/**
 * deviceTransportFactory.js
 * Factory to instantiate and return the correct AndroidDeviceTransport implementation
 * based on device connectionMode and properties.
 */

import { ServerAdbTransport } from './ServerAdbTransport';
import { BrowserAdbTransport } from './BrowserAdbTransport';
import { BrowserWirelessTransport } from './BrowserWirelessTransport';
import { webUsbAdbService } from '../webUsbAdbService';

export function getDeviceTransport(device) {
  if (!device) return null;

  if (
    device.connectionMode === 'browser-usb' ||
    device.serial?.startsWith('browser_usb_') ||
    device.id?.startsWith('browser_usb_')
  ) {
    return new BrowserAdbTransport(device, webUsbAdbService);
  }

  if (device.connectionMode === 'browser-wireless') {
    return new BrowserWirelessTransport(device);
  }

  return new ServerAdbTransport(device);
}

export { AndroidDeviceTransport } from './AndroidDeviceTransport';
export { ServerAdbTransport } from './ServerAdbTransport';
export { BrowserAdbTransport } from './BrowserAdbTransport';
export { BrowserWirelessTransport } from './BrowserWirelessTransport';
