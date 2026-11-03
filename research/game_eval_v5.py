"""Walk-forward evaluation of the v5 candidate groups under PREREG_GAMES_V5.md. The rules are fixed there; nothing is tuned.

    ingest/.venv/Scripts/python research/game_eval_v5.py            # folds E0, A, B, F and the 2026-27 season so far
    ingest/.venv/Scripts/python research/game_eval_v5.py --rebuild  # rebuild the feature cache first

Writes research/out/games_v5.json.
"""
import json
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import game_eval_v2 as E  # noqa: E402
import game_eval_v4 as E4  # noqa: E402
import game_features_v2 as V  # noqa: E402
import game_features_v5 as V5  # noqa: E402

warnings.filterwarnings("ignore")
OUT = Path(__file__).resolve().parent / "out"
DEV = ["E0", "A", "B"]
ALPHA = 0.05 / len(V5.GROUPS)          # four comparisons: 98.75% interval


def load() -> pd.DataFrame:
    cache = OUT / "games_v5.pkl"
    if cache.exists() and "--rebuild" not in sys.argv:
        return pd.read_pickle(cache)
    _, tm = E.load_all()
    g = V5.build_v5(E.load(), tm)
    g.to_pickle(cache)
    return g


def main():
    g = load()
    reg = g[g.regular]
    rng = np.random.default_rng(0)
    models = {"lin_v2": V.LIN_V2, **{k: V.LIN_V2 + cols for k, cols in V5.GROUPS.items()}, "ALL (info)": V.LIN_V2 + [c for cols in V5.GROUPS.values() for c in cols]}
    res, kept = {}, {}
    for name, (trs, tes) in {**E.FOLDS, "new": (list(range(2018, 2026)), 2026)}.items():
        tr, te = reg[reg.season.isin(trs)], reg[reg.season == tes]
        if te.empty:
            continue
        y, weeks = te.y.to_numpy(), te.week.to_numpy()
        ll = {k: E.logloss(y, E.fit_logistic(tr, te, cols, E.C_LIN)[0]) for k, cols in models.items()}
        out = {"n_test": int(len(te)), "models": {}}
        for k, v in ll.items():
            d = ll["lin_v2"] - v
            m, lo, hi = E4.boot(d, weeks, rng) if k != "lin_v2" else (0.0, 0.0, 0.0)
            out["models"][k] = {"logloss": float(v.mean()), "dlogloss": m, "ci95_lo": lo, "ci95_hi": hi}
            print(f"{name:3s} {k:15s} logloss {v.mean():.4f}  vs lin_v2 {m:+.5f} [{lo:+.5f},{hi:+.5f}]", flush=True)
        res[name], kept[name] = out, {"y": y, "weeks": weeks, "ll": ll}
    rule = {}
    F = res["F"]["models"]
    for k in V5.GROUPS:
        d = np.concatenate([kept[f]["ll"]["lin_v2"] - kept[f]["ll"][k] for f in DEV])
        wk = np.concatenate([kept[f]["weeks"] for f in DEV])
        m, lo, hi = E4.boot(d, wk, rng, ALPHA)
        signs = [float(np.sign((kept[f]["ll"]["lin_v2"] - kept[f]["ll"][k]).mean())) for f in DEV]
        r = {"pooled_dlogloss": m, "ci_lo_98.75": lo, "ci_hi_98.75": hi, "F_not_worse": bool(F[k]["logloss"] - F["lin_v2"]["logloss"] <= 0.001),
             "positive_seasons": int(sum(1 for s in signs if s > 0)), "improves_in_at_least_two_of_three": bool(sum(1 for s in signs if s > 0) >= 2)}
        r["adopt"] = bool(lo > 0 and r["F_not_worse"] and r["improves_in_at_least_two_of_three"])
        rule[k] = r
    print("\nrule:", json.dumps(rule, indent=1))
    (OUT / "games_v5.json").write_text(json.dumps({"folds": res, "rule": rule}, indent=1))


if __name__ == "__main__":
    main()
