"""Walk-forward evaluation of the game-winner model v2 under PREREG_GAMES_V2.md. Nothing is tuned on a test season; the models and the decision rule are fixed there.

    ingest/.venv/Scripts/python research/game_eval_v2.py            # folds A, B, F and the 2026-27 season so far
    ingest/.venv/Scripts/python research/game_eval_v2.py --rebuild  # rebuild the feature cache first

Writes research/out/games_v2.json. `research/game_report_v2.py` turns it into RESULTS_GAMES_V2.md and shared/games.status.json.
"""
import json
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parent))
import game_features as G  # noqa: E402
import game_features_v2 as V  # noqa: E402
from features import load_raw  # noqa: E402
from improve_model import boot  # noqa: E402

warnings.filterwarnings("ignore")
OUT = Path(__file__).resolve().parent / "out"
# Extended history (PREREG_GAMES_V2.md addendum): seasons 2018-19 to 2021-22 train and warm up the ratings; the test seasons are unchanged apart from the added E0.
FOLDS = {"E0": (list(range(2018, 2022)), 2022), "A": (list(range(2018, 2023)), 2023), "B": (list(range(2018, 2024)), 2024), "F": (list(range(2018, 2025)), 2025)}
DEV = ["E0", "A", "B"]
HISTORY = Path(__file__).resolve().parent / "data" / "history"
C_LIN, EPS = 0.5, 1e-6
V1 = G.BASE + G.GROUPS["AVAIL3"]
GBM_PARAMS = dict(max_depth=3, learning_rate=0.03, max_iter=250, min_samples_leaf=60, l2_regularization=5.0, random_state=0)


def load_all() -> tuple[pd.DataFrame, pd.DataFrame]:
    """Players and teams for 2018-19 onward: the history folder plus everything `features.load_raw` reads."""
    pl, tm = load_raw()
    hp = [pd.read_csv(f).assign(gtype="regular") for f in sorted(HISTORY.glob("player_*.csv"))]
    ht = [pd.read_csv(f).assign(gtype="regular") for f in sorted(HISTORY.glob("team_*.csv"))]
    return pd.concat([*hp, pl], ignore_index=True), pd.concat([*ht, tm], ignore_index=True)


def load() -> pd.DataFrame:
    cache = OUT / "games_v2h.pkl"
    if cache.exists() and "--rebuild" not in sys.argv:
        return pd.read_pickle(cache)
    pl, tm = load_all()
    miss = pd.DataFrame({"GAME_ID": [], "TEAM_ID": [], "miss_prev": []})      # only the weak AVAIL group reads it, and no model here does
    g = V.build_v2(G.build_games(tm, miss, pl), tm, pl)
    g.to_pickle(cache)
    return g


def _prep(train: pd.DataFrame, test: pd.DataFrame, cols: list[str]):
    med = train[cols].median()
    return train[cols].fillna(med), test[cols].fillna(med), med


def fit_logistic(train: pd.DataFrame, test: pd.DataFrame, cols: list[str], C: float = 1.0):
    xt, xs, med = _prep(train, test, cols)
    sc = StandardScaler().fit(xt)
    m = LogisticRegression(C=C, max_iter=1000).fit(sc.transform(xt), train.y)
    return np.clip(m.predict_proba(sc.transform(xs))[:, 1], EPS, 1 - EPS), (m, sc, med)


def fit_gbm(train: pd.DataFrame, test: pd.DataFrame, cols: list[str]):
    xt, xs, med = _prep(train, test, cols)
    m = HistGradientBoostingClassifier(**GBM_PARAMS).fit(xt, train.y)
    return np.clip(m.predict_proba(xs)[:, 1], EPS, 1 - EPS), (m, med)


def predict_all(train: pd.DataFrame, test: pd.DataFrame) -> dict[str, np.ndarray]:
    p = {"elo": fit_logistic(train, test, G.BASE)[0], "v1": fit_logistic(train, test, V1)[0],
         "lin_v2": fit_logistic(train, test, V.LIN_V2, C_LIN)[0], "gbm_v2": fit_gbm(train, test, V.GBM_V2)[0]}
    p["blend"] = (p["lin_v2"] + p["gbm_v2"]) / 2
    # Information only: one new group at a time on top of v1.
    p["v1+srs"] = fit_logistic(train, test, V1 + ["srs30", "srs60", "srs120"], C_LIN)[0]
    p["v1+talent"] = fit_logistic(train, test, V1 + ["ab_gs"], C_LIN)[0]
    p["v1+commonopp"] = fit_logistic(train, test, V1 + ["co_diff"], C_LIN)[0]
    p["v1+schedule"] = fit_logistic(train, test, V1 + V.SCHEDULE, C_LIN)[0]
    return p


def logloss(y, p):
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def slope(p, y):
    z = np.log(p / (1 - p)).reshape(-1, 1)
    m = LogisticRegression(C=1e6, max_iter=300).fit(z, y)
    return float(m.coef_[0][0])


def metrics(y, p):
    return {"logloss": float(logloss(y, p).mean()), "brier": float(((p - y) ** 2).mean()), "accuracy": float(((p > 0.5) == (y == 1)).mean()), "cal_slope": slope(p, y)}


def run(g: pd.DataFrame, tr: pd.DataFrame, te: pd.DataFrame, label: str, rng, names: list[str] | None = None) -> dict:
    y, weeks = te.y.to_numpy(), te.week.to_numpy()
    preds = predict_all(tr, te)
    base = logloss(y, preds["v1"])
    out = {"label": label, "n_test": int(len(te)), "models": {}}
    for k, p in preds.items():
        d = base - logloss(y, p)
        mean, lo, hi = boot(d, weeks, rng) if k != "v1" else (0.0, 0.0, 0.0)
        out["models"][k] = {**metrics(y, p), "dlogloss_vs_v1": mean, "ci_lo": lo, "ci_hi": hi}
        print(f"{label:6s} {k:14s} logloss {out['models'][k]['logloss']:.4f}  vs v1 {mean:+.5f} [{lo:+.5f},{hi:+.5f}]  acc {out['models'][k]['accuracy']:.3f}  slope {out['models'][k]['cal_slope']:.2f}", flush=True)
    return {"out": out, "preds": preds, "y": y, "weeks": weeks}


def main():
    g = load()
    reg = g[g.regular]
    rng = np.random.default_rng(0)
    res, kept = {}, {}
    print(f"{len(reg):,} regular-season games, seasons {sorted(reg.season.unique())}", flush=True)
    for name, (tr_seasons, te_season) in FOLDS.items():
        tr, te = reg[reg.season.isin(tr_seasons)], reg[reg.season == te_season]
        r = run(g, tr, te, name, rng)
        res[name], kept[name] = r["out"], r
    # Pooled development folds: the selection and the decision rule use these only.
    cand = ["lin_v2", "gbm_v2", "blend"]
    mean_ab = {k: float(np.mean([res[f]["models"][k]["logloss"] for f in DEV])) for k in cand}
    best = min(mean_ab, key=mean_ab.get)
    d = np.concatenate([logloss(kept[f]["y"], kept[f]["preds"]["v1"]) - logloss(kept[f]["y"], kept[f]["preds"][best]) for f in DEV])
    wk = np.concatenate([kept[f]["weeks"] for f in DEV])
    pm, plo, phi = boot(d, wk, rng)
    F = res["F"]["models"]
    rule = {"candidate": best, "mean_logloss_AB": mean_ab, "pooled_dlogloss_vs_v1": pm, "ci_lo": plo, "ci_hi": phi,
            "a_ci_above_zero": bool(plo > 0), "b_F_not_worse_by_0.001": bool(F[best]["logloss"] - F["v1"]["logloss"] <= 0.001), "c_F_slope_ok": bool(0.9 <= F[best]["cal_slope"] <= 1.1)}
    rule["adopt_v2"] = bool(rule["a_ci_above_zero"] and rule["b_F_not_worse_by_0.001"] and rule["c_F_slope_ok"])
    print("\nselection rule:", json.dumps(rule, indent=1))
    # The new season so far: train on 2022-2025, score once. Descriptive only (a small, genuinely new sample).
    new = reg[reg.season == 2026]
    if len(new):
        r = run(g, reg[reg.season.isin(range(2018, 2026))], new, "2026-27", rng)
        res["new"] = r["out"]
    (OUT / "games_v2h.json").write_text(json.dumps({"folds": res, "rule": rule}, indent=1))


if __name__ == "__main__":
    main()
