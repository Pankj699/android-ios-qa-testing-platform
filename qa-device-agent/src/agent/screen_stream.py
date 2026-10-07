"""
Agent-Based iOS Live Screen Stream Manager.
Manages physical iOS hardware display streaming sessions via CoreDevice RemoteXPC and ScreenStreamServer.
Enforces low-latency, real-time H.264 (AVC) RTP reassembly and Annex-B video generation.
"""
import asyncio
import contextlib
import logging
import socket
import time
from typing import Dict, Optional, Any

logger = logging.getLogger("qa_device_agent.screen_stream")


def find_available_port(start_port: int = 19200) -> int:
    """Finds an available local port for the loopback stream server."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class ActiveMirrorSession:
    def __init__(self, udid: str, port: int, server_instance: Any, task: asyncio.Task):
        self.udid = udid
        self.port = port
        self.server_instance = server_instance
        self.task = task
        self.started_at = time.time()
        self.resolution = "1170x2532"
        self.status = "RUNNING"


class ScreenStreamManager:
    def __init__(self):
        self.active_sessions: Dict[str, ActiveMirrorSession] = {}
        self._lock = asyncio.Lock()

    async def start_mirror(self, udid: str, quality: str = "720p", custom_port: Optional[int] = None) -> Dict[str, Any]:
        """
        Starts a live hardware display stream session for the physical iOS device.
        """
        async with self._lock:
            # Check if session already active
            if udid in self.active_sessions:
                existing = self.active_sessions[udid]
                if not existing.task.done():
                    logger.info(f"Reusing existing mirror session for {udid} on port {existing.port}")
                    return {
                        "success": True,
                        "udid": udid,
                        "port": existing.port,
                        "streamUrl": f"http://127.0.0.1:{existing.port}/stream.bin",
                        "viewerUrl": f"http://127.0.0.1:{existing.port}/",
                        "resolution": existing.resolution,
                        "startedAt": existing.started_at,
                        "reused": True
                    }
                else:
                    del self.active_sessions[udid]

            port = custom_port or find_available_port()
            logger.info(f"Initiating CoreDevice display stream for {udid} on 127.0.0.1:{port}...")

            try:
                # Dynamic imports to preserve fast startup and allow test mocking
                from pymobiledevice3.remote import userspace_tunnel
                from pymobiledevice3.remote.core_device.screen_stream import ScreenStreamServer

                logger.info(f"Connecting to RSD tunnel for device {udid}...")
                rsd = await userspace_tunnel.establish_userspace_rsd(serial=udid)
                logger.info(f"RSD tunnel established for {udid}: {rsd}")

                server = ScreenStreamServer(
                    rsd,
                    bind="0.0.0.0",
                    http_port=port,
                    audio_default_on=False,
                    allow_rtcp_fb=False,
                    ltrp_enabled=False
                )

                # Spawn stream server task
                stream_task = asyncio.create_task(server.serve(), name=f"screen_stream_{udid}")

                # Wait for port to become active
                is_ready = False
                for _ in range(30):
                    await asyncio.sleep(0.2)
                    if stream_task.done():
                        exc = stream_task.exception()
                        raise RuntimeError(f"Stream server exited prematurely: {exc}")
                    
                    # Test TCP port connect
                    try:
                        _, writer = await asyncio.wait_for(
                            asyncio.open_connection("127.0.0.1", port),
                            timeout=0.3
                        )
                        writer.close()
                        await writer.wait_closed()
                        is_ready = True
                        break
                    except Exception:
                        pass

                if not is_ready:
                    stream_task.cancel()
                    raise TimeoutError(f"Stream server on port {port} failed to accept connections within 6 seconds.")

                session = ActiveMirrorSession(udid=udid, port=port, server_instance=server, task=stream_task)
                self.active_sessions[udid] = session

                logger.info(f"iOS Live Stream active on http://127.0.0.1:{port}/stream.bin for {udid}")

                return {
                    "success": True,
                    "udid": udid,
                    "port": port,
                    "streamUrl": f"http://127.0.0.1:{port}/stream.bin",
                    "viewerUrl": f"http://127.0.0.1:{port}/",
                    "resolution": session.resolution,
                    "startedAt": session.started_at,
                    "reused": False
                }

            except Exception as e:
                logger.exception(f"Failed to start iOS screen mirror for {udid}: {e}")
                return {
                    "success": False,
                    "udid": udid,
                    "error": str(e),
                    "code": "MIRROR_START_FAILED"
                }

    async def stop_mirror(self, udid: str) -> Dict[str, Any]:
        """
        Stops active display stream session and cleans up device connections.
        """
        async with self._lock:
            if udid not in self.active_sessions:
                return {"success": True, "message": "No active mirror session to stop.", "udid": udid}

            session = self.active_sessions.pop(udid)
            logger.info(f"Stopping mirror session for {udid} on port {session.port}...")

            try:
                session.task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await asyncio.wait_for(session.task, timeout=2.0)
            except Exception as e:
                logger.warning(f"Error during mirror task cancellation for {udid}: {e}")

            return {
                "success": True,
                "message": f"Mirror session for {udid} stopped.",
                "udid": udid
            }

    async def stop_all(self):
        """Stops all active mirror sessions on agent shutdown."""
        udids = list(self.active_sessions.keys())
        for udid in udids:
            await self.stop_mirror(udid)

    def get_status(self, udid: str) -> Dict[str, Any]:
        """Queries status of an active mirror session."""
        session = self.active_sessions.get(udid)
        if not session or session.task.done():
            return {"active": False, "udid": udid}

        return {
            "active": True,
            "udid": udid,
            "port": session.port,
            "streamUrl": f"http://127.0.0.1:{session.port}/stream.bin",
            "viewerUrl": f"http://127.0.0.1:{session.port}/",
            "uptimeSeconds": round(time.time() - session.started_at, 1),
            "resolution": session.resolution
        }


# Global singleton instance
screen_stream_manager = ScreenStreamManager()
