"""Cross-checks predictV3 in shared/baseline.ts against an independent Python implementation (scipy) of the same rule.

    ingest/.venv/Scripts/python research/tests/test_v3.py

The rule's data (policy and dispersion tables) is read from the same shared/dispersion.json by both sides; everything
else (the weighted mean and spread, the choice of distribution, the over/under/push arithmetic) is implemented twice.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import nbinom, norm, poisson

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "research"))
from models import app_stats  # noqa: E402

TABLE = json.loads((ROOT / "shared" / "dispersion.json").read_text())
JS = """
import { predictV3 } from '../../shared/baseline.ts'
import { readFileSync } from 'node:fs'
const cases = JSON.parse(readFileSync(process.argv[2], 'utf8'))
console.log(JSON.stringify(cases.map((c) => predictV3(c.stat, c.samples, c.line, c.upcoming))))
"""


def alpha_at(stat, mu):
    d = TABLE["dispersion"][stat]
    return float(np.interp(mu, d["centers"], d["alphas"]))


def py_outcome(stat, mean, spread, line):
    bucket = "lt2" if mean < 2 else "mid" if mean < 6 else "hi"
    kind = TABLE["policy"][stat][bucket]
    if kind == "nb" or kind == "nbc":
        mu = max(mean, 1e-3)
        alpha = alpha_at(stat, mean) if kind == "nb" else TABLE["dispersion"][stat]["constant"]
        r = 1 / alpha
        cdf = lambda k: nbinom.cdf(k, r, r / (r + mu)) if k >= 0 else 0.0
    elif mean < 6:
        mu = max(mean, 0.05)
        cdf = lambda k: poisson.cdf(k, mu) if k >= 0 else 0.0
    else:
        cdf = lambda k: norm.cdf((k + 0.5 - mean) / spread) if k >= 0 else 0.0
    whole = float(line).is_integer()
    k = int(np.floor(line))
    over = 1 - cdf(k)
    under = cdf(line - 1) if whole else 1 - over
    push = max(0.0, 1 - over - under) if whole else 0.0
    return over, under, push


def main():
    rng = np.random.default_rng(3)
    levels = {"pts": [1.5, 4, 9, 18, 27], "reb": [0.8, 2.5, 5, 9], "ast": [0.5, 1.5, 4, 8], "fg3m": [0.4, 1.2, 2.5, 4],
              "stl": [0.3, 0.8, 1.5], "blk": [0.2, 0.7, 1.4]}
    cases, frames = [], []
    for stat, ls in levels.items():
        for lvl in ls:
            for _ in range(8):
                n = int(rng.integers(8, 60))
                vals = rng.poisson(lvl, size=n + 1).astype(float)
                line = float(rng.choice([np.floor(lvl) + 0.5, np.floor(lvl), np.floor(lvl) + 1, np.floor(lvl) + 1.5]))
                samples = [{"value": float(v), "type": "regular"} for v in vals[:-1][::-1]]
                cases.append({"stat": stat, "samples": samples, "line": line, "upcoming": "regular"})
                frames.append(pd.DataFrame({"PLAYER_ID": len(frames), stat: vals, "playoffs": 0}))

    out = ROOT / "research" / "out"
    out.mkdir(exist_ok=True)
    (out / "v3_cases.json").write_text(json.dumps(cases))
    (out / "v3_check.mjs").write_text(JS)
    res = subprocess.run(["node", "--no-warnings", str(out / "v3_check.mjs"), str(out / "v3_cases.json")], cwd=ROOT, capture_output=True, text=True)
    if res.returncode != 0:
        print(res.stderr[-800:])
        sys.exit("node failed")
    ts = json.loads(res.stdout)

    worst = 0.0
    used = {"native": 0, "nb": 0, "nbc": 0}
    for i, c in enumerate(cases):
        df = frames[i]
        st = app_stats(df.rename(columns={}), c["stat"]).iloc[-1]
        want = ts[i]
        if want is None:
            continue
        over, under, push = py_outcome(c["stat"], float(st["mean"]), float(st["spread"]), c["line"])
        bucket = "lt2" if st["mean"] < 2 else "mid" if st["mean"] < 6 else "hi"
        used[TABLE["policy"][c["stat"]][bucket]] += 1
        # The normal CDF is a ~1e-7 approximation per evaluation, and the refund probability combines three of them.
        tol = 6e-7 if TABLE["policy"][c["stat"]][bucket] == "native" and st["mean"] >= 6 else 1e-9
        diff = max(abs(over - want["pOver"]), abs(under - want["pUnder"]), abs(push - want["pPush"]), abs(float(st["mean"]) - want["predicted"]))
        worst = max(worst, diff if tol == 1e-9 else 0)
        assert diff <= tol + 1e-12, f"case {i} {c['stat']} line {c['line']}: ts {want} vs python {over, under, push}"
    assert all(v > 0 for v in used.values()), f"the check must exercise every kind of cell: {used}"
    print(f"PASS: predictV3 matches an independent scipy implementation on {len(cases)} cases "
          f"(cells used: {used}; largest difference outside the normal approximation {worst:.1e})")


if __name__ == "__main__":
    main()
