"""Tests the candidates fixed in PREREG_MODEL_V2.md. Run exactly as written there; nothing is tuned.

    ingest/.venv/Scripts/python research/improve_model.py            # folds A and B (development)
    ingest/.venv/Scripts/python research/improve_model.py --final    # fold F, once, after reading A and B

Output: research/out/improve_model_{dev,final}.json and a printed table.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import LogisticRegression

sys.path.insert(0, str(Path(__file__).resolve().parent))
from features import FEATURES, STATS  # noqa: E402
from models import HGB, Dispersion, nb_logpmf, nb_p_over  # noqa: E402

OUT = Path(__file__).resolve().parent / "out"
FOLDS = {"A": ([2022], 2023), "B": ([2022, 2023], 2024), "F": ([2022, 2023, 2024], 2025)}
N_BOOT = 2000
WINDOW_DAYS, SHRINK_K, CLIP = 30, 1000.0, 0.15


def add_h2h(df: pd.DataFrame) -> pd.DataFrame:
    """Earlier games by this player against this opponent only (shift before the cumulative sums)."""
    df = df.sort_values(["PLAYER_ID", "OPP_ID", "date", "GAME_ID"]).copy()
    g = df.groupby(["PLAYER_ID", "OPP_ID"])
    n = g.cumcount()
    df["h2h_n"] = n.astype(float)
    for s in STATS:
        prior_sum = g[s].cumsum() - df[s]
        mean = prior_sum / n.replace(0, np.nan)
        df[f"h2h_{s}_diff"] = ((mean - df[f"{s}_l40"]) * n / (n + 3)).fillna(0.0)
    return df.sort_values(["date", "GAME_ID", "PLAYER_ID"]).reset_index(drop=True)


def drift_factor(dates: np.ndarray, y: np.ndarray, mu: np.ndarray) -> np.ndarray:
    """Shrunk league-wide relative residual over the previous 30 days, per row (sorted by date); strictly earlier games only."""
    day = dates.astype("datetime64[D]").astype(int)
    order = np.argsort(day, kind="stable")
    day_s, r_s, mu_s = day[order], (y - mu)[order], mu[order]
    cr, cm = np.concatenate([[0], np.cumsum(r_s)]), np.concatenate([[0], np.cumsum(mu_s)])
    lo = np.searchsorted(day_s, day_s - WINDOW_DAYS, side="left")
    hi = np.searchsorted(day_s, day_s, side="left")          # rows strictly before this day
    n = (hi - lo).astype(float)
    num, den = cr[hi] - cr[lo], cm[hi] - cm[lo]
    c = np.where(den > 0, num / np.where(den > 0, den, 1), 0.0) * n / (n + SHRINK_K)
    out = np.empty(len(day))
    out[order] = np.clip(c, -CLIP, CLIP)
    return out


def hgb(train, test, stat, cols):
    m = HistGradientBoostingRegressor(loss="poisson", **HGB).fit(train[cols], train[stat])
    return m.predict(test[cols])


def boot(d: np.ndarray, weeks: np.ndarray, rng):
    wk = pd.Series(d).groupby(weeks).agg(["sum", "count"])
    s, c = wk["sum"].to_numpy(), wk["count"].to_numpy()
    idx = rng.integers(0, len(s), size=(N_BOOT, len(s)))
    st = s[idx].sum(1) / c[idx].sum(1)
    return float(d.mean()), float(np.percentile(st, 2.5)), float(np.percentile(st, 97.5))


def slope(p, over):
    z = np.log(p / (1 - p)).reshape(-1, 1)
    m = LogisticRegression(C=1e6, max_iter=200).fit(z, over)
    return float(m.coef_[0][0]), float(m.intercept_[0])


def run_fold(df: pd.DataFrame, name: str, rng) -> dict:
    tr_seasons, te_season = FOLDS[name]
    base = (df.n_prior >= 5) & df["pts_l10"].notna()
    tr = df[base & df.season.isin(tr_seasons)].sort_values("date")
    te = df[base & (df.season == te_season) & (df.min_l10 >= 20)].sort_values("date")
    cut = int(len(tr) * 0.8)
    fit_part, alpha_part = tr.iloc[:cut], tr.iloc[cut:]
    weeks = te.date.dt.to_period("W").astype(str).to_numpy()
    out = {}
    for stat in STATS:
        extra = ["h2h_n", f"h2h_{stat}_diff"]
        mu_alpha = hgb(fit_part, alpha_part, stat, FEATURES)
        disp = Dispersion().fit(mu_alpha, alpha_part[stat].to_numpy(float))
        y = te[stat].to_numpy(float)
        line = np.floor(te[f"{stat}_l10"].to_numpy(float)) + 0.5
        over = (y > line).astype(float)
        mu0 = hgb(tr, te, stat, FEATURES)
        mu_h = hgb(tr, te, stat, FEATURES + extra)
        cands = {
            "base": mu0,
            "C1_drift": mu0 * (1 + drift_factor(te.date.to_numpy(), y, mu0)),
            "C2_h2h": mu_h,
            "C3_both": mu_h * (1 + drift_factor(te.date.to_numpy(), y, mu_h)),
        }
        ls0 = nb_logpmf(y, mu0, disp.alpha(mu0))
        res = {}
        for k, mu in cands.items():
            ls = nb_logpmf(y, mu, disp.alpha(mu))
            p = np.clip(nb_p_over(line, mu, disp.alpha(mu)), 1e-4, 1 - 1e-4)
            sl, ic = slope(p, over)
            r = {"mae": float(np.mean(np.abs(y - mu))), "mean_bias": float(np.mean(y - mu)), "cal_slope": sl, "cal_intercept": ic,
                 "mean_p": float(p.mean()), "obs_over": float(over.mean())}
            if k != "base":
                d, lo, hi = boot(ls - ls0, weeks, rng)
                r.update({"dlogscore": d, "ci_lo": lo, "ci_hi": hi})
            res[k] = r
        out[stat] = res
        print(f"{name} {stat:5s} " + "  ".join(
            f"{k}: " + (f"{v['dlogscore']:+.4f} [{v['ci_lo']:+.4f},{v['ci_hi']:+.4f}]" if 'dlogscore' in v else f"mae {v['mae']:.3f}") for k, v in res.items()), flush=True)
    return {"n_test": len(te), "stats": out}


def main():
    final = "--final" in sys.argv
    df = add_h2h(pd.read_pickle(OUT / "features.pkl"))
    rng = np.random.default_rng(0)
    folds = ["F"] if final else ["A", "B"]
    res = {f: run_fold(df, f, rng) for f in folds}
    (OUT / f"improve_model_{'final' if final else 'dev'}.json").write_text(json.dumps(res, indent=1))
    (OUT / ("IMPROVE_FINAL_DONE" if final else "IMPROVE_DEV_DONE")).write_text("done")


if __name__ == "__main__":
    main()
