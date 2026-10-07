"""
Phase 7 Automated Test Suite: Packaging, Configuration Paths, Diagnostics, and Security Scanner.
"""
import unittest
import os
import sys
import tempfile
import json
from unittest.mock import patch, MagicMock

# Ensure project root in path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from version import __version__, __installer_version__
from config.settings import (
    AgentSettings,
    get_default_config_path,
    get_default_config_dir,
    get_default_log_dir
)
from src.agent.logging_setup import setup_logging
from src.agent.health import get_full_diagnostics
from src.platforms.windows.diagnostics import check_windows_apple_driver
from src.platforms.macos.diagnostics import check_macos_usbmux


class TestPhase7Packaging(unittest.TestCase):

    def test_version_definitions(self):
        """1. Verifies semver format of agent and installer versions."""
        self.assertEqual(__version__, "1.1.2")
        self.assertEqual(__installer_version__, "1.1.2")

    def test_config_path_resolution_with_env_override(self):
        """2. Verifies QA_AGENT_CONFIG environment variable takes precedence."""
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tf:
            custom_path = tf.name
        
        try:
            with patch.dict(os.environ, {"QA_AGENT_CONFIG": custom_path}):
                resolved = get_default_config_path()
                self.assertEqual(os.path.abspath(resolved), os.path.abspath(custom_path))
        finally:
            if os.path.exists(custom_path):
                os.remove(custom_path)

    def test_config_path_os_specific_defaults(self):
        """3. Verifies OS-specific config and log path resolution."""
        # Windows simulation
        with patch("sys.platform", "win32"), patch.dict(os.environ, {"APPDATA": r"C:\Users\Test\AppData\Roaming"}, clear=True):
            win_conf = get_default_config_dir()
            self.assertIn("QA-Device-Agent", win_conf)
            self.assertTrue(win_conf.startswith(r"C:\Users\Test\AppData\Roaming"))
            win_log = get_default_log_dir()
            self.assertIn("logs", win_log)

        # macOS simulation
        with patch("sys.platform", "darwin"), patch("os.path.expanduser", return_value="/Users/Test"):
            mac_conf = get_default_config_dir().replace("\\", "/")
            self.assertIn("Library/Application Support/QA-Device-Agent", mac_conf)
            mac_log = get_default_log_dir().replace("\\", "/")
            self.assertIn("Library/Logs/QA-Device-Agent", mac_log)

    def test_settings_save_load_clear(self):
        """4. Verifies AgentSettings persistence lifecycle in isolated temp file."""
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tf:
            temp_path = tf.name
        
        try:
            settings = AgentSettings(config_file=temp_path)
            self.assertFalse(settings.is_paired)

            # Update credentials
            settings.update(
                agent_id="AGENT-WIN-TEST01",
                agent_token="jwt_sample_token_xyz",
                server_url="https://qa.example.com"
            )
            self.assertTrue(settings.is_paired)
            self.assertEqual(settings.get("agent_id"), "AGENT-WIN-TEST01")

            # Reload fresh instance
            reloaded = AgentSettings(config_file=temp_path)
            self.assertTrue(reloaded.is_paired)
            self.assertEqual(reloaded.get("agent_token"), "jwt_sample_token_xyz")

            # Clear settings
            reloaded.clear()
            self.assertFalse(reloaded.is_paired)
            self.assertIsNone(reloaded.get("agent_token"))
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

    def test_logging_setup_sanitization(self):
        """5. Verifies logger setup initializes without crashing."""
        logger = setup_logging("DEBUG", log_to_file=False)
        self.assertIsNotNone(logger)
        self.assertEqual(logger.name, "qa_device_agent")

    def test_windows_diagnostics_guidance(self):
        """6. Verifies Windows diagnostics returns actionable guidance when services are absent."""
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=1, stdout="NOT FOUND")
            res = check_windows_apple_driver()
            self.assertIn("status", res)
            self.assertIn("guidance", res)
            self.assertIsInstance(res["guidance"], list)

    def test_macos_diagnostics_structure(self):
        """7. Verifies macOS diagnostics returns proper structure."""
        res = check_macos_usbmux()
        self.assertIn("usbmuxd_socket", res)
        self.assertIn("status", res)
        self.assertIn("guidance", res)

    def test_full_diagnostics_aggregation(self):
        """8. Verifies get_full_diagnostics aggregates system, python, and platform checks."""
        diag = get_full_diagnostics()
        self.assertIn("system", diag)
        self.assertIn("python_env", diag)
        self.assertIn("platform_specific", diag)
        self.assertIn("os", diag["system"])
        self.assertIn("architecture", diag["system"])

    def test_working_directory_independence(self):
        """9. Verifies configuration works when CWD is arbitrary temp dir."""
        orig_cwd = os.getcwd()
        temp_dir = tempfile.mkdtemp()
        try:
            os.chdir(temp_dir)
            settings = AgentSettings()
            self.assertIsNotNone(settings.config_file)
        finally:
            os.chdir(orig_cwd)
            try:
                os.rmdir(temp_dir)
            except Exception:
                pass

    def test_security_scanner_no_hardcoded_secrets(self):
        """10. Scans agent source files to ensure no hardcoded private keys or tokens."""
        agent_src = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src")
        forbidden_patterns = [
            "BEGIN RSA PRIVATE KEY",
            "BEGIN OPENSSH PRIVATE KEY",
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." # static real JWT header
        ]

        for root, _, files in os.walk(agent_src):
            for file in files:
                if file.endswith(".py"):
                    file_path = os.path.join(root, file)
                    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                        content = f.read()
                        for pat in forbidden_patterns:
                            self.assertNotIn(pat, content, f"Secret pattern found in {file_path}")


if __name__ == "__main__":
    unittest.main()
