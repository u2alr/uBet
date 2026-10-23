"""Calibration of the PRA (points + rebounds + assists) projection, exactly as PREREG_CALIBRATION.md Amendment B describes.
Adds a `pra` entry to shared/calibration.json and leaves the other four statistics untouched.

    ingest/.venv/Scripts/python research/calibrate_pra.py
"""
import hashlib
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import calibrate as C  # noqa: E402
from features import FEATURES  # noqa: E402
from models import HGB, Dispersion, nb_p_over  # noqa: E402

OUT = HERE / "out"
FOLDS = {"A": ([2022], 2023), "B": ([2022, 2023], 2024), "F": ([2022, 2023, 2024], 2025)}


def fold_rows(df: pd.DataFrame, tr_seasons, te_season):
    base = (df.n_prior >= 5) & df["pts_l10"].notna()
    tr = df[base & df.season.isin(tr_seasons)].sort_values("date")
    te = df[base & (df.season == te_season) & (df.min_l10 >= C.MIN_MINUTES)].sort_values("date")
    cut = int(len(tr) * 0.8)
    fit_part, alpha_part = tr.iloc[:cut], tr.iloc[cut:]
    probe = HistGradientBoostingRegressor(loss="poisson", **HGB).fit(fit_part[FEATURES], fit_part["pra"])
    disp = Dispersion().fit(probe.predict(alpha_part[FEATURES]), alpha_part["pra"].to_numpy(float))
    mu = HistGradientBoostingRegressor(loss="poisson", **HGB).fit(tr[FEATURES], tr["pra"]).predict(te[FEATURES])
    line = np.floor((te.pts_l10 + te.reb_l10 + te.ast_l10).to_numpy(float)) + 0.5
    y = te["pra"].to_numpy(float)
    p = np.clip(nb_p_over(line, mu, disp.alpha(mu)), 1e-4, 1 - 1e-4)
    return p, (y > line).astype(float), te.date.dt.to_period("W").astype(str).to_numpy()


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    lock = OUT / "CALIBRATION_PRA_DONE"
    if lock.exists():
        sys.exit("The final season was already used for PRA. Delete the lock only to record a new pre-registered experiment.")
    t0 = time.time()
    df = pd.read_pickle(OUT / "features.pkl")
    df["pra"] = df.pts + df.reb + df.ast
    (pa, ya, wa), (pb, yb, wb), (pf, yf, wf) = (fold_rows(df, *FOLDS[k]) for k in ("A", "B", "F"))
    print(f"rows A {len(ya)} B {len(yb)} F {len(yf)} ({time.time() - t0:.0f}s)", flush=True)

    rng = np.random.default_rng(11)
    method, sel = C.choose(pa, ya, pb, yb)
    cal_a = C.Calibrator(method).fit(pa, ya)
    val_raw, val_cal = C.metrics(pb, yb, wb, rng), C.metrics(cal_a.predict(pb), yb, wb, rng)
    p_ab, y_ab, w_ab = np.concatenate([pa, pb]), np.concatenate([ya, yb]), np.concatenate([wa, wb])
    cal = C.Calibrator(method).fit(p_ab, y_ab)
    fin_raw, fin_cal = C.metrics(pf, yf, wf, rng), C.metrics(cal.predict(pf), yf, wf, rng)
    fails = [f"fold B: {m}" for m in C.gate_check(val_cal, val_raw)] + [f"final: {m}" for m in C.gate_check(fin_cal, fin_raw)]
    grid = C.grid_bounds(method, p_ab, y_ab, w_ab, rng)
    entry = {
        "method": method, "params": cal.params(), "status": "validated" if not fails else "unvalidated", "failedGates": fails,
        "trainRows": int(len(y_ab)), "grid": {"p": C.GRID.tolist(), **grid},
        "validation": {"foldB": {"raw": val_raw, "calibrated": val_cal}, "final": {"raw": fin_raw, "calibrated": fin_cal}},
    }
    art = json.loads(C.ARTIFACT.read_text(encoding="utf-8"))
    art["stats"]["pra"] = entry
    art["hash"] = hashlib.sha256(json.dumps(art["stats"], sort_keys=True).encode()).hexdigest()[:16]
    art["version"] = time.strftime("%Y-%m-%d")
    C.ARTIFACT.write_text(json.dumps(art, indent=1), encoding="utf-8")
    (OUT / "calibration_pra_results.json").write_text(json.dumps({"selection_logloss_on_foldB": sel, "entry": entry}, indent=1), encoding="utf-8")
    lock.write_text(time.strftime("%Y-%m-%d %H:%M:%S"))
    print(f"pra: method={method} status={entry['status']} fails={fails} | foldB slope {val_raw['slope']:.3f}->{val_cal['slope']:.3f} "
          f"ece {val_raw['ece']:.4f}->{val_cal['ece']:.4f} | final slope {fin_raw['slope']:.3f}->{fin_cal['slope']:.3f} ece {fin_raw['ece']:.4f}->{fin_cal['ece']:.4f} ({time.time() - t0:.0f}s)")


if __name__ == "__main__":
    main()
