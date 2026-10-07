"""
Unit tests for Agent-based ScreenStreamManager and Mirror Command Routing.
"""
import unittest
import asyncio
from unittest.mock import MagicMock, AsyncMock, patch
from src.agent.screen_stream import ScreenStreamManager, find_available_port
from src.agent.command_router import CommandRouter


class TestScreenStream(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.manager = ScreenStreamManager()

    def test_find_available_port(self):
        port = find_available_port()
        self.assertIsInstance(port, int)
        self.assertGreater(port, 1024)

    async def test_get_status_inactive(self):
        status = self.manager.get_status("00008140-TEST-INACTIVE")
        self.assertFalse(status["active"])
        self.assertEqual(status["udid"], "00008140-TEST-INACTIVE")

    async def test_stop_mirror_no_session(self):
        res = await self.manager.stop_mirror("00008140-TEST-NONE")
        self.assertTrue(res["success"])
        self.assertEqual(res["udid"], "00008140-TEST-NONE")

    @patch("pymobiledevice3.remote.userspace_tunnel.establish_userspace_rsd", new_callable=AsyncMock)
    @patch("pymobiledevice3.remote.core_device.screen_stream.ScreenStreamServer")
    @patch("asyncio.open_connection", new_callable=AsyncMock)
    async def test_start_mirror_success(self, mock_conn, mock_server_cls, mock_rsd):
        mock_rsd.return_value = MagicMock()
        mock_server = MagicMock()
        async def fake_serve():
            await asyncio.sleep(999)
        mock_server.serve = fake_serve
        mock_server_cls.return_value = mock_server

        mock_writer = MagicMock()
        mock_writer.close = MagicMock()
        mock_writer.wait_closed = AsyncMock()
        mock_conn.return_value = (MagicMock(), mock_writer)

        res = await self.manager.start_mirror("00008140-0005596A36E9801C", custom_port=19876)

        self.assertTrue(res["success"])
        self.assertEqual(res["udid"], "00008140-0005596A36E9801C")
        self.assertEqual(res["port"], 19876)
        self.assertIn("19876", res["streamUrl"])
        self.assertFalse(res["reused"])

        status = self.manager.get_status("00008140-0005596A36E9801C")
        self.assertTrue(status["active"])
        self.assertEqual(status["port"], 19876)

        # Test stop mirror
        stop_res = await self.manager.stop_mirror("00008140-0005596A36E9801C")
        self.assertTrue(stop_res["success"])
        self.assertFalse(self.manager.get_status("00008140-0005596A36E9801C")["active"])


class TestMirrorRouterDispatch(unittest.IsolatedAsyncioTestCase):
    async def test_start_and_stop_mirror_route(self):
        mock_ws = AsyncMock()
        mock_ws.agent_id = "AGENT-WIN-TEST"
        mock_ws.send_json = AsyncMock()

        mock_hb = MagicMock()
        router = CommandRouter(mock_ws, mock_hb)

        # 1. Test START_MIRROR_REQUEST with mocked ScreenStreamManager
        with patch("src.agent.screen_stream.screen_stream_manager.start_mirror", new_callable=AsyncMock) as mock_start:
            mock_start.return_value = {
                "success": True,
                "udid": "00008140-TEST",
                "port": 19444,
                "streamUrl": "http://127.0.0.1:19444/stream.bin",
                "viewerUrl": "http://127.0.0.1:19444/",
                "resolution": "1170x2532"
            }

            msg_bytes = b'{"type": "START_MIRROR_REQUEST", "requestId": "req-mir-1", "deviceId": "00008140-TEST", "quality": "720p"}'
            await router.route_message(msg_bytes)

            mock_ws.send_json.assert_called_once()
            sent = mock_ws.send_json.call_args[0][0]
            self.assertEqual(sent["type"], "START_MIRROR_RESPONSE")
            self.assertEqual(sent["requestId"], "req-mir-1")
            self.assertTrue(sent["success"])
            self.assertEqual(sent["port"], 19444)

        # 2. Test STOP_MIRROR_REQUEST
        mock_ws.send_json.reset_mock()
        with patch("src.agent.screen_stream.screen_stream_manager.stop_mirror", new_callable=AsyncMock) as mock_stop:
            mock_stop.return_value = {
                "success": True,
                "message": "Mirror stopped",
                "udid": "00008140-TEST"
            }

            msg_bytes = b'{"type": "STOP_MIRROR_REQUEST", "requestId": "req-mir-2", "deviceId": "00008140-TEST"}'
            await router.route_message(msg_bytes)

            mock_ws.send_json.assert_called_once()
            sent = mock_ws.send_json.call_args[0][0]
            self.assertEqual(sent["type"], "STOP_MIRROR_RESPONSE")
            self.assertEqual(sent["requestId"], "req-mir-2")
            self.assertTrue(sent["success"])


if __name__ == "__main__":
    unittest.main()
