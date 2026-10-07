"""
Comprehensive unit tests for DeviceDiscoveryManager, metadata normalization,
lifecycle events, and duplicate prevention.
"""
import unittest
import asyncio
from unittest.mock import patch, MagicMock
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.agent.device_discovery import (
    DeviceDiscoveryManager,
    scan_local_ios_devices_async,
    get_model_name
)


class FakeWSClient:
    def __init__(self):
        self.agent_id = "AGENT-WIN-TEST-01"
        self.is_connected = True
        self.sent_events = []

    async def send_json(self, data):
        self.sent_events.append(data)


class TestDeviceDiscoveryComprehensive(unittest.IsolatedAsyncioTestCase):
    def test_model_name_mapping(self):
        self.assertEqual(get_model_name("iPhone17,5"), "iPhone 16e")
        self.assertEqual(get_model_name("iPhone16,1"), "iPhone 15 Pro")
        self.assertEqual(get_model_name("iPhone14,2"), "iPhone 13 Pro")
        self.assertEqual(get_model_name("CustomProduct"), "CustomProduct")

    async def test_device_discovery_lifecycle_and_duplicate_prevention(self):
        client = FakeWSClient()
        mgr = DeviceDiscoveryManager(client, scan_interval_sec=1)

        fake_device_1 = {
            "udid": "00008140-0005596A36E9801C",
            "serial": "00008140-0005596A36E9801C",
            "deviceId": "00008140-0005596A36E9801C",
            "name": "iPhone 16e - 3",
            "model": "iPhone 16e",
            "productType": "iPhone17,5",
            "platform": "ios",
            "osVersion": "iOS 26.4.2",
            "iosVersion": "26.4.2",
            "connectionType": "usb",
            "connectionMode": "agent-usb",
            "state": "device",
            "connected": True,
            "trustStatus": "trusted",
            "agentId": client.agent_id
        }

        # 1. Initial snapshot with 1 device
        with patch("src.agent.device_discovery.scan_local_ios_devices_async", return_value=[fake_device_1]):
            await mgr.scan_and_sync(is_initial=True)

        self.assertEqual(len(client.sent_events), 1)
        event1 = client.sent_events[-1]
        self.assertEqual(event1["type"], "DEVICE_LIST")
        self.assertEqual(len(event1["devices"]), 1)
        self.assertEqual(event1["devices"][0]["udid"], "00008140-0005596A36E9801C")

        # 2. Device Disconnected
        with patch("src.agent.device_discovery.scan_local_ios_devices_async", return_value=[]):
            await mgr.scan_and_sync(is_initial=False)

        self.assertEqual(len(client.sent_events), 2)
        event2 = client.sent_events[-1]
        self.assertEqual(event2["type"], "DEVICE_DISCONNECTED")
        self.assertEqual(event2["udid"], "00008140-0005596A36E9801C")

        # 3. Device Reconnects (same UDID) -> verify no duplicate, dispatches DEVICE_CONNECTED
        with patch("src.agent.device_discovery.scan_local_ios_devices_async", return_value=[fake_device_1]):
            await mgr.scan_and_sync(is_initial=False)

        self.assertEqual(len(client.sent_events), 3)
        event3 = client.sent_events[-1]
        self.assertEqual(event3["type"], "DEVICE_CONNECTED")
        self.assertEqual(event3["device"]["udid"], "00008140-0005596A36E9801C")
        self.assertEqual(event3["device"]["agentId"], "AGENT-WIN-TEST-01")

        # Active devices map has exactly 1 entry for this UDID
        self.assertEqual(len(mgr.active_devices), 1)
        self.assertIn("00008140-0005596A36E9801C", mgr.active_devices)


if __name__ == "__main__":
    unittest.main()
