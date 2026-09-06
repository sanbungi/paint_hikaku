"""The CI gate must reject skipped, failed, and hung test processes."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

RUNNER = Path(__file__).resolve().parents[1] / "scripts/run_checks.py"


class RunnerGate(unittest.TestCase):
    def check(self, code, timeout=10):
        with tempfile.TemporaryDirectory() as directory:
            return subprocess.run([sys.executable, str(RUNNER), "--name", "gate",
                                   "--timeout", str(timeout), "--expect", "PASS expected",
                                   "--", sys.executable, "-c", code], cwd=directory,
                                  capture_output=True, text=True, timeout=20)

    def test_success(self):
        self.assertEqual(self.check("print('PASS expected')").returncode, 0)

    def test_missing_test(self):
        self.assertNotEqual(self.check("print('No tests executed')").returncode, 0)

    def test_crash_after_pass(self):
        self.assertNotEqual(self.check("print('PASS expected'); raise RuntimeError('failure')").returncode, 0)

    def test_timeout(self):
        result = self.check("import time; time.sleep(30)", timeout=1)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("TIMEOUT", result.stdout)


if __name__ == "__main__":
    unittest.main()
