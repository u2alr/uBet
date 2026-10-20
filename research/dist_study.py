"""Which predictive distribution suits each stat? Rules fixed in PREREG_AUDIT.md (development folds only).

    ingest/.venv/Scripts/python research/dist_study.py
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import nbinom, norm, poisson

sys.path.insert(0, str(Path(__file__).resolve().parent))
from evaluate import FOLDS, OUT, boot_diff  # noqa: E402
from models import Dispersion, app_stats  # noqa: E402

STATS6 = ["pts", "reb", "ast", "fg3m", "stl", "blk"]
CANDS = ["native", "poisson", "nb", "nb_const", "normal"]
BUCKETS = [("<2", 0, 2), ("2-6", 2, 6), (">=6", 6, 1e9)]
MIN_ROWS = 400


# ---- discrete distributions: P(X = k) and P(X <= k) for integer k >= 0 ----

def pois(mu):
    mu = np.maximum(mu, 1e-3)
    return lambda k: poisson.pmf(k, mu), lambda k: poisson.cdf(k, mu)


def nb(mu, alpha):
    mu = np.maximum(mu, 1e-3)
    r = 1 / np.maximum(alpha, 1e-6)
    p = r / (r + mu)
    return lambda k: nbinom.pmf(k, r, p), lambda k: nbinom.cdf(k, r, p)


def disc_norm(mu, sd):
    sd = np.maximum(sd, 0.05)
    cdf = lambda k: norm.cdf((k + 0.5 - mu) / sd)  # continuity-corrected P(X <= k)
    pmf = lambda k: np.where(k <= 0, cdf(0), cdf(k) - cdf(k - 1))
    return pmf, cdf


def build(name, mu, sd, alpha_fn, const_alpha):
    if name == "poisson":
        return pois(mu)
    if name == "nb":
        return nb(mu, alpha_fn(mu))
    if name == "nb_const":
        return nb(mu, np.full_like(mu, const_alpha))
    if name == "normal":
        return disc_norm(mu, sd)
    # native: Poisson below 6, normal otherwise, exactly as shared/baseline.ts chooses
    p_pmf, p_cdf = pois(mu)
    n_pmf, n_cdf = disc_norm(mu, sd)
    low = mu < 6
    return (lambda k: np.where(low, p_pmf(k), n_pmf(k)), lambda k: np.where(low, p_cdf(k), n_cdf(k)))


def slope(p, over):
    from sklearn.linear_model import LogisticRegression

    z = np.log(np.clip(p, 1e-4, 1 - 1e-4) / (1 - np.clip(p, 1e-4, 1 - 1e-4))).reshape(-1, 1)
    return float(LogisticRegression(C=1e6).fit(z, over).coef_[0][0])


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    df = pd.read_pickle(OUT / "features.pkl").sort_values(["PLAYER_ID", "date", "GAME_ID"]).reset_index(drop=True)
    df["stl"], df["blk"] = df["STL"], df["BLK"]
    app = {s: app_stats(df, s) for s in STATS6}
    rng = np.random.default_rng(5)
    results = {}
    for fold, (train_seasons, test_season) in FOLDS.items():
        ok = (df.n_prior >= 5) & df["pts_l10"].notna()
        tr = df[ok & df.season.isin(train_seasons)].sort_values("date")
        te = df[ok & (df.season == test_season)].sort_values("date")
        cut = int(len(tr) * 0.8)
        weeks_all = te.date.dt.to_period("W").astype(str).to_numpy()
        results[fold] = {}
        print(f"\n=== {fold}: train {len(tr):,}, test {len(te):,} rows ===")
        for s in STATS6:
            a = app[s]
            mu_tr, sd_tr = a.loc[tr.index, "mean"].to_numpy(float), a.loc[tr.index, "spread"].to_numpy(float)
            mu, sd = a.loc[te.index, "mean"].to_numpy(float), a.loc[te.index, "spread"].to_numpy(float)
            y_tr, y = tr[s].to_numpy(float), te[s].to_numpy(float)
            disp = Dispersion().fit(mu_tr[cut:], y_tr[cut:])
            const_alpha = max(float((((y_tr[cut:] - mu_tr[cut:]) ** 2 - mu_tr[cut:]).sum()) / (mu_tr[cut:] ** 2).sum()), 1e-3)
            line = np.floor(te[f"{s}_l10"].to_numpy(float)) + 0.5 if f"{s}_l10" in te else np.floor(mu) + 0.5
            over = (y > line).astype(float)
            ls, pover = {}, {}
            for c in CANDS:
                pmf, cdf = build(c, mu, sd, disp.alpha, const_alpha)
                ls[c] = np.log(np.maximum(pmf(y), 1e-12))
                pover[c] = np.clip(1 - cdf(np.floor(line)), 1e-4, 1 - 1e-4)
            for name, lo, hi in BUCKETS:
                m = (mu >= lo) & (mu < hi)
                if m.sum() == 0:
                    continue
                row = {"n": int(m.sum())}
                for c in CANDS:
                    row[c] = {"log_score": float(ls[c][m].mean()), "brier": float(((pover[c][m] - over[m]) ** 2).mean()),
                              "slope": slope(pover[c][m], over[m]) if m.sum() >= 200 else None}
                    if c != "native":
                        d, lo_ci, hi_ci = boot_diff(ls[c][m], ls["native"][m], weeks_all[m], rng)
                        row[c].update(diff_vs_native=d, ci=[lo_ci, hi_ci])
                results[fold][f"{s}|{name}"] = row
                best = max(CANDS, key=lambda c: row[c]["log_score"])
                print(f"  {s:<5}{name:>5} n={row['n']:>6}  " + "  ".join(
                    f"{c}:{row[c]['log_score']:.4f}" + ("" if c == "native" else f"({row[c]['diff_vs_native']:+.4f})") for c in CANDS)
                    + f"   best={best}  slope native/nb: {row['native']['slope'] and round(row['native']['slope'], 2)}/{row['nb']['slope'] and round(row['nb']['slope'], 2)}")
    (OUT / "dist_study.json").write_text(json.dumps(results, indent=1))

    # Apply the pre-registered rule mechanically.
    print("\n=== decision rule: a candidate replaces native only if its CI is above 0 in BOTH folds and n >= 400 in both ===")
    folds = list(results)
    cells = sorted({k for f in folds for k in results[f]})
    any_change = False
    for cell in cells:
        for c in CANDS[1:]:
            ok = True
            for f in folds:
                r = results[f].get(cell)
                if not r or r["n"] < MIN_ROWS or r[c]["ci"][0] <= 0:
                    ok = False
            if ok:
                any_change = True
                print(f"  CHANGE  {cell:<12} -> {c}   diffs " + ", ".join(f"{results[f][cell][c]['diff_vs_native']:+.4f}" for f in folds))
    if not any_change:
        print("  no cell qualifies: keep native everywhere")


if __name__ == "__main__":
    main()
