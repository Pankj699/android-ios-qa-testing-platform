"""
Unit tests for cross-platform diagnostics aggregator.
"""
import unittest
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.agent.health import get_full_diagnostics


class TestDiagnostics(unittest.TestCase):
    def test_get_full_diagnostics(self):
        diag = get_full_diagnostics()
        self.assertIn("system", diag)
        self.assertIn("python_env", diag)
        self.assertIn("platform_specific", diag)
        self.assertIn("os", diag["system"])


if __name__ == "__main__":
    unittest.main()
