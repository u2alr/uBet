"""Evaluates the research-only context features under PREREG_CONTEXT.md. Nothing is tuned; the rules are fixed in that file.

    ingest/.venv/Scripts/python research/context_model.py            # development folds A and B, every group alone and all together
    ingest/.venv/Scripts/python research/context_model.py --final    # fold F ONCE, only for groups that already passed on A and B

Output: research/out/context_dev.json, research/out/context_final.json, research/out/CONTEXT_FINAL_DONE (a second final run is refused).
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import LogisticRegression

sys.path.insert(0, str(Path(__file__).resolve().parent))
from context_features import ALL, GROUPS  # noqa: E402
from context_features import add_context  # noqa: E402
from features import FEATURES, STATS, load_raw  # noqa: E402
from improve_model import boot  # noqa: E402
from models import HGB, Dispersion, nb_logpmf, nb_p_over  # noqa: E402

OUT = Path(__file__).resolve().parent / "out"
FOLDS = {"A": ([2022], 2023), "B": ([2022, 2023], 2024), "F": ([2022, 2023, 2024], 2025)}


def load() -> pd.DataFrame:
    cache = OUT / "context.pkl"
    if cache.exists():
        return pd.read_pickle(cache)
    _, teams = load_raw()
    df = add_context(pd.read_pickle(OUT / "features.pkl"), teams)
    df.to_pickle(cache)
    return df


def fit(train, test, stat, cols):
    return HistGradientBoostingRegressor(loss="poisson", **HGB).fit(train[cols], train[stat]).predict(test[cols])


def slope(p, over):
    z = np.log(p / (1 - p)).reshape(-1, 1)
    m = LogisticRegression(C=1e6, max_iter=200).fit(z, over)
    return float(m.coef_[0][0]), float(m.intercept_[0])


def run_fold(df: pd.DataFrame, name: str, variants: dict[str, list[str]], rng) -> dict:
    tr_seasons, te_season = FOLDS[name]
    base = (df.n_prior >= 5) & df["pts_l10"].notna()
    tr = df[base & df.season.isin(tr_seasons)].sort_values("date")
    te = df[base & (df.season == te_season) & (df.min_l10 >= 20)].sort_values("date")
    cut = int(len(tr) * 0.8)
    fit_part, alpha_part = tr.iloc[:cut], tr.iloc[cut:]
    weeks = te.date.dt.to_period("W").astype(str).to_numpy()
    out = {"n_test": len(te), "coverage": {c: float(te[c].notna().mean()) for c in ALL}, "stats": {}}
    for stat in STATS:
        disp = Dispersion().fit(fit(fit_part, alpha_part, stat, FEATURES), alpha_part[stat].to_numpy(float))
        y = te[stat].to_numpy(float)
        line = np.floor(te[f"{stat}_l10"].to_numpy(float)) + 0.5
        over = (y > line).astype(float)
        mu0 = fit(tr, te, stat, FEATURES)
        ls0 = nb_logpmf(y, mu0, disp.alpha(mu0))
        res = {}
        for vname, extra in variants.items():
            mu = mu0 if not extra else fit(tr, te, stat, FEATURES + extra)
            ls = nb_logpmf(y, mu, disp.alpha(mu))
            p = np.clip(nb_p_over(line, mu, disp.alpha(mu)), 1e-4, 1 - 1e-4)
            sl, ic = slope(p, over)
            r = {"mae": float(np.mean(np.abs(y - mu))), "mean_bias": float(np.mean(y - mu)), "cal_slope": sl, "cal_intercept": ic,
                 "brier_pseudo": float(np.mean((p - over) ** 2))}
            if vname != "baseline":
                d, lo, hi = boot(ls - ls0, weeks, rng)
                r.update({"dlogscore": d, "ci_lo": lo, "ci_hi": hi})
            res[vname] = r
        out["stats"][stat] = res
        print(f"{name} {stat:5s} " + "  ".join(f"{k}: {v['dlogscore']:+.4f} [{v['ci_lo']:+.4f},{v['ci_hi']:+.4f}]" for k, v in res.items() if 'dlogscore' in v), flush=True)
    return out


def passes(folds: dict, group: str, fold_names: list[str]) -> bool:
    """The pre-registered rule: on every named fold, at least 3 of 4 stats have an interval entirely above 0 and none entirely below."""
    for f in fold_names:
        s = folds[f]["stats"]
        above = sum(1 for st in STATS if s[st][group]["ci_lo"] > 0)
        below = sum(1 for st in STATS if s[st][group]["ci_hi"] < 0)
        if above < 3 or below > 0:
            return False
    return True


def main():
    final = "--final" in sys.argv
    df = load()
    rng = np.random.default_rng(0)
    if not final:
        variants = {"baseline": [], **{g: cols for g, cols in GROUPS.items()}, "ALL": ALL}
        res = {f: run_fold(df, f, variants, rng) for f in ("A", "B")}
        verdict = {g: passes(res, g, ["A", "B"]) for g in list(GROUPS) + ["ALL"]}
        res["verdict_dev"] = verdict
        (OUT / "context_dev.json").write_text(json.dumps(res, indent=1))
        print("development verdict (kept for the one confirmation on fold F):", verdict)
        return
    lock = OUT / "CONTEXT_FINAL_DONE"
    if lock.exists():
        sys.exit("Fold F was already used for the context features. Delete the lock only to record a NEW pre-registered experiment.")
    dev = json.loads((OUT / "context_dev.json").read_text())
    keep = [g for g, ok in dev["verdict_dev"].items() if ok and g != "ALL"]
    if not keep:
        sys.exit("No group passed on A and B, so there is nothing to confirm and fold F is NOT used.")
    res = run_fold(df, "F", {"baseline": [], **{g: GROUPS[g] for g in keep}}, rng)
    out = {"groups_confirmed_on_F": [g for g in keep if all(res["stats"][st][g]["ci_hi"] >= 0 for st in STATS)], "F": res}
    (OUT / "context_final.json").write_text(json.dumps(out, indent=1))
    lock.write_text("done")
    print("final:", out["groups_confirmed_on_F"])


if __name__ == "__main__":
    main()
