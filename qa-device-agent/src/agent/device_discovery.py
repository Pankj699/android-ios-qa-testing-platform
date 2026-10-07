"""
Local USB iOS Device Discovery for QA Device Agent.
Discovers physically connected iPhones and iPads using pymobiledevice3 / usbmuxd.
Collects required metadata and tracks device connect/disconnect lifecycle without duplicate records.
"""
import asyncio
import inspect
import logging
import platform
import time

logger = logging.getLogger("qa_device_agent.discovery")

MODEL_MAPPINGS = {
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
    'iPhone17,5': 'iPhone 16e',
}


def get_model_name(product_type):
    return MODEL_MAPPINGS.get(product_type, product_type or "iPhone")


async def scan_local_ios_devices_async(agent_id=""):
    """
    Scans for physically connected USB iOS devices using pymobiledevice3.
    Returns a list of normalized device dictionaries.
    """
    devices = []
    
    try:
        from pymobiledevice3.usbmux import list_devices
    except ImportError:
        logger.warning("pymobiledevice3 is not installed. iOS device discovery disabled.")
        return devices

    try:
        res = list_devices()
        if inspect.isawaitable(res):
            raw_mux_devices = await res
        else:
            raw_mux_devices = res
    except Exception as e:
        logger.debug(f"usbmux list_devices error: {e}")
        return devices

    for dev in raw_mux_devices:
        try:
            conn_type = getattr(dev, "connection_type", "USB")
            # Filter strictly to USB connections
            if str(conn_type).upper() not in ("USB", ""):
                continue

            udid = getattr(dev, "serial", None) or getattr(dev, "udid", None)
            if not udid:
                continue

            device_name = "iPhone"
            product_type = "iPhone"
            os_version = "Unknown"
            trust_status = "trusted"
            trust_message = None

            # Attempt lockdown query to get name, product type, and OS version
            try:
                from pymobiledevice3.lockdown import create_using_usbmux
                lock_res = create_using_usbmux(serial=udid)
                lockdown = await lock_res if inspect.isawaitable(lock_res) else lock_res
                
                val_res = lockdown.get_value()
                all_values = await val_res if inspect.isawaitable(val_res) else val_res
                all_values = all_values or {}

                device_name = all_values.get("DeviceName") or all_values.get("UserAssignedDeviceName") or "iPhone"
                product_type = all_values.get("ProductType") or "iPhone"
                os_version = all_values.get("ProductVersion") or "Unknown"
            except Exception as e:
                err_str = str(e).lower()
                if "pair" in err_str or "trust" in err_str:
                    trust_status = "untrusted"
                    trust_message = "Device is not trusted. Please unlock your iPhone and tap 'Trust This Computer'."
                elif "password" in err_str or "passcode" in err_str or "lock" in err_str:
                    trust_status = "locked"
                    trust_message = "Device is locked with a passcode. Please unlock your device."
                else:
                    logger.debug(f"Lockdown query skipped for {udid}: {e}")

            formatted_os = f"iOS {os_version}" if os_version and not str(os_version).startswith("iOS") else (os_version or "iOS")

            normalized = {
                "udid": udid,
                "serial": udid,
                "deviceId": udid,
                "name": device_name,
                "model": get_model_name(product_type),
                "productType": product_type,
                "manufacturer": "Apple",
                "platform": "ios",
                "iosVersion": str(os_version),
                "osVersion": formatted_os,
                "connectionType": "usb",
                "connectionMode": "agent-usb",
                "state": "device",
                "connected": True,
                "trustStatus": trust_status,
                "trustMessage": trust_message,
                "agentId": agent_id,
                "discoveredAt": int(time.time() * 1000)
            }

            devices.append(normalized)

        except Exception as e:
            logger.warning(f"Error inspecting device entry: {e}")

    return devices


def scan_local_ios_devices(agent_id=""):
    """Synchronous wrapper for scan_local_ios_devices_async."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(asyncio.run, scan_local_ios_devices_async(agent_id))
                return future.result()
        else:
            return loop.run_until_complete(scan_local_ios_devices_async(agent_id))
    except Exception:
        return asyncio.run(scan_local_ios_devices_async(agent_id))


class DeviceDiscoveryManager:
    """
    Monitors local USB iOS devices periodically and dispatches WebSocket events
    for DEVICE_CONNECTED, DEVICE_DISCONNECTED, and DEVICE_LIST.
    """

    def __init__(self, ws_client, scan_interval_sec=4):
        self.ws_client = ws_client
        self.scan_interval_sec = scan_interval_sec
        self.active_devices = {}  # udid -> device dict
        self.is_running = False
        self._task = None

    async def start(self):
        self.is_running = True
        # Send initial snapshot immediately upon starting
        await self.scan_and_sync(is_initial=True)
        self._task = asyncio.create_task(self._run_loop())

    async def stop(self):
        self.is_running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def scan_and_sync(self, is_initial=False):
        """Scans devices and sends diff events or initial full list."""
        if not self.ws_client or not self.ws_client.is_connected:
            return

        found_list = await scan_local_ios_devices_async(self.ws_client.agent_id)
        current_map = {d["udid"]: d for d in found_list}

        now_ms = int(time.time() * 1000)

        if is_initial:
            self.active_devices = current_map
            logger.info(f"Discovered {len(found_list)} local USB iOS device(s) on startup.")
            await self.ws_client.send_json({
                "type": "DEVICE_LIST",
                "agentId": self.ws_client.agent_id,
                "devices": found_list,
                "timestamp": now_ms
            })
            return

        # 1. Detect newly connected or updated devices
        for udid, dev in current_map.items():
            if udid not in self.active_devices:
                logger.info(f"[Device Connected] {dev['name']} ({udid}) via USB")
                self.active_devices[udid] = dev
                await self.ws_client.send_json({
                    "type": "DEVICE_CONNECTED",
                    "agentId": self.ws_client.agent_id,
                    "device": dev,
                    "timestamp": now_ms
                })
            else:
                # Update metadata if trust status or name changed
                old_dev = self.active_devices[udid]
                if old_dev.get("trustStatus") != dev.get("trustStatus") or old_dev.get("name") != dev.get("name"):
                    self.active_devices[udid] = dev
                    await self.ws_client.send_json({
                        "type": "DEVICE_CONNECTED",
                        "agentId": self.ws_client.agent_id,
                        "device": dev,
                        "timestamp": now_ms
                    })

        # 2. Detect disconnected devices
        disconnected_udids = [udid for udid in self.active_devices if udid not in current_map]
        for udid in disconnected_udids:
            old_dev = self.active_devices.pop(udid, None)
            dev_name = old_dev.get("name", "iOS Device") if old_dev else "iOS Device"
            logger.info(f"[Device Disconnected] {dev_name} ({udid}) removed from USB")
            await self.ws_client.send_json({
                "type": "DEVICE_DISCONNECTED",
                "agentId": self.ws_client.agent_id,
                "udid": udid,
                "timestamp": now_ms
            })

    async def _run_loop(self):
        while self.is_running and self.ws_client.is_connected:
            try:
                await asyncio.sleep(self.scan_interval_sec)
                await self.scan_and_sync(is_initial=False)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Device discovery loop error: {e}")
                await asyncio.sleep(5)
