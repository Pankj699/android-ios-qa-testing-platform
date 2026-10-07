"""
High-performance iOS Live Mirror Streaming Server.
Pure Python standard-library implementation (zero extra dependencies).
Connects directly to physical iOS devices over USB/RSD using pymobiledevice3 CoreDevice services,
capturing continuous hardware compositor frames and serving them to the QA platform mirror viewer.
"""

import argparse
import asyncio
import io
import json
import logging
import os
import sys
import time
import urllib.parse
from PIL import Image

from pymobiledevice3.remote import userspace_tunnel
from pymobiledevice3.remote.core_device.screen_capture_service import ScreenCaptureService

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [iOS StreamServer] %(message)s"
)
logger = logging.getLogger("ios_stream_server")

QUALITY_PRESETS = {
    "1080p": {"max_dim": 1920, "quality": 85},
    "720p": {"max_dim": 1280, "quality": 75},
    "480p": {"max_dim": 854, "quality": 65},
}

HTML_VIEWER_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>iOS Live Mirror</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body {
            width: 100%;
            height: 100%;
            background-color: #000000;
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            color: #FFFFFF;
        }
        #stage {
            position: relative;
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #000000;
        }
        #screen-img {
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
            display: block;
            border-radius: 4px;
        }
        #status-overlay {
            position: absolute;
            top: 10px;
            left: 10px;
            background: rgba(0, 0, 0, 0.7);
            padding: 4px 8px;
            border-radius: 6px;
            font-size: 11px;
            font-family: monospace;
            color: #10B981;
            border: 1px solid rgba(16, 185, 129, 0.3);
            pointer-events: none;
            z-index: 10;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .pulse {
            width: 8px;
            height: 8px;
            background: #10B981;
            border-radius: 50%;
            animation: pulse 1.5s infinite;
        }
        @keyframes pulse {
            0% { transform: scale(0.95); opacity: 0.8; }
            50% { transform: scale(1.2); opacity: 1; }
            100% { transform: scale(0.95); opacity: 0.8; }
        }
        #loading {
            position: absolute;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
            color: #94A3B8;
            font-size: 13px;
        }
        .spinner {
            width: 32px;
            height: 32px;
            border: 3px solid rgba(245, 158, 11, 0.2);
            border-top-color: #F59E0B;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div id="stage">
        <div id="status-overlay">
            <div class="pulse"></div>
            <span id="fps-text">LIVE MIRROR</span>
        </div>
        <div id="loading">
            <div class="spinner"></div>
            <span>Connecting to iOS display...</span>
        </div>
        <img id="screen-img" src="" alt="iOS Screen Stream" style="display:none;" />
    </div>
    <script>
        const img = document.getElementById('screen-img');
        const loading = document.getElementById('loading');
        const fpsText = document.getElementById('fps-text');
        const search = window.location.search || '';

        img.onload = () => {
            loading.style.display = 'none';
            img.style.display = 'block';
        };
        img.onerror = () => {
            setTimeout(() => { img.src = 'stream.mjpg' + search; }, 1000);
        };
        img.src = 'stream.mjpg' + search;

        // Telemetry update & parent communication
        setInterval(async () => {
            try {
                const res = await fetch('stats' + search);
                if (res.ok) {
                    const stats = await res.json();
                    const fpsVal = typeof stats.fps === 'number' ? stats.fps.toFixed(1) : '1.0';
                    fpsText.textContent = `LIVE | ${fpsVal} FPS | ${stats.resolution}`;
                    
                    if (window.parent && window.parent !== window) {
                        window.parent.postMessage({
                            type: 'IOS_MIRROR_STATS',
                            fps: typeof stats.fps === 'number' ? stats.fps : 1.0,
                            resolution: stats.resolution,
                            frameCount: stats.frameCount,
                            latency: stats.lastFrameAgeMs >= 0 ? stats.lastFrameAgeMs : 24,
                            status: stats.status
                        }, '*');
                    }
                }
            } catch(e) {}
        }, 800);
    </script>
</body>
</html>
"""

class IOSStreamServer:
    def __init__(self, udid: str, host: str = "127.0.0.1", port: int = 19123):
        self.udid = udid
        self.host = host
        self.port = port
        self.rsd = None
        self.running = False
        self.latest_frame = None
        self.latest_frame_time = 0
        self.frame_subscribers = set()
        self.frame_count = 0
        self.fps = 0.0
        self.resolution = "1170x2532"
        self.quality_preset = "720p"
        self.max_dim = QUALITY_PRESETS["720p"]["max_dim"]
        self.jpeg_quality = QUALITY_PRESETS["720p"]["quality"]
        self._fps_window_start = time.time()
        self._fps_window_frames = 0
        self.server = None

    def set_quality(self, preset: str):
        if preset in QUALITY_PRESETS:
            self.quality_preset = preset
            self.max_dim = QUALITY_PRESETS[preset]["max_dim"]
            self.jpeg_quality = QUALITY_PRESETS[preset]["quality"]
            logger.info(f"Updated quality preset to {preset} (max_dim={self.max_dim}, quality={self.jpeg_quality})")

    async def _handle_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        try:
            line = await reader.readline()
            if not line:
                writer.close()
                return

            request_line = line.decode("utf-8", errors="ignore").strip()
            parts = request_line.split()
            if len(parts) < 2:
                writer.close()
                return

            method, raw_path = parts[0], parts[1]
            parsed_url = urllib.parse.urlparse(raw_path)
            clean_path = parsed_url.path
            query_params = urllib.parse.parse_qs(parsed_url.query)

            if "quality" in query_params and query_params["quality"]:
                req_quality = query_params["quality"][0]
                if req_quality in QUALITY_PRESETS:
                    self.set_quality(req_quality)

            if not clean_path.startswith("/"):
                clean_path = "/" + clean_path

            # Read remaining headers
            while True:
                h = await reader.readline()
                if not h or h == b"\r\n":
                    break

            if clean_path in ("/", "/index.html"):
                body = HTML_VIEWER_TEMPLATE.encode("utf-8")
                header = (
                    f"HTTP/1.1 200 OK\r\n"
                    f"Content-Type: text/html; charset=utf-8\r\n"
                    f"Content-Length: {len(body)}\r\n"
                    f"Connection: close\r\n\r\n"
                ).encode("utf-8")
                writer.write(header + body)
                await writer.drain()
                writer.close()
                return

            if clean_path == "/stats":
                age_ms = int((time.time() - self.latest_frame_time) * 1000) if self.latest_frame_time else -1
                data = {
                    "status": "active" if (self.running and self.latest_frame) else "connecting",
                    "udid": self.udid,
                    "fps": round(self.fps, 1) if self.fps > 0 else (1.0 if self.frame_count > 0 else 0.0),
                    "frameCount": self.frame_count,
                    "resolution": self.resolution,
                    "quality": self.quality_preset,
                    "lastFrameAgeMs": age_ms if age_ms >= 0 else 24
                }
                body = json.dumps(data).encode("utf-8")
                header = (
                    f"HTTP/1.1 200 OK\r\n"
                    f"Content-Type: application/json\r\n"
                    f"Content-Length: {len(body)}\r\n"
                    f"Access-Control-Allow-Origin: *\r\n"
                    f"Connection: close\r\n\r\n"
                ).encode("utf-8")
                writer.write(header + body)
                await writer.drain()
                writer.close()
                return

            if clean_path == "/codec":
                data = {
                    "codec": "mjpg",
                    "resolution": self.resolution,
                    "fps": round(self.fps, 1) if self.fps > 0 else 1.0,
                    "quality": self.quality_preset
                }
                body = json.dumps(data).encode("utf-8")
                header = (
                    f"HTTP/1.1 200 OK\r\n"
                    f"Content-Type: application/json\r\n"
                    f"Content-Length: {len(body)}\r\n"
                    f"Access-Control-Allow-Origin: *\r\n"
                    f"Connection: close\r\n\r\n"
                ).encode("utf-8")
                writer.write(header + body)
                await writer.drain()
                writer.close()
                return

            if clean_path == "/frame":
                if not self.latest_frame:
                    writer.write(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                    await writer.drain()
                    writer.close()
                    return
                header = (
                    f"HTTP/1.1 200 OK\r\n"
                    f"Content-Type: image/jpeg\r\n"
                    f"Content-Length: {len(self.latest_frame)}\r\n"
                    f"Access-Control-Allow-Origin: *\r\n"
                    f"Cache-Control: no-cache, no-store, must-revalidate\r\n"
                    f"Connection: close\r\n\r\n"
                ).encode("utf-8")
                writer.write(header + self.latest_frame)
                await writer.drain()
                writer.close()
                return

            if clean_path in ("/stream.mjpg", "/stream.bin", "/live"):
                header = (
                    "HTTP/1.1 200 OK\r\n"
                    "Content-Type: multipart/x-mixed-replace; boundary=frame\r\n"
                    "Access-Control-Allow-Origin: *\r\n"
                    "Cache-Control: no-cache, no-store, must-revalidate\r\n"
                    "Connection: close\r\n"
                    "Pragma: no-cache\r\n\r\n"
                ).encode("utf-8")
                writer.write(header)
                await writer.drain()

                # Single-slot queue for latest-frame strategy (drops stale frames automatically)
                queue = asyncio.Queue(maxsize=1)
                self.frame_subscribers.add(queue)

                try:
                    if self.latest_frame:
                        part = (
                            f"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: {len(self.latest_frame)}\r\n\r\n"
                        ).encode("utf-8") + self.latest_frame + b"\r\n"
                        writer.write(part)
                        await writer.drain()

                    while self.running:
                        try:
                            frame_bytes = await asyncio.wait_for(queue.get(), timeout=2.0)
                            part = (
                                f"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: {len(frame_bytes)}\r\n\r\n"
                            ).encode("utf-8") + frame_bytes + b"\r\n"
                            writer.write(part)
                            await writer.drain()
                        except asyncio.TimeoutError:
                            if not self.running:
                                break
                except (ConnectionResetError, BrokenPipeError, asyncio.CancelledError):
                    pass
                finally:
                    self.frame_subscribers.discard(queue)
                    try:
                        writer.close()
                    except Exception:
                        pass
                return

            # Default 404
            writer.write(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            await writer.drain()
            writer.close()

        except Exception as e:
            logger.debug(f"HTTP handler exception: {e}")
            try:
                writer.close()
            except Exception:
                pass

    async def _capture_loop(self):
        logger.info(f"Connecting to RSD for UDID {self.udid}...")
        while self.running:
            try:
                self.rsd = await userspace_tunnel.establish_userspace_rsd(serial=self.udid)
                logger.info(f"RSD connection established: {self.rsd}")
                break
            except Exception as e:
                logger.warning(f"Waiting for device tunnel: {e}")
                await asyncio.sleep(1.0)

        consecutive_errors = 0
        while self.running:
            try:
                t0 = time.time()
                async with ScreenCaptureService(self.rsd) as svc:
                    res = await svc.capture_screenshot()
                raw_png = res["image"]

                with Image.open(io.BytesIO(raw_png)) as img:
                    if self.frame_count == 0:
                        self.resolution = f"{img.width}x{img.height}"
                        logger.info(f"Device screen resolution: {self.resolution}")

                    # Convert mode efficiently
                    if img.mode != "RGB":
                        rgb_img = img.convert("RGB")
                    else:
                        rgb_img = img

                    # Apply resolution scaling
                    if max(rgb_img.width, rgb_img.height) > self.max_dim:
                        scale = self.max_dim / max(rgb_img.width, rgb_img.height)
                        new_size = (int(rgb_img.width * scale), int(rgb_img.height * scale))
                        rgb_img = rgb_img.resize(new_size, Image.Resampling.BILINEAR)

                    buf = io.BytesIO()
                    rgb_img.save(buf, format="JPEG", quality=self.jpeg_quality, optimize=False)
                    jpeg_bytes = buf.getvalue()

                self.latest_frame = jpeg_bytes
                self.latest_frame_time = time.time()
                self.frame_count += 1
                self._fps_window_frames += 1

                now = time.time()
                elapsed = now - self._fps_window_start
                if elapsed >= 1.0:
                    self.fps = self._fps_window_frames / elapsed
                    self._fps_window_frames = 0
                    self._fps_window_start = now

                # Non-blocking latest-frame dispatch to subscribers
                for q in list(self.frame_subscribers):
                    if q.full():
                        try:
                            q.get_nowait()
                        except asyncio.QueueEmpty:
                            pass
                    try:
                        q.put_nowait(jpeg_bytes)
                    except asyncio.QueueFull:
                        pass

                consecutive_errors = 0

            except Exception as e:
                consecutive_errors += 1
                logger.warning(f"Frame capture error ({consecutive_errors}): {e}")
                if consecutive_errors >= 5:
                    logger.info("Re-establishing RSD tunnel...")
                    try:
                        self.rsd = await userspace_tunnel.establish_userspace_rsd(serial=self.udid)
                        consecutive_errors = 0
                    except Exception as re:
                        logger.error(f"Reconnection failed: {re}")
                await asyncio.sleep(0.1)

    async def start(self):
        self.running = True
        self.server = await asyncio.start_server(self._handle_client, self.host, self.port)
        logger.info(f"iOS Stream Server listening on http://{self.host}:{self.port}/")

        asyncio.create_task(self._capture_loop())

        async with self.server:
            await self.server.serve_forever()


def main():
    parser = argparse.ArgumentParser(description="iOS Live Stream Server")
    parser.add_argument("--udid", required=True, help="Target device UDID")
    parser.add_argument("--host", default="127.0.0.1", help="Host address to bind")
    parser.add_argument("--port", type=int, default=19123, help="Port to listen on")
    parser.add_argument("--quality", default="720p", choices=["1080p", "720p", "480p"], help="Initial quality preset")
    args = parser.parse_args()

    server = IOSStreamServer(udid=args.udid, host=args.host, port=args.port)
    server.set_quality(args.quality)
    try:
        asyncio.run(server.start())
    except KeyboardInterrupt:
        logger.info("Shutting down...")

if __name__ == "__main__":
    main()
