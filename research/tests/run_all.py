"""Runs every research test file as its own process and fails if any fails. One command for CI and for a local check:

    python research/tests/run_all.py

The leakage tests run on a small generated fixture league (research/tests/fixture_data.py) via UBET_RESEARCH_DATA, so no NBA.com download and no paid API is
needed. test_leakage.py also runs on the real data when you run it by hand without that variable.
"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fixture_data  # noqa: E402

FILES = ["test_leakage.py", "test_leakage_detector.py", "test_nb.py", "test_port.py", "test_v3.py", "test_calibration_report.py",
         "test_kalshi.py", "test_market_eval.py", "test_injury_names.py", "test_injury_default.py", "test_archive_export.py", "test_context_features.py"]


def main() -> int:
    data = Path(tempfile.mkdtemp(prefix="ubet_fixture_"))
    fixture_data.make(data)
    env = {**os.environ, "UBET_RESEARCH_DATA": str(data), "PYTHONIOENCODING": "utf-8"}
    (HERE.parent / "out").mkdir(exist_ok=True)
    failed = []
    for f in FILES:
        r = subprocess.run([sys.executable, str(HERE / f)], env=env, capture_output=True, text=True, encoding="utf-8", errors="replace")
        status = "ok" if r.returncode == 0 else "FAILED"
        print(f"{status:7s} {f}")
        if r.returncode != 0:
            failed.append(f)
            print((r.stdout + r.stderr)[-2500:])
    print(f"\n{len(FILES) - len(failed)} of {len(FILES)} test files passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
