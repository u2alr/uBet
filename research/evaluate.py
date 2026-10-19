"""Walk-forward evaluation of the prop models. Market-independent: no sportsbook lines exist in this data.

    ingest/.venv/Scripts/python research/evaluate.py            # development folds (2022-23 -> 2023-24 -> 2024-25)
    ingest/.venv/Scripts/python research/evaluate.py --final    # held-out 2025-26, ONCE, after PREREG.md is committed

What is measured, and what is not
- Accuracy of each model's projected mean (MAE, RMSE) and the full predictive distribution (negative-binomial
  log score, a proper scoring rule). These need no betting lines.
- Calibration/Brier on PSEUDO-lines (nearest half-integer to the player's last-10 mean). This is a NAIVE line,
  far weaker than a sportsbook's. Beating it says the model beats naive baselines. It does NOT show an edge
  over the market. That needs real timestamped lines, which this data does not contain.
"""
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from features import STATS  # noqa: E402
from models import (  # noqa: E402
    Dispersion, app_p_over, app_stats, baseline_means, fit_minutes, fit_predict_hgb, nb_logpmf, nb_p_over,
)

OUT = Path(__file__).resolve().parent / "out"
MODELS = ["b0", "b1", "app", "m2", "m3"]
FOLDS = {"A: train 2022-23 -> test 2023-24": ([2022], 2023), "B: train 2022-24 -> test 2024-25": ([2022, 2023], 2024)}
FINAL = ([2022, 2023, 2024], 2025)
N_BOOT = 2000


def eligible(df: pd.DataFrame) -> pd.Series:
    """Same rule the app uses: at least 5 prior games. Plus a usable last-10 mean."""
    return (df.n_prior >= 5) & df["pts_l10"].notna()


def all_means(train: pd.DataFrame, test: pd.DataFrame, stat: str, app_cols: pd.DataFrame, mins: dict) -> dict:
    """Mean predictions of every model for `test`, with HGB fitted on `train`."""
    out = {}
    out.update({k: v for k, v in baseline_means(test, stat).items()})
    out["app"] = app_cols.loc[test.index, "mean"].to_numpy(float)
    out.update(fit_predict_hgb(train, test, stat, mins["pred"]))
    return out


def run(train_seasons: list[int], test_season: int, df: pd.DataFrame, app: dict) -> dict:
    ok = eligible(df)
    tr_all = df[ok & df.season.isin(train_seasons)].sort_values("date")
    te = df[ok & (df.season == test_season)].sort_values("date")
    assert tr_all.date.max() < te.date.min(), "train must end before test begins"

    # Dispersion is fitted on the last 20% of the training period, using models fitted on the first 80%,
    # so in-sample overfit can't shrink it. Every model gets the same treatment.
    cut = int(len(tr_all) * 0.8)
    fit_part, alpha_part = tr_all.iloc[:cut], tr_all.iloc[cut:]

    mins_alpha = {"pred": fit_minutes(fit_part, alpha_part)}
    mins_test = {"pred": fit_minutes(tr_all, te)}

    results, rows = {}, {}
    for stat in STATS:
        app_cols = app[stat]
        mu_alpha = all_means(fit_part, alpha_part, stat, app_cols, mins_alpha)
        mu_test = all_means(tr_all, te, stat, app_cols, mins_test)
        y = te[stat].to_numpy(float)
        y_alpha = alpha_part[stat].to_numpy(float)
        line = np.floor(te[f"{stat}_l10"].to_numpy(float)) + 0.5  # pseudo-line: naive, see module docstring
        over = (y > line).astype(float)

        per_model, per_row = {}, {}
        for name in MODELS:
            disp = Dispersion().fit(mu_alpha[name], y_alpha)
            mu = mu_test[name]
            alpha = disp.alpha(mu)
            ls = nb_logpmf(y, mu, alpha)  # higher is better
            p = np.clip(nb_p_over(line, mu, alpha), 1e-4, 1 - 1e-4)
            per_model[name] = {
                "mae": float(np.mean(np.abs(y - mu))),
                "rmse": float(np.sqrt(np.mean((y - mu) ** 2))),
                "log_score": float(np.mean(ls)),
                "brier_pseudo": float(np.mean((p - over) ** 2)),
                "logloss_pseudo": float(-np.mean(over * np.log(p) + (1 - over) * np.log(1 - p))),
            }
            per_row[name] = ls
            per_row[name + "_p"] = p
        # The app's native distribution (normal / Poisson), as users see it.
        pn = np.clip(app_p_over(mu_test["app"], app_cols.loc[te.index, "spread"].to_numpy(float), line), 1e-4, 1 - 1e-4)
        per_model["app_native"] = {
            "brier_pseudo": float(np.mean((pn - over) ** 2)),
            "logloss_pseudo": float(-np.mean(over * np.log(pn) + (1 - over) * np.log(1 - pn))),
        }
        per_row["app_native_p"] = pn
        per_row["over"] = over
        results[stat] = per_model
        rows[stat] = per_row

    meta = {"n_train": len(tr_all), "n_test": len(te), "n_test_rotation": int((te.min_l10 >= 20).sum())}
    return {"metrics": results, "rows": rows, "te": te, "meta": meta}


def boot_diff(loss_a: np.ndarray, loss_b: np.ndarray, weeks: np.ndarray, rng) -> tuple[float, float, float]:
    """Mean of (a - b) with a 95% CI from resampling whole calendar weeks (rows in a week are dependent)."""
    d = loss_a - loss_b
    wk = pd.Series(d).groupby(weeks).agg(["sum", "count"])
    s, c = wk["sum"].to_numpy(), wk["count"].to_numpy()
    idx = rng.integers(0, len(s), size=(N_BOOT, len(s)))
    stats = s[idx].sum(1) / c[idx].sum(1)
    return float(d.mean()), float(np.percentile(stats, 2.5)), float(np.percentile(stats, 97.5))


def calibration(p: np.ndarray, over: np.ndarray, bins: int = 10) -> list[dict]:
    edges = np.linspace(0, 1, bins + 1)
    idx = np.clip(np.digitize(p, edges) - 1, 0, bins - 1)
    return [
        {"bin": f"{edges[b]:.1f}-{edges[b + 1]:.1f}", "n": int((idx == b).sum()),
         "predicted": round(float(p[idx == b].mean()), 3), "observed": round(float(over[idx == b].mean()), 3)}
        for b in range(bins) if (idx == b).sum() >= 30
    ]


def calib_slope(p: np.ndarray, over: np.ndarray) -> float:
    """Slope of observed outcome on logit(prediction); 1.0 = perfectly calibrated, <1 = overconfident."""
    from sklearn.linear_model import LogisticRegression

    z = np.log(p / (1 - p)).reshape(-1, 1)
    return float(LogisticRegression(C=1e6).fit(z, over).coef_[0][0])


def report(name: str, res: dict, rng) -> dict:
    te, rows = res["te"], res["rows"]
    weeks = te.date.dt.to_period("W").astype(str).to_numpy()
    rot = (te.min_l10 >= 20).to_numpy()
    print(f"\n=== {name} | train {res['meta']['n_train']:,} rows, test {res['meta']['n_test']:,} "
          f"({res['meta']['n_test_rotation']:,} rotation players, last-10 minutes >= 20) ===")
    out = {"meta": res["meta"], "metrics": res["metrics"], "paired": {}, "calibration": {}}
    for stat in STATS:
        m = res["metrics"][stat]
        print(f"\n  {stat.upper()}  (all eligible rows)")
        print("   model        MAE    RMSE  logscore  brier*  logloss*")
        for k in MODELS + ["app_native"]:
            v = m[k]
            print(f"   {k:<11} {v.get('mae', float('nan')):6.3f} {v.get('rmse', float('nan')):6.3f} "
                  f"{v.get('log_score', float('nan')):9.4f} {v['brier_pseudo']:7.4f} {v['logloss_pseudo']:8.4f}")
        # Paired differences in per-row log score (positive = first model is better).
        for subset, mask in [("all", np.ones(len(te), bool)), ("rotation", rot)]:
            for a, b in [("m2", "app"), ("m3", "app"), ("m2", "b1"), ("app", "b1"), ("m3", "m2")]:
                d, lo, hi = boot_diff(rows[stat][a][mask], rows[stat][b][mask], weeks[mask], rng)
                out["paired"][f"{stat}|{subset}|{a}-{b}"] = {"diff": d, "lo": lo, "hi": hi}
            ln = " ".join(
                f"{a}-{b}: {out['paired'][f'{stat}|{subset}|{a}-{b}']['diff']:+.4f} "
                f"[{out['paired'][f'{stat}|{subset}|{a}-{b}']['lo']:+.4f},{out['paired'][f'{stat}|{subset}|{a}-{b}']['hi']:+.4f}]"
                for a, b in [("m2", "app"), ("m3", "app"), ("m2", "b1"), ("app", "b1")]
            )
            print(f"   log-score diff, {subset:<8}: {ln}")
        over = rows[stat]["over"]
        for k in ("app_native_p", "m2_p"):
            out["calibration"][f"{stat}|{k}"] = {"slope": calib_slope(rows[stat][k], over), "bins": calibration(rows[stat][k], over)}
        print(f"   calibration slope (pseudo-lines): app_native {out['calibration'][f'{stat}|app_native_p']['slope']:.3f}"
              f"  m2 {out['calibration'][f'{stat}|m2_p']['slope']:.3f}   (1.0 = calibrated; <1 = overconfident)")
    print("\n  * pseudo-line = nearest half-integer to the last-10 mean: a NAIVE line, not a sportsbook line.")
    return out


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    final = "--final" in sys.argv
    lock = OUT / "FINAL_RUN_DONE"
    if final:
        if lock.exists():
            sys.exit("The held-out season has already been evaluated (research/out/FINAL_RUN_DONE). "
                     "Re-running it would turn it into a tuning set. Delete the lock only to record a new, "
                     "pre-registered experiment.")
        if not (Path(__file__).resolve().parent / "PREREG.md").exists():
            sys.exit("Write research/PREREG.md (pass/fail thresholds) before touching the held-out season.")

    t0 = time.time()
    df = pd.read_pickle(OUT / "features.pkl").sort_values(["PLAYER_ID", "date", "GAME_ID"]).reset_index(drop=True)
    app = {s: app_stats(df, s) for s in STATS}
    print(f"features + app-model port ready in {time.time() - t0:.0f}s")

    rng = np.random.default_rng(7)
    results = {}
    folds = {"FINAL held-out: train 2022-24 -> test 2025-26": FINAL} if final else FOLDS
    for name, (tr, te) in folds.items():
        res = run(tr, te, df, app)
        results[name] = report(name, res, rng)
        print(f"  ({time.time() - t0:.0f}s elapsed)")
    out_file = OUT / ("final_results.json" if final else "dev_results.json")
    out_file.write_text(json.dumps(results, indent=1))
    if final:
        lock.write_text(time.strftime("%Y-%m-%d %H:%M:%S"))
    print(f"\nwrote {out_file}")


if __name__ == "__main__":
    main()
