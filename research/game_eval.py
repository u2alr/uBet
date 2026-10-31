"""Walk-forward ablation of the game-winner features under PREREG_GAMES.md. Nothing is tuned; the rules are fixed there.

    ingest/.venv/Scripts/python research/game_eval.py            # development folds A and B
    ingest/.venv/Scripts/python research/game_eval.py --final    # fold F ONCE, only for groups that passed on A and B

Outputs research/out/games.pkl (features), games_dev.json, games_final.json and the lock research/out/GAMES_FINAL_DONE. The report RESULTS_GAMES.md and shared/games.status.json are
generated from those files by `python research/game_report.py`.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parent))
import game_features as G  # noqa: E402
from features import load_raw  # noqa: E402
from improve_model import boot  # noqa: E402

OUT = Path(__file__).resolve().parent / "out"
FOLDS = {"A": ([2022], 2023), "B": ([2022, 2023], 2024), "F": ([2022, 2023, 2024], 2025)}
C = 1.0
EPS = 1e-6


def load() -> pd.DataFrame:
    cache = OUT / "games.pkl"
    if cache.exists():
        return pd.read_pickle(cache)
    _, tm = load_raw()
    miss = pd.read_pickle(OUT / "features.pkl")[["GAME_ID", "TEAM_ID", "miss_prev"]].drop_duplicates(["GAME_ID", "TEAM_ID"])
    g = G.build_games(tm, miss)
    g.to_pickle(cache)
    return g


def fit_predict(train: pd.DataFrame, test: pd.DataFrame, cols: list[str]):
    """Median-impute with TRAIN medians, standardise with TRAIN statistics, L2 logistic regression."""
    med = train[cols].median()
    xt, xs = train[cols].fillna(med), test[cols].fillna(med)
    sc = StandardScaler().fit(xt)
    m = LogisticRegression(C=C, max_iter=500).fit(sc.transform(xt), train.y)
    return np.clip(m.predict_proba(sc.transform(xs))[:, 1], EPS, 1 - EPS), (m, sc, med)


def logloss(y, p):
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def slope(p, y):
    z = np.log(p / (1 - p)).reshape(-1, 1)
    m = LogisticRegression(C=1e6, max_iter=300).fit(z, y)
    return float(m.coef_[0][0]), float(m.intercept_[0])


def metrics(y, p):
    s, i = slope(p, y)
    return {"logloss": float(logloss(y, p).mean()), "brier": float(((p - y) ** 2).mean()), "cal_slope": s, "cal_intercept": i, "accuracy": float(((p > 0.5) == (y == 1)).mean())}


def run_fold(g: pd.DataFrame, name: str, variants: dict[str, list[str]], rng, detail=True) -> dict:
    tr_seasons, te_season = FOLDS[name]
    reg = g[g.regular]
    tr, te = reg[reg.season.isin(tr_seasons)], reg[reg.season == te_season]
    y = te.y.to_numpy()
    weeks = te.week.to_numpy()
    p0, _ = fit_predict(tr, te, G.BASE)
    base_ll = logloss(y, p0)
    out = {"season": f"{te_season}-{str(te_season + 1)[2:]}", "n_test": len(te), "baseline": metrics(y, p0), "variants": {}}
    for vname, extra in variants.items():
        p, _ = fit_predict(tr, te, G.BASE + extra)
        d = base_ll - logloss(y, p)
        mean, lo, hi = boot(d, weeks, rng)
        r = {"dlogloss": mean, "ci_lo": lo, "ci_hi": hi, **metrics(y, p)}
        if detail:
            differ = (p > 0.5) != (p0 > 0.5)
            r["picks_differ_from_baseline"] = int(differ.sum())
            r["model_right_when_differ"] = float(((p > 0.5) == (y == 1))[differ].mean()) if differ.any() else None
            bands = pd.cut(p, [0, 0.35, 0.5, 0.65, 1.0], labels=["<35%", "35-50%", "50-65%", ">65%"])
            r["by_band"] = {str(b): {"n": int((bands == b).sum()), "predicted": float(p[bands == b].mean()), "actual": float(y[bands == b].mean())} for b in bands.categories if (bands == b).any()}
            rd = pd.cut(te.rest_diff.to_numpy(float), [-99, -1.5, -0.5, 0.5, 1.5, 99], labels=["<= -2", "-1", "0", "+1", ">= +2"])
            r["by_rest_diff"] = {str(b): {"n": int((rd == b).sum()), "mean_dlogloss": float(d[np.asarray(rd == b)].mean())} for b in rd.categories if (rd == b).sum() >= 100}
        out["variants"][vname] = r
        print(f"{name} {vname:34s} dlogloss {mean:+.5f} [{lo:+.5f},{hi:+.5f}]  logloss {r['logloss']:.4f}  slope {r['cal_slope']:.3f}", flush=True)
    return out


def passes(folds: dict, group: str, names: list[str]) -> bool:
    return all(folds[f]["variants"][group]["ci_lo"] > 0 for f in names)


def main():
    final = "--final" in sys.argv
    g = load()
    rng = np.random.default_rng(0)
    if not final:
        variants = {**G.GROUPS, "ALL (information only)": G.ALL}
        res = {f: run_fold(g, f, variants, rng) for f in ("A", "B")}
        res["verdict_dev"] = {k: passes(res, k, ["A", "B"]) for k in G.GROUPS}
        (OUT / "games_dev.json").write_text(json.dumps(res, indent=1))
        print("development verdict:", res["verdict_dev"])
        return
    lock = OUT / "GAMES_FINAL_DONE"
    if lock.exists():
        sys.exit("Fold F was already used for the game-winner features. Delete the lock only to record a NEW pre-registered experiment.")
    dev = json.loads((OUT / "games_dev.json").read_text())
    keep = [k for k, ok in dev["verdict_dev"].items() if ok]
    if not keep:
        sys.exit("No group passed on A and B, so there is nothing to confirm and fold F is NOT used.")
    res = run_fold(g, "F", {k: G.GROUPS[k] for k in keep}, rng)
    out = {"groups_confirmed_on_F": [k for k in keep if res["variants"][k]["ci_hi"] >= 0], "F": res}
    (OUT / "games_final.json").write_text(json.dumps(out, indent=1))
    lock.write_text("done")
    print("final:", out["groups_confirmed_on_F"])


if __name__ == "__main__":
    main()
