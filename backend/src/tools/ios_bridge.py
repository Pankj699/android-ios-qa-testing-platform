import sys
import json
import asyncio
import argparse

def get_device_model_name(product_type):
    # Mapping common Apple ProductTypes to friendly marketing names
    models = {
        'iPhone10,1': 'iPhone 8',
        'iPhone10,2': 'iPhone 8 Plus',
        'iPhone10,3': 'iPhone X',
        'iPhone10,4': 'iPhone 8',
        'iPhone10,5': 'iPhone 8 Plus',
        'iPhone10,6': 'iPhone X',
        'iPhone11,2': 'iPhone XS',
        'iPhone11,4': 'iPhone XS Max',
        'iPhone11,6': 'iPhone XS Max',
        'iPhone11,8': 'iPhone XR',
        'iPhone12,1': 'iPhone 11',
        'iPhone12,3': 'iPhone 11 Pro',
        'iPhone12,5': 'iPhone 11 Pro Max',
        'iPhone12,8': 'iPhone SE (2nd gen)',
        'iPhone13,1': 'iPhone 12 mini',
        'iPhone13,2': 'iPhone 12',
        'iPhone13,3': 'iPhone 12 Pro',
        'iPhone13,4': 'iPhone 12 Pro Max',
        'iPhone14,2': 'iPhone 13 Pro',
        'iPhone14,3': 'iPhone 13 Pro Max',
        'iPhone14,4': 'iPhone 13 mini',
        'iPhone14,5': 'iPhone 13',
        'iPhone14,6': 'iPhone SE (3rd gen)',
        'iPhone14,7': 'iPhone 14',
        'iPhone14,8': 'iPhone 14 Plus',
        'iPhone15,2': 'iPhone 14 Pro',
        'iPhone15,3': 'iPhone 14 Pro Max',
        'iPhone15,4': 'iPhone 15',
        'iPhone15,5': 'iPhone 15 Plus',
        'iPhone16,1': 'iPhone 15 Pro',
        'iPhone16,2': 'iPhone 15 Pro Max',
        'iPhone17,1': 'iPhone 16 Pro',
        'iPhone17,2': 'iPhone 16 Pro Max',
        'iPhone17,3': 'iPhone 16',
        'iPhone17,4': 'iPhone 16 Plus',
        'iPad11,1': 'iPad mini (5th gen)',
        'iPad11,2': 'iPad mini (5th gen)',
        'iPad11,3': 'iPad Air (3rd gen)',
        'iPad11,4': 'iPad Air (3rd gen)',
        'iPad11,6': 'iPad (8th gen)',
        'iPad11,7': 'iPad (8th gen)',
        'iPad12,1': 'iPad (9th gen)',
        'iPad12,2': 'iPad (9th gen)',
        'iPad13,1': 'iPad Air (4th gen)',
        'iPad13,2': 'iPad Air (4th gen)',
        'iPad13,4': 'iPad Pro 11-inch (3rd gen)',
        'iPad13,5': 'iPad Pro 11-inch (3rd gen)',
        'iPad13,6': 'iPad Pro 11-inch (3rd gen)',
        'iPad13,7': 'iPad Pro 11-inch (3rd gen)',
        'iPad13,8': 'iPad Pro 12.9-inch (5th gen)',
        'iPad13,9': 'iPad Pro 12.9-inch (5th gen)',
        'iPad13,10': 'iPad Pro 12.9-inch (5th gen)',
        'iPad13,11': 'iPad Pro 12.9-inch (5th gen)',
        'iPad13,16': 'iPad Air (5th gen)',
        'iPad13,17': 'iPad Air (5th gen)',
        'iPad13,18': 'iPad (10th gen)',
        'iPad13,19': 'iPad (10th gen)',
        'iPad14,1': 'iPad mini (6th gen)',
        'iPad14,2': 'iPad mini (6th gen)',
        'iPad14,3': 'iPad Pro 11-inch (4th gen)',
        'iPad14,4': 'iPad Pro 11-inch (4th gen)',
        'iPad14,5': 'iPad Pro 12.9-inch (6th gen)',
        'iPad14,6': 'iPad Pro 12.9-inch (6th gen)',
        'iPad14,8': 'iPad Air 11-inch (M2)',
        'iPad14,9': 'iPad Air 11-inch (M2)',
        'iPad14,10': 'iPad Air 13-inch (M2)',
        'iPad14,11': 'iPad Air 13-inch (M2)',
        'iPad16,3': 'iPad Pro 11-inch (M4)',
        'iPad16,4': 'iPad Pro 11-inch (M4)',
        'iPad16,5': 'iPad Pro 13-inch (M4)',
        'iPad16,6': 'iPad Pro 13-inch (M4)',
    }
    return models.get(product_type, product_type or 'iOS Device')

async def list_devices_async():
    devices = []
    try:
        from pymobiledevice3.usbmux import list_devices
        usbmux_devs = await list_devices()
        for d in usbmux_devs:
            udid = getattr(d, 'serial', None) or getattr(d, 'udid', None)
            conn_type = getattr(d, 'connection_type', 'USB')
            if not udid:
                continue
            
            # Default device record
            dev_info = {
                'udid': udid,
                'serial': udid,
                'name': 'iPhone',
                'model': 'iPhone',
                'productType': 'iPhone',
                'manufacturer': 'Apple',
                'platform': 'ios',
                'iosVersion': 'Unknown',
                'osVersion': 'iOS',
                'state': 'device',
                'connected': True,
                'isWireless': str(conn_type).lower() in ['network', 'wifi'],
                'connectionType': str(conn_type),
                'trustStatus': 'trusted',
                'trustMessage': None,
                'battery': 'N/A',
                'batteryStatus': '',
                'storageFree': 'N/A',
                'storageTotal': 'N/A',
                'screenResolution': '1170 × 2532'
            }

            # Attempt lockdown handshake to query deep device info
            try:
                from pymobiledevice3.lockdown import create_using_usbmux
                lockdown = await create_using_usbmux(serial=udid)
                all_values = await lockdown.get_value()
                dev_name = all_values.get('DeviceName') or all_values.get('UserAssignedDeviceName')
                prod_type = all_values.get('ProductType')
                prod_ver = all_values.get('ProductVersion')
                
                if dev_name:
                    dev_info['name'] = dev_name
                if prod_type:
                    dev_info['productType'] = prod_type
                    dev_info['model'] = get_device_model_name(prod_type)
                if prod_ver:
                    dev_info['iosVersion'] = prod_ver
                    dev_info['osVersion'] = f'iOS {prod_ver}'
                
                # Check battery
                try:
                    battery_info = await lockdown.get_value(domain='com.apple.mobile.battery')
                    if battery_info:
                        cap = battery_info.get('BatteryCurrentCapacity')
                        charging = battery_info.get('BatteryIsCharging', False)
                        if cap is not None:
                            dev_info['battery'] = f'{cap}%'
                            dev_info['batteryStatus'] = 'Charging' if charging else 'Discharging'
                except Exception:
                    pass

                # Check disk usage
                try:
                    disk_info = await lockdown.get_value(domain='com.apple.disk_usage')
                    if disk_info:
                        total_bytes = disk_info.get('TotalDiskCapacity')
                        free_bytes = disk_info.get('TotalDataAvailable')
                        if total_bytes:
                            dev_info['storageTotal'] = f'{total_bytes / (1024**3):.1f} GB'
                        if free_bytes:
                            dev_info['storageFree'] = f'{free_bytes / (1024**3):.1f} GB'
                except Exception:
                    pass

                # Query developer mode status if supported
                try:
                    dev_mode = all_values.get('DeveloperModeStatus')
                    if dev_mode is not None:
                        dev_info['developerMode'] = bool(dev_mode)
                except Exception:
                    pass

            except Exception as lock_err:
                err_str = str(lock_err).lower()
                if 'untrusted' in err_str or 'not trusted' in err_str or 'trust' in err_str:
                    dev_info['trustStatus'] = 'untrusted'
                    dev_info['trustMessage'] = 'Device is not trusted. Tap "Trust This Computer" and enter passcode on the device screen.'
                elif 'password' in err_str or 'passcode' in err_str or 'locked' in err_str:
                    dev_info['trustStatus'] = 'locked'
                    dev_info['trustMessage'] = 'Device is locked. Unlock the device with your passcode.'
                else:
                    dev_info['trustStatus'] = 'pairing_required'
                    dev_info['trustMessage'] = f'Lockdown note: {str(lock_err)[:80]}'

            devices.append(dev_info)
    except Exception as e:
        # usbmuxd unreachable or no devices connected
        pass

    return devices

def get_diagnostics():
    diag = {
        'pythonAvailable': True,
        'pythonVersion': sys.version,
        'pymobiledevice3Available': False,
        'pymobiledevice3Version': None,
        'usbmuxdReachable': False,
        'connectedDevicesCount': 0,
        'error': None
    }
    try:
        import pymobiledevice3
        diag['pymobiledevice3Available'] = True
        diag['pymobiledevice3Version'] = getattr(pymobiledevice3, '__version__', '11.x')
    except Exception as e:
        diag['error'] = f'pymobiledevice3 import failed: {str(e)}'
        return diag

    try:
        from pymobiledevice3.usbmux import list_devices
        devs = asyncio.run(list_devices())
        diag['usbmuxdReachable'] = True
        diag['connectedDevicesCount'] = len(devs)
    except Exception as e:
        diag['usbmuxdReachable'] = False
        diag['error'] = f'usbmuxd error: {str(e)}'

    return diag

def main():
    parser = argparse.ArgumentParser(description='iOS Bridge for QA Platform')
    subparsers = parser.add_subparsers(dest='command')
    
    list_p = subparsers.add_parser('list')
    info_p = subparsers.add_parser('info')
    info_p.add_argument('--udid', required=True)
    diag_p = subparsers.add_parser('diagnostics')
    
    args = parser.parse_args()
    
    if args.command == 'list' or not args.command:
        devs = asyncio.run(list_devices_async())
        print(json.dumps(devs))
    elif args.command == 'info':
        devs = asyncio.run(list_devices_async())
        match = next((d for d in devs if d['udid'] == args.udid), None)
        if match:
            print(json.dumps(match))
        else:
            print(json.dumps({'error': f'Device {args.udid} not found', 'connected': False}))
    elif args.command == 'diagnostics':
        d = get_diagnostics()
        print(json.dumps(d))

if __name__ == '__main__':
    main()
