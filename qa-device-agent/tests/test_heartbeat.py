"""
Unit tests for HeartbeatManager and RTT calculations.
"""
import unittest
import asyncio
import time
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.agent.heartbeat import HeartbeatManager


class FakeWSClient:
    def __init__(self):
        self.agent_id = "AGENT-TEST"
        self.sent_messages = []
        self.is_connected = True

    async def send_json(self, data):
        self.sent_messages.append(data)


class TestHeartbeatManager(unittest.IsolatedAsyncioTestCase):
    async def test_heartbeat_ack_rtt_calculation(self):
        client = FakeWSClient()
        mgr = HeartbeatManager(client, interval_sec=1)

        now_ms = int(time.time() * 1000)
        mgr.pending_pings[now_ms] = time.time() - 0.025  # 25ms ago

        mgr.handle_ack({"clientTimestamp": now_ms, "serverTimestamp": now_ms + 10})
        self.assertIsNotNone(mgr.last_rtt_ms)
        self.assertGreaterEqual(mgr.last_rtt_ms, 20.0)


if __name__ == "__main__":
    unittest.main()
