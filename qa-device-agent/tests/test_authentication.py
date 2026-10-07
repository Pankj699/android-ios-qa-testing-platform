"""
Unit tests for Settings & Authentication state.
"""
import unittest
import os
import tempfile
import json
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config.settings import AgentSettings


class TestAgentSettings(unittest.TestCase):
    def setUp(self):
        self.temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".json")
        self.temp_file.close()

    def tearDown(self):
        if os.path.exists(self.temp_file.name):
            os.remove(self.temp_file.name)

    def test_settings_persistence(self):
        settings = AgentSettings(config_file=self.temp_file.name)
        self.assertFalse(settings.is_paired)

        settings.update(
            agent_id="AGENT-TEST-001",
            agent_token="jwt-fake-token-123",
            user_id="usr-123"
        )
        self.assertTrue(settings.is_paired)

        # Reload from disk
        settings2 = AgentSettings(config_file=self.temp_file.name)
        self.assertEqual(settings2.get("agent_id"), "AGENT-TEST-001")
        self.assertEqual(settings2.get("agent_token"), "jwt-fake-token-123")
        self.assertTrue(settings2.is_paired)

    def test_settings_clear(self):
        settings = AgentSettings(config_file=self.temp_file.name)
        settings.update(agent_id="AGENT-01", agent_token="tok-01")
        self.assertTrue(settings.is_paired)

        settings.clear()
        self.assertFalse(settings.is_paired)
        self.assertIsNone(settings.get("agent_id"))


if __name__ == "__main__":
    unittest.main()
