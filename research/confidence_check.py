"""Does the app's `confidence` score mean anything? Rules fixed in PREREG_AUDIT.md (development folds only).

    ingest/.venv/Scripts/python research/confidence_check.py
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from evaluate import FOLDS, OUT  # noqa: E402
from models import app_p_over, app_stats  # noqa: E402

STATS6 = ["pts", "reb", "ast", "fg3m", "stl", "blk"]
N_BOOT = 1000


def confidence(mean, spread, n_eff):
    """Exactly shared/baseline.ts: round(100 * (0.5*min(nEff/25,1) + 0.5*(1 - min(cv,1))))."""
    cv = np.where(mean > 0, spread / np.where(mean > 0, mean, 1), 1.0)
    return np.round(100 * (0.5 * np.minimum(n_eff / 25, 1) + 0.5 * (1 - np.minimum(cv, 1))))


def week_boot_diff(a: np.ndarray, b: np.ndarray, wa: np.ndarray, wb: np.ndarray, rng) -> tuple[float, float, float]:
    """mean(a) - mean(b) with a 95% CI from resampling weeks within each group."""
    ga, gb = pd.Series(a).groupby(wa).agg(["sum", "count"]), pd.Series(b).groupby(wb).agg(["sum", "count"])
    out = []
    for _ in range(N_BOOT):
        ia, ib = rng.integers(0, len(ga), len(ga)), rng.integers(0, len(gb), len(gb))
        out.append(ga["sum"].to_numpy()[ia].sum() / ga["count"].to_numpy()[ia].sum()
                   - gb["sum"].to_numpy()[ib].sum() / gb["count"].to_numpy()[ib].sum())
    return float(a.mean() - b.mean()), float(np.percentile(out, 2.5)), float(np.percentile(out, 97.5))


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    df = pd.read_pickle(OUT / "features.pkl").sort_values(["PLAYER_ID", "date", "GAME_ID"]).reset_index(drop=True)
    df["stl"], df["blk"] = df["STL"], df["BLK"]
    app = {s: app_stats(df, s) for s in STATS6}
    rng = np.random.default_rng(9)
    verdict: dict[str, dict[str, bool]] = {}
    report = {}
    for fold, (_, test_season) in FOLDS.items():
        ok = (df.n_prior >= 5) & df["pts_l10"].notna()
        te = df[ok & (df.season == test_season)].sort_values("date")
        weeks = te.date.dt.to_period("W").astype(str).to_numpy()
        print(f"\n=== {fold}: {len(te):,} test rows ===")
        print(f"{'stat':<6}{'mean conf':>10}{'conf sd':>9}  {'top-bottom tercile: rel.error':>32}{'brier':>30}   meaningful?")
        report[fold] = {}
        for s in STATS6:
            a = app[s].loc[te.index]
            mean, spread, n_eff = a["mean"].to_numpy(float), a["spread"].to_numpy(float), a["n_eff"].to_numpy(float)
            conf = confidence(mean, spread, n_eff)
            y = te[s].to_numpy(float)
            line = np.floor(mean) + 0.5
            p = np.clip(app_p_over(mean, spread, line), 1e-4, 1 - 1e-4)
            over = (y > line).astype(float)
            rel_err = np.abs(y - mean) / np.maximum(mean, 1)
            brier = (p - over) ** 2
            lo_cut, hi_cut = np.percentile(conf, [33.3, 66.7])
            bot, top = conf <= lo_cut, conf >= hi_cut
            if top.sum() < 200 or bot.sum() < 200 or hi_cut == lo_cut:
                print(f"{s:<6}{conf.mean():>10.1f}{conf.std():>9.1f}  too little spread in confidence to split into terciles")
                verdict.setdefault(s, {})[fold] = False
                continue
            # "meaningful" = the HIGH-confidence rows have LOWER error and lower Brier (difference top - bottom < 0).
            d_err = week_boot_diff(rel_err[top], rel_err[bot], weeks[top], weeks[bot], rng)
            d_br = week_boot_diff(brier[top], brier[bot], weeks[top], weeks[bot], rng)
            good = d_err[2] < 0 and d_br[2] < 0
            verdict.setdefault(s, {})[fold] = bool(good)
            report[fold][s] = {"mean_conf": float(conf.mean()), "rel_err_diff": d_err, "brier_diff": d_br, "meaningful": bool(good)}
            print(f"{s:<6}{conf.mean():>10.1f}{conf.std():>9.1f}  {d_err[0]:+.4f} [{d_err[1]:+.4f},{d_err[2]:+.4f}]  "
                  f"{d_br[0]:+.4f} [{d_br[1]:+.4f},{d_br[2]:+.4f}]   {'YES' if good else 'no'}")
        # How much of the variation is just which stat it is?
        allc = np.concatenate([confidence(app[s].loc[te.index, "mean"].to_numpy(float), app[s].loc[te.index, "spread"].to_numpy(float),
                                          app[s].loc[te.index, "n_eff"].to_numpy(float)) for s in STATS6])
        grp = np.concatenate([[s] * len(te) for s in STATS6])
        between = pd.Series(allc).groupby(grp).transform("mean")
        print(f"  share of confidence variance explained by stat type alone: {1 - ((allc - between) ** 2).sum() / ((allc - allc.mean()) ** 2).sum():.1%}")
        report[fold]["variance_explained_by_stat"] = float(1 - ((allc - between) ** 2).sum() / ((allc - allc.mean()) ** 2).sum())

    n_ok = sum(all(v.get(f, False) for f in FOLDS) for v in verdict.values())
    print(f"\nPre-registered rule: meaningful if top tercile beats bottom on error AND Brier in BOTH folds for >= 3 of 6 stats.")
    print(f"Stats meeting it: {n_ok} of 6  ->  {'confidence IS validated' if n_ok >= 3 else 'confidence carries NO validated information'}")
    (OUT / "confidence_check.json").write_text(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
