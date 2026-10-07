"""
Unit tests for Agent Identity & System Metadata.
"""
import unittest
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.agent.identity import generate_agent_id, collect_system_info


class TestAgentIdentity(unittest.TestCase):
    def test_generate_agent_id_format(self):
        agent_id = generate_agent_id()
        self.assertTrue(agent_id.startswith("AGENT-"), f"Expected AGENT- prefix, got {agent_id}")
        parts = agent_id.split("-")
        self.assertGreaterEqual(len(parts), 3)

    def test_collect_system_info_structure(self):
        info = collect_system_info()
        self.assertIn("os", info)
        self.assertIn("os_version", info)
        self.assertIn("hostname", info)
        self.assertIn("python_version", info)
        self.assertIn("architecture", info)
        self.assertTrue(len(info["hostname"]) > 0)


if __name__ == "__main__":
    unittest.main()
