"""
Unit tests for Agent Command Executor: allowlist enforcement, argument sanitization,
and error structuring.
"""
import unittest
import asyncio
from unittest.mock import patch, MagicMock
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.agent.command_executor import (
    validate_bundle_id,
    execute_command,
    COMMAND_ALLOWLIST
)


class TestCommandExecutor(unittest.IsolatedAsyncioTestCase):
    def test_bundle_id_validation_valid(self):
        self.assertTrue(validate_bundle_id("com.apple.Preferences"))
        self.assertTrue(validate_bundle_id("com.example.qa-tool"))
        self.assertTrue(validate_bundle_id("org.company.test_app.prod"))

    def test_bundle_id_validation_rejects_malicious(self):
        self.assertFalse(validate_bundle_id(""))
        self.assertFalse(validate_bundle_id(None))
        self.assertFalse(validate_bundle_id("com.apple.Preferences; rm -rf /"))
        self.assertFalse(validate_bundle_id("../../etc/passwd"))
        self.assertFalse(validate_bundle_id("app | calc.exe"))
        self.assertFalse(validate_bundle_id("com.example.$ENV"))
        self.assertFalse(validate_bundle_id("singleword"))

    async def test_unknown_command_rejected_by_allowlist(self):
        success, result, error = await execute_command(
            command="ARBITRARY_SHELL_EXEC",
            device_id="00008140-0005596A36E9801C",
            args={"cmd": "whoami"}
        )
        self.assertFalse(success)
        self.assertIsNone(result)
        self.assertIsNotNone(error)
        self.assertEqual(error["code"], "COMMAND_NOT_SUPPORTED")

    async def test_invalid_bundle_id_rejected_on_launch(self):
        success, result, error = await execute_command(
            command="APP_LAUNCH",
            device_id="00008140-0005596A36E9801C",
            args={"bundleId": "bad;injection"}
        )
        self.assertFalse(success)
        self.assertIsNone(result)
        self.assertEqual(error["code"], "INVALID_ARGUMENT")

    async def test_missing_device_id_rejected(self):
        success, result, error = await execute_command(
            command="DEVICE_INFO",
            device_id="",
            args={}
        )
        self.assertFalse(success)
        self.assertEqual(error["code"], "INVALID_DEVICE_ID")

    async def test_device_info_mock_execution(self):
        mock_info = {
            "udid": "00008140-0005596A36E9801C",
            "name": "Test iPhone",
            "productType": "iPhone17,5",
            "productVersion": "26.4.2"
        }
        with patch("src.agent.command_executor.exec_device_info", return_value=mock_info):
            success, result, error = await execute_command(
                command="DEVICE_INFO",
                device_id="00008140-0005596A36E9801C",
                args={}
            )
            self.assertTrue(success)
            self.assertIsNone(error)
            self.assertEqual(result["name"], "Test iPhone")


if __name__ == "__main__":
    unittest.main()
