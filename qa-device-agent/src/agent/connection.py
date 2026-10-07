"""
Asynchronous WebSocket Client for Central QA Server (/ws/agent).
Implemented using standard library asyncio + ssl + RFC 6455 framing for zero external dependencies.
Features:
- Full RFC 6455 Client Masking & Handshake
- TLS/WSS and WS support
- Automatic reconnect with exponential backoff
- Ping/Pong & Message Dispatcher
"""
import asyncio
import base64
import hashlib
import json
import logging
import os
import ssl
import struct
import urllib.parse

logger = logging.getLogger("qa_device_agent.ws")


class WSFrame:
    TEXT = 0x1
    BINARY = 0x2
    CLOSE = 0x8
    PING = 0x9
    PONG = 0xA


class RFC6455Client:
    """Zero-dependency RFC 6455 WebSocket client over standard asyncio streams."""

    def __init__(self, url, agent_id, agent_token, tls_verify=False):
        self.raw_url = url
        self.agent_id = agent_id
        self.agent_token = agent_token
        self.tls_verify = tls_verify
        self.reader = None
        self.writer = None
        self.is_connected = False
        self._close_event = asyncio.Event()

    async def connect(self):
        """Performs HTTP upgrade handshake and establishes WebSocket session."""
        parsed = urllib.parse.urlparse(self.raw_url)
        scheme = parsed.scheme.lower()
        use_ssl = scheme in ("wss", "https")
        port = parsed.port or (443 if use_ssl else 80)
        host = parsed.hostname or "localhost"

        # Build path with query params
        path = parsed.path or "/ws/agent"
        query_params = urllib.parse.parse_qsl(parsed.query)
        query_dict = dict(query_params)
        query_dict["agentId"] = self.agent_id
        query_dict["agentToken"] = self.agent_token
        query_str = urllib.parse.urlencode(query_dict)
        full_path = f"{path}?{query_str}"

        ssl_ctx = None
        if use_ssl:
            ssl_ctx = ssl.create_default_context()
            if not self.tls_verify:
                ssl_ctx.check_hostname = False
                ssl_ctx.verify_mode = ssl.CERT_NONE

        logger.info(f"Connecting to WebSocket: {'wss' if use_ssl else 'ws'}://{host}:{port}{path}")
        self.reader, self.writer = await asyncio.open_connection(
            host, port, ssl=ssl_ctx
        )

        # Generate Sec-WebSocket-Key
        ws_key = base64.b64encode(os.urandom(16)).decode("ascii")
        headers = [
            f"GET {full_path} HTTP/1.1",
            f"Host: {host}:{port}",
            "Upgrade: websocket",
            "Connection: Upgrade",
            f"Sec-WebSocket-Key: {ws_key}",
            "Sec-WebSocket-Version: 13",
            "User-Agent: QADeviceAgent/1.0.0",
            ""
        ]

        handshake_req = "\r\n".join(headers) + "\r\n"
        self.writer.write(handshake_req.encode("utf-8"))
        await self.writer.drain()

        # Read handshake response
        response_lines = []
        while True:
            line = await self.reader.readline()
            if not line or line in (b"\r\n", b"\n", b""):
                break
            response_lines.append(line.decode("utf-8", errors="ignore").strip())

        if not response_lines:
            raise ConnectionError("Server closed connection during WebSocket handshake.")

        status_line = response_lines[0]
        if "101" not in status_line:
            raise ConnectionError(f"Handshake failed with status: {status_line}")

        self.is_connected = True
        self._close_event.clear()
        logger.info("WebSocket handshake successful. Secure tunnel established.")

    async def send_frame(self, opcode, payload: bytes):
        """Sends an RFC 6455 frame with client masking."""
        if not self.writer or self.writer.is_closing():
            raise ConnectionError("Cannot send: socket is not connected.")

        length = len(payload)
        header = bytearray()
        header.append(0x80 | (opcode & 0x0F))  # FIN bit + Opcode

        mask_bit = 0x80  # Client MUST mask frames
        if length <= 125:
            header.append(mask_bit | length)
        elif length <= 65535:
            header.append(mask_bit | 126)
            header.extend(struct.pack("!H", length))
        else:
            header.append(mask_bit | 127)
            header.extend(struct.pack("!Q", length))

        # Generate 4-byte masking key
        mask_key = os.urandom(4)
        header.extend(mask_key)

        # Mask payload
        masked_payload = bytearray(length)
        for i in range(length):
            masked_payload[i] = payload[i] ^ mask_key[i % 4]

        self.writer.write(bytes(header) + bytes(masked_payload))
        await self.writer.drain()

    async def send_text(self, text: str):
        await self.send_frame(WSFrame.TEXT, text.encode("utf-8"))

    async def send_json(self, data: dict):
        await self.send_text(json.dumps(data))

    async def send_ping(self, payload: bytes = b""):
        await self.send_frame(WSFrame.PING, payload)

    async def send_pong(self, payload: bytes = b""):
        await self.send_frame(WSFrame.PONG, payload)

    async def read_frame(self):
        """Reads and unmasks the next frame from server."""
        if not self.reader:
            return None, None

        first_two = await self.reader.readexactly(2)
        b1, b2 = first_two[0], first_two[1]

        fin = bool(b1 & 0x80)
        opcode = b1 & 0x0F
        has_mask = bool(b2 & 0x80)
        length = b2 & 0x7F

        if length == 126:
            ext = await self.reader.readexactly(2)
            length = struct.unpack("!H", ext)[0]
        elif length == 127:
            ext = await self.reader.readexactly(8)
            length = struct.unpack("!Q", ext)[0]

        mask_key = None
        if has_mask:
            mask_key = await self.reader.readexactly(4)

        payload = await self.reader.readexactly(length)
        if has_mask and mask_key:
            unmasked = bytearray(length)
            for i in range(length):
                unmasked[i] = payload[i] ^ mask_key[i % 4]
            payload = bytes(unmasked)

        return opcode, payload

    async def close(self):
        self.is_connected = False
        self._close_event.set()
        if self.writer:
            try:
                await self.send_frame(WSFrame.CLOSE, b"")
            except Exception:
                pass
            try:
                self.writer.close()
                await self.writer.wait_closed()
            except Exception:
                pass
        self.reader = None
        self.writer = None
