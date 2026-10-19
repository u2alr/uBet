"""Checks that models.app_stats / app_p_over reproduce shared/baseline.ts exactly.

Random game histories are fed to both the Python port and the real TypeScript predict() (run with node),
and the projection, spread and P(over) must agree.   ingest/.venv/Scripts/python research/tests/test_port.py
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "research"))
from models import app_p_over, app_stats  # noqa: E402

JS = """
import { predict } from '../../shared/baseline.ts'
import { readFileSync } from 'node:fs'
const cases = JSON.parse(readFileSync(process.argv[2], 'utf8'))
console.log(JSON.stringify(cases.map((c) => predict(c.samples, c.line, c.upcoming))))
"""


def main():
    rng = np.random.default_rng(1)
    cases, frames = [], []
    for k in range(40):
        n = int(rng.integers(8, 70))
        stat_mean = float(rng.choice([1.2, 3.0, 5.0, 9.0, 18.0]))
        vals = rng.poisson(stat_mean, size=n + 1).astype(float)  # last one = the game being predicted
        po = rng.random(n + 1) < 0.15
        upcoming_po = bool(po[-1])
        line = float(np.floor(stat_mean) + 0.5)
        # TS wants most recent first, excluding the game being predicted.
        samples = [{"value": float(v), "type": "playoffs" if p else "regular"} for v, p in zip(vals[:-1][::-1], po[:-1][::-1])]
        cases.append({"samples": samples, "line": line, "upcoming": "playoffs" if upcoming_po else "regular"})
        frames.append(pd.DataFrame({"PLAYER_ID": k, "pts": vals, "playoffs": po.astype(int)}))

    case_file = ROOT / "research" / "out" / "port_cases.json"
    case_file.parent.mkdir(exist_ok=True)
    case_file.write_text(json.dumps(cases))
    script = ROOT / "research" / "out" / "port_check.mjs"
    script.write_text(JS)
    res = subprocess.run(["node", str(script), str(case_file)], cwd=ROOT, capture_output=True, text=True)
    if res.returncode != 0:
        print(res.stderr[-800:])
        sys.exit("node failed to run shared/baseline.ts")
    ts = json.loads(res.stdout)

    df = pd.concat(frames, ignore_index=True)
    st = app_stats(df, "pts")
    last = df.groupby("PLAYER_ID").tail(1).index  # the game being predicted per case
    worst = 0.0
    for k, c in enumerate(cases):
        row = st.loc[last[k]]
        want = ts[k]
        py_p = app_p_over(np.array([row["mean"]]), np.array([row["spread"]]), np.array([c["line"]]))[0]
        diffs = [abs(row["mean"] - want["predicted"]), abs(row["spread"] - want["stdDev"]), abs(py_p - want["pOver"])]
        worst = max(worst, *diffs)
        assert max(diffs) < 1e-6, f"case {k}: python {row['mean']:.6f}/{row['spread']:.6f}/{py_p:.6f} vs ts {want}"
    print(f"PASS: python port matches shared/baseline.ts on {len(cases)} random histories (max abs diff {worst:.2e})")


if __name__ == "__main__":
    main()
