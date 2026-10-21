"""Walk-forward probability calibration with bootstrap uncertainty. Rules: research/PREREG_CALIBRATION.md.

    ingest/.venv/Scripts/python research/calibrate.py

Writes shared/calibration.json (read by the decision engine) and research/out/calibration_results.json.
The final season is evaluated once; delete research/out/CALIBRATION_FINAL_DONE only to record a new pre-registered experiment.
"""
import hashlib
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from evaluate import FINAL, FOLDS, run  # noqa: E402
from features import STATS  # noqa: E402
from models import app_stats  # noqa: E402

OUT = HERE / "out"
ARTIFACT = HERE.parent / "shared" / "calibration.json"
MIN_MINUTES = 24.0
N_BOOT = 400
GRID = np.round(np.arange(0.02, 0.9801, 0.01), 2)
LEVELS = {"80": 0.20, "90": 0.10, "95": 0.05}      # one-sided: lower bound at this quantile, upper at 1 - quantile
MIN_ISOTONIC_ROWS = 5000
ISOTONIC_MARGIN = 0.0005
GATES = {"min_n": 3000, "slope": (0.85, 1.15), "ece": 0.03, "logloss_slack": 0.001}
EPS = 1e-4


def clip(p):
    return np.clip(np.asarray(p, float), EPS, 1 - EPS)


def logit(p):
    p = clip(p)
    return np.log(p / (1 - p))


class Calibrator:
    """identity | platt (logistic on logit p, with intercept) | isotonic. fit(p, y) -> predict(p)."""

    def __init__(self, method: str):
        self.method = method

    def fit(self, p, y):
        if self.method == "platt":
            self.m = LogisticRegression(C=1e6, max_iter=1000).fit(logit(p).reshape(-1, 1), y)
        elif self.method == "isotonic":
            self.m = IsotonicRegression(y_min=EPS, y_max=1 - EPS, out_of_bounds="clip").fit(clip(p), y)
        return self

    def predict(self, p):
        if self.method == "identity":
            return clip(p)
        if self.method == "platt":
            return clip(self.m.predict_proba(logit(p).reshape(-1, 1))[:, 1])
        return clip(self.m.predict(clip(p)))

    def params(self):
        if self.method == "platt":
            return {"intercept": float(self.m.intercept_[0]), "slope": float(self.m.coef_[0][0])}
        return {}


def brier(p, y):
    return float(np.mean((clip(p) - y) ** 2))


def logloss(p, y):
    p = clip(p)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def ece(p, y, bins=10):
    edges = np.linspace(0, 1, bins + 1)
    idx = np.clip(np.digitize(p, edges) - 1, 0, bins - 1)
    num, tot = 0.0, 0
    for b in range(bins):
        m = idx == b
        if m.sum() >= 30:
            num += m.sum() * abs(p[m].mean() - y[m].mean())
            tot += m.sum()
    return float(num / tot) if tot else float("nan")


def slope(p, y):
    return float(LogisticRegression(C=1e6, max_iter=1000).fit(logit(p).reshape(-1, 1), y).coef_[0][0])


def week_boot(fn, p, y, weeks, rng, n=200):
    """95% interval of fn(p, y) resampling whole calendar weeks."""
    uw = np.unique(weeks)
    groups = {w: np.where(weeks == w)[0] for w in uw}
    vals = []
    for _ in range(n):
        pick = rng.choice(uw, size=len(uw), replace=True)
        idx = np.concatenate([groups[w] for w in pick])
        vals.append(fn(p[idx], y[idx]))
    return [float(np.percentile(vals, 2.5)), float(np.percentile(vals, 97.5))]


def metrics(p, y, weeks, rng, with_ci=True):
    out = {"n": int(len(y)), "brier": brier(p, y), "logloss": logloss(p, y), "ece": ece(p, y), "slope": slope(p, y), "mean_p": float(np.mean(p)), "mean_y": float(np.mean(y))}
    if with_ci:
        out["slope_ci95"] = week_boot(slope, p, y, weeks, rng)
    return out


def choose(p_tr, y_tr, p_va, y_va):
    """Pick the method by validation log loss, with the pre-registered margin for the flexible one."""
    res = {"identity": logloss(p_va, y_va)}
    plat = Calibrator("platt").fit(p_tr, y_tr)
    res["platt"] = logloss(plat.predict(p_va), y_va)
    iso = None
    if len(y_tr) >= MIN_ISOTONIC_ROWS:
        iso = Calibrator("isotonic").fit(p_tr, y_tr)
        res["isotonic"] = logloss(iso.predict(p_va), y_va)
    method = "identity"
    if res["platt"] < res["identity"]:
        method = "platt"
    if iso is not None and res["isotonic"] < min(res["platt"], res["identity"]) - ISOTONIC_MARGIN:
        method = "isotonic"
    return method, res


def reliability_bounds(p, y, weeks, rng):
    """Identity method: bounds from the model's measured reliability near each probability (Amendment A).

    For every grid point, the observed Over rate among predictions within a window (>= 0.05 wide, widened until >= 300 rows),
    with whole calendar weeks bootstrapped. The central value stays the raw probability; bounds are clipped to bracket it.
    """
    uw = np.unique(weeks)
    wk_index = {w: i for i, w in enumerate(uw)}
    wi = np.array([wk_index[w] for w in weeks])
    S = np.zeros((len(uw), len(GRID)))
    N = np.zeros((len(uw), len(GRID)))
    for j, g in enumerate(GRID):
        half = 0.05
        while True:
            m = np.abs(p - g) <= half
            if m.sum() >= 300 or half >= 0.5:
                break
            half += 0.01
        np.add.at(S[:, j], wi[m], y[m])
        np.add.at(N[:, j], wi[m], 1.0)
    freq = np.zeros((N_BOOT, len(GRID)))
    for b in range(N_BOOT):
        counts = np.bincount(rng.integers(0, len(uw), size=len(uw)), minlength=len(uw)).astype(float)
        num, den = counts @ S, counts @ N
        freq[b] = np.where(den > 0, num / np.maximum(den, 1e-9), GRID)
    out = {"cal": GRID.tolist(), "localFrequency": [float(x) for x in (np.sum(S, 0) / np.maximum(np.sum(N, 0), 1e-9))]}
    for k, q in LEVELS.items():
        out[f"lo{k}"] = [float(x) for x in np.minimum(np.percentile(freq, 100 * q, axis=0), GRID)]
        out[f"hi{k}"] = [float(x) for x in np.maximum(np.percentile(freq, 100 * (1 - q), axis=0), GRID)]
    return out


def grid_bounds(method, p, y, weeks, rng):
    """Bootstrap (whole weeks) of the calibrated value at each grid point: median plus lower/upper bounds."""
    if method == "identity":
        return reliability_bounds(p, y, weeks, rng)
    uw = np.unique(weeks)
    groups = {w: np.where(weeks == w)[0] for w in uw}
    preds = np.zeros((N_BOOT, len(GRID)))
    for b in range(N_BOOT):
        pick = rng.choice(uw, size=len(uw), replace=True)
        idx = np.concatenate([groups[w] for w in pick])
        preds[b] = Calibrator(method).fit(p[idx], y[idx]).predict(GRID)
    full = Calibrator(method).fit(p, y).predict(GRID)
    out = {"cal": [float(x) for x in full]}
    for k, q in LEVELS.items():
        out[f"lo{k}"] = [float(x) for x in np.minimum(np.percentile(preds, 100 * q, axis=0), full)]
        out[f"hi{k}"] = [float(x) for x in np.maximum(np.percentile(preds, 100 * (1 - q), axis=0), full)]
    return out


def gate_check(cal_metrics, raw_metrics):
    fails = []
    if cal_metrics["n"] < GATES["min_n"]:
        fails.append(f"n {cal_metrics['n']} < {GATES['min_n']}")
    lo, hi = GATES["slope"]
    if not (lo <= cal_metrics["slope"] <= hi):
        fails.append(f"slope {cal_metrics['slope']:.3f} outside [{lo}, {hi}]")
    if not (cal_metrics["ece"] <= GATES["ece"]):
        fails.append(f"ECE {cal_metrics['ece']:.4f} > {GATES['ece']}")
    if cal_metrics["logloss"] > raw_metrics["logloss"] + GATES["logloss_slack"]:
        fails.append(f"log loss worse than raw ({cal_metrics['logloss']:.4f} vs {raw_metrics['logloss']:.4f})")
    return fails


def collect(res, stat):
    te = res["te"]
    keep = (te.min_l10 >= MIN_MINUTES).to_numpy()
    p = np.asarray(res["rows"][stat]["m2_p"], float)[keep]
    y = np.asarray(res["rows"][stat]["over"], float)[keep]
    weeks = te.date.dt.to_period("W").astype(str).to_numpy()[keep]
    return p, y, weeks


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    lock = OUT / "CALIBRATION_FINAL_DONE"
    if lock.exists():
        sys.exit("The final season was already used to evaluate the calibrator. Delete the lock only to record a new pre-registered experiment.")
    if not (HERE / "PREREG_CALIBRATION.md").exists():
        sys.exit("Write research/PREREG_CALIBRATION.md first.")
    t0 = time.time()
    df = pd.read_pickle(OUT / "features.pkl").sort_values(["PLAYER_ID", "date", "GAME_ID"]).reset_index(drop=True)
    app = {s: app_stats(df, s) for s in STATS}
    print(f"features ready in {time.time() - t0:.0f}s", flush=True)

    (name_a, (tr_a, te_a)), (name_b, (tr_b, te_b)) = list(FOLDS.items())
    fold_a = run(tr_a, te_a, df, app)
    print(f"fold A done ({time.time() - t0:.0f}s)", flush=True)
    fold_b = run(tr_b, te_b, df, app)
    print(f"fold B done ({time.time() - t0:.0f}s)", flush=True)
    final = run(FINAL[0], FINAL[1], df, app)
    print(f"final done ({time.time() - t0:.0f}s)", flush=True)

    rows = {}
    for stat in STATS:
        for tag, res in (("A", fold_a), ("B", fold_b), ("F", final)):
            p_, y_, w_ = collect(res, stat)
            rows[f"{stat}_{tag}_p"], rows[f"{stat}_{tag}_y"], rows[f"{stat}_{tag}_w"] = p_, y_, w_
    np.savez_compressed(OUT / "calibration_rows.npz", **rows)

    rng = np.random.default_rng(11)
    artifact = {
        "version": time.strftime("%Y-%m-%d"),
        "generatedBy": "research/calibrate.py",
        "rules": "research/PREREG_CALIBRATION.md",
        "confidenceLevels": list(LEVELS),
        "population": f"last-10 minutes >= {MIN_MINUTES:g}",
        "boundsMethod": "identity: local observed reliability, weeks bootstrapped; platt/isotonic: refit bootstrap (research/PREREG_CALIBRATION.md, Amendment A)",
        "caveat": "Calibrated on pseudo-lines (nearest half-integer to the last-10 mean), not sportsbook lines. Says nothing about an edge over a market.",
        "trainedOn": "2023-24 and 2024-25 out-of-sample predictions (model trained on earlier seasons only)",
        "evaluatedOnce": "2025-26 (model trained on 2022-24; calibrator fitted without it)",
        "stats": {},
    }
    details = {}
    for stat in STATS:
        pa, ya, wa = collect(fold_a, stat)
        pb, yb, wb = collect(fold_b, stat)
        pf, yf, wf = collect(final, stat)
        method, sel = choose(pa, ya, pb, yb)
        # fold B: calibrator fitted on A only
        cal_a = Calibrator(method).fit(pa, ya)
        val_raw, val_cal = metrics(pb, yb, wb, rng), metrics(cal_a.predict(pb), yb, wb, rng)
        # production calibrator: A and B together; evaluated once on the final season
        p_ab, y_ab, w_ab = np.concatenate([pa, pb]), np.concatenate([ya, yb]), np.concatenate([wa, wb])
        cal = Calibrator(method).fit(p_ab, y_ab)
        fin_raw, fin_cal = metrics(pf, yf, wf, rng), metrics(cal.predict(pf), yf, wf, rng)
        fails = [f"fold B: {m}" for m in gate_check(val_cal, val_raw)] + [f"final: {m}" for m in gate_check(fin_cal, fin_raw)]
        grid = grid_bounds(method, p_ab, y_ab, w_ab, rng)
        artifact["stats"][stat] = {
            "method": method, "params": cal.params(), "status": "validated" if not fails else "unvalidated", "failedGates": fails,
            "trainRows": int(len(y_ab)), "grid": {"p": GRID.tolist(), **grid},
            "validation": {"foldB": {"raw": val_raw, "calibrated": val_cal}, "final": {"raw": fin_raw, "calibrated": fin_cal}},
        }
        details[stat] = {"selection_logloss_on_foldB": sel, "method": method}
        print(f"{stat}: method={method} status={artifact['stats'][stat]['status']} fails={fails} "
              f"| foldB slope {val_raw['slope']:.3f}->{val_cal['slope']:.3f} ece {val_raw['ece']:.4f}->{val_cal['ece']:.4f} "
              f"| final slope {fin_raw['slope']:.3f}->{fin_cal['slope']:.3f} ece {fin_raw['ece']:.4f}->{fin_cal['ece']:.4f} ({time.time() - t0:.0f}s)", flush=True)

    artifact["hash"] = hashlib.sha256(json.dumps(artifact["stats"], sort_keys=True).encode()).hexdigest()[:16]
    ARTIFACT.write_text(json.dumps(artifact, indent=1), encoding="utf-8")
    (OUT / "calibration_results.json").write_text(json.dumps({"selection": details, "artifact": artifact}, indent=1), encoding="utf-8")
    lock.write_text(time.strftime("%Y-%m-%d %H:%M:%S"))
    print(f"wrote {ARTIFACT} ({ARTIFACT.stat().st_size / 1e3:.0f} KB)")


if __name__ == "__main__":
    main()
