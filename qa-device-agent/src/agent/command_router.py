"""
Agent Command Router.
Parses incoming server messages over WebSocket and dispatches them safely.
Enforces strict allowlist of inbound commands.
"""
import logging
import json
import time
from .command_executor import execute_command

logger = logging.getLogger("qa_device_agent.router")


class CommandRouter:
    def __init__(self, ws_client, heartbeat_mgr, discovery_mgr=None, diagnostics_fn=None):
        self.ws_client = ws_client
        self.heartbeat_mgr = heartbeat_mgr
        self.discovery_mgr = discovery_mgr
        self.diagnostics_fn = diagnostics_fn

    async def route_message(self, raw_payload: bytes):
        try:
            msg = json.loads(raw_payload.decode("utf-8"))
        except Exception as e:
            logger.warning(f"Received non-JSON message: {e}")
            return

        msg_type = msg.get("type")
        logger.debug(f"Handling inbound server message type: {msg_type}")

        if msg_type == "AGENT_CONNECTED":
            logger.info(f"Server acknowledged agent connection. Agent ID: {msg.get('agentId')}")

        elif msg_type == "AGENT_HEARTBEAT_ACK":
            self.heartbeat_mgr.handle_ack(msg)

        elif msg_type == "PING":
            await self.ws_client.send_json({"type": "PONG", "timestamp": msg.get("timestamp")})

        elif msg_type == "COMMAND_REQUEST":
            request_id = msg.get("requestId")
            command = msg.get("command")
            device_id = msg.get("deviceId")
            args = msg.get("args") or {}

            logger.info(f"[COMMAND_REQUEST] requestId={request_id}, command={command}, deviceId={device_id}")

            success, result, error = await execute_command(command, device_id, args)

            response_payload = {
                "type": "COMMAND_RESPONSE",
                "requestId": request_id,
                "agentId": self.ws_client.agent_id,
                "deviceId": device_id,
                "command": command,
                "success": success,
                "result": result,
                "error": error,
                "timestamp": int(time.time() * 1000)
            }

            await self.ws_client.send_json(response_payload)

        elif msg_type == "START_MIRROR_REQUEST":
            request_id = msg.get("requestId")
            device_id = msg.get("deviceId")
            quality = msg.get("quality", "720p")
            logger.info(f"[START_MIRROR_REQUEST] requestId={request_id}, deviceId={device_id}, quality={quality}")

            from .screen_stream import screen_stream_manager
            res = await screen_stream_manager.start_mirror(device_id, quality=quality)

            response_payload = {
                "type": "START_MIRROR_RESPONSE",
                "requestId": request_id,
                "agentId": self.ws_client.agent_id,
                "deviceId": device_id,
                "success": res.get("success", False),
                "port": res.get("port"),
                "streamUrl": res.get("streamUrl"),
                "viewerUrl": res.get("viewerUrl"),
                "resolution": res.get("resolution", "1170x2532"),
                "error": res.get("error"),
                "timestamp": int(time.time() * 1000)
            }
            await self.ws_client.send_json(response_payload)

        elif msg_type == "STOP_MIRROR_REQUEST":
            request_id = msg.get("requestId")
            device_id = msg.get("deviceId")
            logger.info(f"[STOP_MIRROR_REQUEST] requestId={request_id}, deviceId={device_id}")

            from .screen_stream import screen_stream_manager
            res = await screen_stream_manager.stop_mirror(device_id)

            response_payload = {
                "type": "STOP_MIRROR_RESPONSE",
                "requestId": request_id,
                "agentId": self.ws_client.agent_id,
                "deviceId": device_id,
                "success": res.get("success", True),
                "message": res.get("message"),
                "timestamp": int(time.time() * 1000)
            }
            await self.ws_client.send_json(response_payload)

        elif msg_type == "GET_MIRROR_STATUS_REQUEST":
            request_id = msg.get("requestId")
            device_id = msg.get("deviceId")

            from .screen_stream import screen_stream_manager
            status_data = screen_stream_manager.get_status(device_id)

            response_payload = {
                "type": "GET_MIRROR_STATUS_RESPONSE",
                "requestId": request_id,
                "agentId": self.ws_client.agent_id,
                "deviceId": device_id,
                "status": status_data,
                "timestamp": int(time.time() * 1000)
            }
            await self.ws_client.send_json(response_payload)

        elif msg_type in ("REFRESH_DEVICES", "REQUEST_DEVICES"):
            if self.discovery_mgr:
                logger.info("Server requested device scan refresh.")
                await self.discovery_mgr.scan_and_sync(is_initial=True)

        elif msg_type in ("DIAGNOSE", "REQUEST_DIAGNOSTICS"):
            if self.diagnostics_fn:
                diag = self.diagnostics_fn()
                await self.ws_client.send_json({
                    "type": "AGENT_DIAGNOSTICS",
                    "agentId": self.ws_client.agent_id,
                    "diagnostics": diag
                })

        elif msg_type == "ERROR":
            logger.error(f"Server sent error: {msg.get('message')}")

        else:
            logger.debug(f"Unhandled command type: {msg_type}")
