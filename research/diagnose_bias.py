"""Diagnostics for the model's lean toward Under (descriptive only: nothing here selects or tunes anything).

For each fold (train seasons -> test season) and stat: bias of the projected mean (actual minus projected), the same split
by predicted-mean tercile, by minutes-trend, and by games-missed, plus the share of the over-rate gap that a mean bias
explains. Output: research/out/bias_diagnostics.json and a printed table.

    ingest/.venv/Scripts/python research/diagnose_bias.py
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from features import STATS  # noqa: E402
from models import fit_minutes, fit_predict_hgb  # noqa: E402

OUT = Path(__file__).resolve().parent / "out"
FOLDS = {"A": ([2022], 2023), "B": ([2022, 2023], 2024), "F": ([2022, 2023, 2024], 2025)}


def main():
    df = pd.read_pickle(OUT / "features.pkl")
    ok = (df.n_prior >= 5) & df["pts_l10"].notna() & (df.min_l10 >= 24)
    res = {}
    for name, (tr_seasons, te_season) in FOLDS.items():
        tr = df[(df.n_prior >= 5) & df["pts_l10"].notna() & df.season.isin(tr_seasons)].sort_values("date")
        te = df[ok & (df.season == te_season)].sort_values("date")
        mins = fit_minutes(tr, te)
        res[name] = {"n": len(te), "minutes_bias": float((te.minutes - mins).mean())}
        for stat in STATS:
            mu = fit_predict_hgb(tr, te, stat, mins)["m2"]
            y = te[stat].to_numpy(float)
            d = y - mu
            tert = pd.qcut(mu, 3, labels=["low", "mid", "high"], duplicates="drop")
            line = np.floor(te[f"{stat}_l10"].to_numpy(float)) + 0.5
            res[name][stat] = {
                "mean_bias": float(d.mean()), "rel_bias_pct": float(100 * d.mean() / y.mean()), "median_bias": float(np.median(d)),
                "by_tercile": {str(k): float(d[tert == k].mean()) for k in ["low", "mid", "high"] if (tert == k).any()},
                "by_minutes_trend": {"rising": float(d[(te.min_l5 - te.min_l20).to_numpy() > 1.5].mean()), "falling": float(d[(te.min_l5 - te.min_l20).to_numpy() < -1.5].mean())},
                "after_absence": float(d[(te.games_missed >= 1).to_numpy()].mean()) if (te.games_missed >= 1).any() else None,
                "over_rate_vs_pseudo_line": float((y > line).mean()),
            }
            print(f"{name} {stat:5s} n={len(te):6d} bias {d.mean():+.3f} ({100*d.mean()/y.mean():+.1f}%) terciles "
                  + " ".join(f"{k}={v:+.2f}" for k, v in res[name][stat]["by_tercile"].items()))
        print(f"{name} minutes bias {res[name]['minutes_bias']:+.2f}")
    (OUT / "bias_diagnostics.json").write_text(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
