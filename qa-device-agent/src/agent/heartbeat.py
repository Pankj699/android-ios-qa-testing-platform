"""
Agent Heartbeat Loop & Latency Tracker.
Sends periodic AGENT_HEARTBEAT frames to the Central QA Server and tracks RTT.
"""
import asyncio
import logging
import time
from .identity import collect_system_info

logger = logging.getLogger("qa_device_agent.heartbeat")


class HeartbeatManager:
    def __init__(self, ws_client, interval_sec=15, get_diagnostics_fn=None):
        self.ws_client = ws_client
        self.interval_sec = interval_sec
        self.get_diagnostics_fn = get_diagnostics_fn
        self.last_rtt_ms = None
        self.is_running = False
        self._task = None
        self.pending_pings = {}

    async def start(self):
        self.is_running = True
        self._task = asyncio.create_task(self._run_loop())

    async def stop(self):
        self.is_running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    def handle_ack(self, ack_payload):
        client_ts = ack_payload.get("clientTimestamp")
        if client_ts and client_ts in self.pending_pings:
            send_time = self.pending_pings.pop(client_ts)
            rtt = (time.time() - send_time) * 1000.0
            self.last_rtt_ms = round(rtt, 2)
            logger.debug(f"Heartbeat ACK received from server. RTT: {self.last_rtt_ms} ms")

    async def _run_loop(self):
        while self.is_running and self.ws_client.is_connected:
            try:
                now_ms = int(time.time() * 1000)
                self.pending_pings[now_ms] = time.time()

                # Clean old pending pings
                if len(self.pending_pings) > 20:
                    self.pending_pings.clear()

                diag = {}
                if self.get_diagnostics_fn:
                    try:
                        diag = self.get_diagnostics_fn()
                    except Exception as e:
                        logger.warning(f"Failed to gather diagnostics for heartbeat: {e}")

                heartbeat_payload = {
                    "type": "AGENT_HEARTBEAT",
                    "agentId": self.ws_client.agent_id,
                    "timestamp": now_ms,
                    "metrics": {
                        "rttMs": self.last_rtt_ms,
                        **diag
                    }
                }

                await self.ws_client.send_json(heartbeat_payload)
                await asyncio.sleep(self.interval_sec)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Heartbeat loop error: {e}")
                await asyncio.sleep(5)
