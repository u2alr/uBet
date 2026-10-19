"""Checks that nbPOver in shared/baseline.ts equals scipy's negative-binomial survival function.

    ingest/.venv/Scripts/python research/tests/test_nb.py
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "research"))
from models import nb_p_over  # noqa: E402

JS = """
import { nbPOver } from '../../shared/baseline.ts'
import { readFileSync } from 'node:fs'
const cases = JSON.parse(readFileSync(process.argv[2], 'utf8'))
console.log(JSON.stringify(cases.map((c) => nbPOver(c.line, c.mu, c.alpha))))
"""


def main():
    rng = np.random.default_rng(5)
    cases = []
    for _ in range(300):
        mu = float(rng.choice([0.4, 1.1, 2.5, 4.0, 7.0, 12.0, 22.0, 33.0]) * rng.uniform(0.8, 1.2))
        alpha = float(rng.uniform(0.02, 0.7))
        line = float(np.floor(mu * rng.uniform(0.5, 1.6)) + 0.5)
        cases.append({"mu": mu, "alpha": alpha, "line": line})
    out = ROOT / "research" / "out"
    out.mkdir(exist_ok=True)
    (out / "nb_cases.json").write_text(json.dumps(cases))
    (out / "nb_check.mjs").write_text(JS)
    res = subprocess.run(["node", str(out / "nb_check.mjs"), str(out / "nb_cases.json")], cwd=ROOT, capture_output=True, text=True)
    if res.returncode != 0:
        print(res.stderr[-600:])
        sys.exit("node failed")
    ts = np.array(json.loads(res.stdout))
    py = np.array([nb_p_over(np.array([c["line"]]), np.array([c["mu"]]), np.array([c["alpha"]]))[0] for c in cases])
    worst = float(np.abs(ts - py).max())
    assert worst < 1e-9, f"TypeScript and scipy disagree (max abs diff {worst:.3e})"
    print(f"PASS: nbPOver matches scipy on {len(cases)} random cases (max abs diff {worst:.2e})")


if __name__ == "__main__":
    main()
