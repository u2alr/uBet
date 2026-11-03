"""In-season learning candidates (PREREG_GAMES_V2.md, last addendum): online recalibration and an early-season shrink, applied to the walk-forward lin_v2 probabilities.

    ingest/.venv/Scripts/python research/game_eval_adapt.py
"""
import json
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import minimize_scalar

sys.path.insert(0, str(Path(__file__).resolve().parent))
import game_eval_v2 as E  # noqa: E402
import game_features_v2 as V  # noqa: E402
from improve_model import boot  # noqa: E402

warnings.filterwarnings("ignore")
PRIOR = 40.0
SHRINK = 0.85
EARLY = 0.08
EPS = 1e-6
logit = lambda p: np.log(p / (1 - p))  # noqa: E731
sigmoid = lambda z: 1 / (1 + np.exp(-z))  # noqa: E731


def online(te: pd.DataFrame, p: np.ndarray) -> np.ndarray:
    """P = sigmoid(a * logit(p)) with `a` fitted on that season's strictly earlier games, shrunk toward 1."""
    z, y, dates = logit(p), te.y.to_numpy(), pd.to_datetime(te.date).to_numpy()
    out = p.copy()
    for d in np.unique(dates):
        past = dates < d
        a = 1.0
        if past.sum() >= 10:
            zp, yp = z[past], y[past]
            def loss(a_):
                s = np.clip(sigmoid(a_ * zp), EPS, 1 - EPS)
                return -(yp * np.log(s) + (1 - yp) * np.log(1 - s)).sum() + PRIOR * (a_ - 1) ** 2
            a = float(minimize_scalar(loss, bounds=(0.3, 1.7), method="bounded").x)
        m = dates == d
        out[m] = sigmoid(a * z[m])
    return np.clip(out, EPS, 1 - EPS)


def early(te: pd.DataFrame, p: np.ndarray) -> np.ndarray:
    rank = te.groupby("season").cumcount().to_numpy() / len(te)
    z = logit(p) * np.where(rank < EARLY, SHRINK, 1.0)
    return np.clip(sigmoid(z), EPS, 1 - EPS)


def main():
    g = E.load()
    reg = g[g.regular]
    rng = np.random.default_rng(0)
    res, parts = {}, {"online": [], "early": []}
    for f, (trs, tes) in E.FOLDS.items():
        tr, te = reg[reg.season.isin(trs)], reg[reg.season == tes].sort_values(["date", "GAME_ID"])
        p, _ = E.fit_logistic(tr, te, V.LIN_V2, E.C_LIN)
        y, weeks = te.y.to_numpy(), te.week.to_numpy()
        base = E.logloss(y, p)
        res[f] = {"lin_v2": float(base.mean())}
        for name, fn in (("online", online), ("early", early)):
            q = fn(te, p)
            d = base - E.logloss(y, q)
            m, lo, hi = boot(d, weeks, rng)
            res[f][name] = {"logloss": float(E.logloss(y, q).mean()), "dlogloss": m, "ci_lo": lo, "ci_hi": hi}
            if f != "F":
                parts[name].append((d, weeks))
            print(f"{f:3s} {name:7s} logloss {E.logloss(y, q).mean():.4f} vs lin_v2 {base.mean():.4f}  d {m:+.5f} [{lo:+.5f},{hi:+.5f}]", flush=True)
    rule = {}
    for name in parts:
        d = np.concatenate([x[0] for x in parts[name]])
        wk = np.concatenate([x[1] for x in parts[name]])
        m, lo, hi = boot(d, wk, rng)
        rule[name] = {"pooled_dlogloss": m, "ci_lo": lo, "ci_hi": hi, "F_not_worse_by_0.001": bool(res["F"][name]["logloss"] - res["F"]["lin_v2"] <= 0.001)}
        rule[name]["adopt"] = bool(lo > 0 and rule[name]["F_not_worse_by_0.001"])
    print(json.dumps(rule, indent=1))
    (E.OUT / "games_adapt.json").write_text(json.dumps({"folds": res, "rule": rule}, indent=1))


if __name__ == "__main__":
    main()
