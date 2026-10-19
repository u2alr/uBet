"""Does the boosted model still beat the app's model in the first games of a season?

Development folds only (train 2022-23/2023-24 -> test 2024-25). The held-out season is not touched.
Rows are split by how many games the player had already played that season.

    ingest/.venv/Scripts/python research/early_season.py
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from evaluate import OUT, boot_diff, run  # noqa: E402
from features import STATS  # noqa: E402
from models import app_stats  # noqa: E402


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    df = pd.read_pickle(OUT / "features.pkl").sort_values(["PLAYER_ID", "date", "GAME_ID"]).reset_index(drop=True)
    app = {s: app_stats(df, s) for s in STATS}
    res = run([2022, 2023], 2024, df, app)
    te, rows = res["te"], res["rows"]
    weeks = te.date.dt.to_period("W").astype(str).to_numpy()
    rot = (te.min_l10 >= 20).to_numpy()
    rng = np.random.default_rng(3)
    buckets = [("season game 0 (opener)", te.n_prior_season == 0), ("games 1-9", (te.n_prior_season >= 1) & (te.n_prior_season < 10)),
               ("games 10+", te.n_prior_season >= 10)]
    print("m2 minus app, per-row log score (positive = boosted model better), rotation players, dev fold 2024-25\n")
    print(f"{'bucket':<24}{'rows':>7}  " + "  ".join(f"{s:>26}" for s in STATS))
    for name, b in buckets:
        mask = rot & b.to_numpy()
        cells = []
        for s in STATS:
            d, lo, hi = boot_diff(rows[s]["m2"][mask], rows[s]["app"][mask], weeks[mask], rng)
            cells.append(f"{d:+.4f} [{lo:+.4f},{hi:+.4f}]")
        print(f"{name:<24}{int(mask.sum()):>7}  " + "  ".join(f"{c:>26}" for c in cells))


if __name__ == "__main__":
    main()
