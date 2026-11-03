"""Walk-forward evaluation of the v3 candidates (returning players, roster-aware preseason prior) under PREREG_GAMES_V3.md. The rules are fixed there; nothing is tuned.

    ingest/.venv/Scripts/python research/game_eval_v3.py            # folds E0, A, B, F and the 2026-27 season so far
    ingest/.venv/Scripts/python research/game_eval_v3.py --rebuild  # rebuild the feature cache first

Writes research/out/games_v3.json.
"""
import json
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import game_eval_v2 as E  # noqa: E402
import game_features as G  # noqa: E402
import game_features_v2 as V  # noqa: E402
import game_features_v3 as V3  # noqa: E402
from improve_model import boot  # noqa: E402

warnings.filterwarnings("ignore")
OUT = Path(__file__).resolve().parent / "out"
DEV = ["E0", "A", "B"]
MODELS = {"lin_v2": V.LIN_V2, "+returns": V.LIN_V2 + ["rd_diff"], "+prior": V.LIN_V2 + ["prior_early"], "+both": V.LIN_V2 + ["rd_diff", "prior_early"],
          "+prior_raw (info)": V.LIN_V2 + ["prior_early_raw"]}


def load() -> pd.DataFrame:
    cache = OUT / "games_v3.pkl"
    if cache.exists() and "--rebuild" not in sys.argv:
        return pd.read_pickle(cache)
    pl, tm = E.load_all()
    base = E.load()
    g = V3.build_v3(base, pl)
    g.to_pickle(cache)
    return g


def main():
    g = load()
    reg = g[g.regular]
    rng = np.random.default_rng(0)
    res, kept = {}, {}
    for name, (trs, tes) in {**E.FOLDS, "new": (list(range(2018, 2026)), 2026)}.items():
        tr, te = reg[reg.season.isin(trs)], reg[reg.season == tes].sort_values(["date", "GAME_ID"])
        if te.empty:
            continue
        y, weeks, early = te.y.to_numpy(), te.week.to_numpy(), te.early.to_numpy()
        preds = {k: E.fit_logistic(tr, te, cols, E.C_LIN)[0] for k, cols in MODELS.items()}
        base_ll = E.logloss(y, preds["lin_v2"])
        out = {"n_test": int(len(te)), "n_early": int(early.sum()), "models": {}}
        for k, p in preds.items():
            ll = E.logloss(y, p)
            d = base_ll - ll
            m, lo, hi = boot(d, weeks, rng) if k != "lin_v2" else (0.0, 0.0, 0.0)
            de = d[early]
            me, loe, hie = boot(de, weeks[early], rng) if k != "lin_v2" and early.sum() > 20 else (0.0, 0.0, 0.0)
            out["models"][k] = {"logloss": float(ll.mean()), "dlogloss": m, "ci_lo": lo, "ci_hi": hi, "early_logloss": float(ll[early].mean()) if early.any() else None,
                                "early_dlogloss": me, "early_ci_lo": loe, "early_ci_hi": hie, "accuracy": float(((p > 0.5) == (y == 1)).mean()), "cal_slope": E.slope(p, y)}
            print(f"{name:3s} {k:18s} all {ll.mean():.4f} d {m:+.5f} [{lo:+.5f},{hi:+.5f}] | early({int(early.sum())}) {out['models'][k]['early_logloss'] or 0:.4f} d {me:+.5f} [{loe:+.5f},{hie:+.5f}]", flush=True)
        res[name] = out
        kept[name] = {"y": y, "weeks": weeks, "early": early, "ll": {k: E.logloss(y, p) for k, p in preds.items()}}

    def pooled(model: str, early_only: bool):
        d = np.concatenate([(kept[f]["ll"]["lin_v2"] - kept[f]["ll"][model])[kept[f]["early"]] if early_only else kept[f]["ll"]["lin_v2"] - kept[f]["ll"][model] for f in DEV])
        wk = np.concatenate([kept[f]["weeks"][kept[f]["early"]] if early_only else kept[f]["weeks"] for f in DEV])
        return boot(d, wk, rng)

    F = res["F"]["models"]
    rule = {}
    m, lo, hi = pooled("+returns", False)
    rule["returns"] = {"pooled_dlogloss": m, "ci_lo": lo, "ci_hi": hi, "F_not_worse": bool(F["+returns"]["logloss"] - F["lin_v2"]["logloss"] <= 0.001)}
    rule["returns"]["adopt"] = bool(lo > 0 and rule["returns"]["F_not_worse"])
    m, lo, hi = pooled("+prior", True)
    all_ok = all(res[f]["models"]["+prior"]["logloss"] - res[f]["models"]["lin_v2"]["logloss"] <= 0.001 for f in DEV)
    f_early_ok = F["+prior"]["early_logloss"] is None or F["+prior"]["early_logloss"] - F["lin_v2"]["early_logloss"] <= 0.001
    rule["prior"] = {"pooled_early_dlogloss": m, "ci_lo": lo, "ci_hi": hi, "all_games_not_worse_on_dev": bool(all_ok), "F_early_not_worse": bool(f_early_ok)}
    rule["prior"]["adopt"] = bool(lo > 0 and all_ok and f_early_ok)
    print("\nrule:", json.dumps(rule, indent=1))
    (OUT / "games_v3.json").write_text(json.dumps({"folds": res, "rule": rule}, indent=1))


if __name__ == "__main__":
    main()
