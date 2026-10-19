"""Is the boosted model biased low (or high) in the first games of a season, especially for stars?

Development folds only (the held-out season is not touched).
Bias = mean(actual - projected): positive means the model projected too LOW.

    ingest/.venv/Scripts/python research/opener_bias.py
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from evaluate import FOLDS, OUT, run  # noqa: E402
from features import STATS  # noqa: E402
from models import app_stats  # noqa: E402


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    df = pd.read_pickle(OUT / "features.pkl").sort_values(["PLAYER_ID", "date", "GAME_ID"]).reset_index(drop=True)
    app = {s: app_stats(df, s) for s in STATS}
    for name, (train, test) in FOLDS.items():
        if "B:" not in name:  # fold A has too little training data to say anything about the final model
            continue
        res = run(train, test, df, app)
        te, rows = res["te"], res["rows"]
        star = (te.pts_l10 >= 20).to_numpy()
        opener = (te.n_prior_season == 0).to_numpy()
        early = ((te.n_prior_season >= 1) & (te.n_prior_season < 10)).to_numpy()
        later = (te.n_prior_season >= 10).to_numpy()
        print(f"\n{name}   bias = mean(actual - projected); positive = projected too low\n")
        print(f"{'group':<30}{'n':>6}   " + "   ".join(f"{s + ' m2/app':>18}" for s in STATS))
        for label, mask in [("openers, stars (l10 pts>=20)", opener & star), ("openers, all rotation", opener & (te.min_l10 >= 20).to_numpy()),
                            ("games 1-9, stars", early & star), ("games 10+, stars", later & star)]:
            cells = []
            for s in STATS:
                y = te[s].to_numpy(float)[mask]
                b_m2 = float(np.mean(y - rows[s]["m2_mu"][mask]))
                b_app = float(np.mean(y - rows[s]["app_mu"][mask]))
                cells.append(f"{b_m2:+.2f} / {b_app:+.2f}")
            print(f"{label:<30}{int(mask.sum()):>6}   " + "   ".join(f"{c:>18}" for c in cells))


if __name__ == "__main__":
    main()
