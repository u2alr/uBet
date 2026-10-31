"""Ablation of the defensive matchup features under PREREG_DEFENSE.md. Nothing is tuned; the rules are fixed there.

    ingest/.venv/Scripts/python research/defense_eval.py            # development folds A and B
    ingest/.venv/Scripts/python research/defense_eval.py --final    # fold F ONCE, only for groups that passed on A and B

Needs research/data/matchups.sqlite (python research/pull_matchups.py). Outputs research/out/def_dev.json, def_final.json and the lock research/out/DEF_FINAL_DONE (a second final run is refused);
the report research/RESULTS_DEFENSE.md is generated from those files by `python research/defense_report.py`.
"""
import json
import sqlite3
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

sys.path.insert(0, str(Path(__file__).resolve().parent))
import defense_features as D  # noqa: E402
from features import FEATURES, load_raw  # noqa: E402
from human_factors_eval import passes, run_fold  # noqa: E402

OUT = Path(__file__).resolve().parent / "out"
DATA = Path(__file__).resolve().parent / "data"


def load() -> pd.DataFrame:
    cache = OUT / "def.pkl"
    if cache.exists():
        return pd.read_pickle(cache)
    pl, tm = load_raw()
    m = D.load_matchups(sqlite3.connect(DATA / "matchups.sqlite"), tm)
    df = D.add_defense(pd.read_pickle(OUT / "features.pkl"), pl, tm, m)
    df["pra"] = df.pts + df.reb + df.ast
    df["pra_l10"] = df.pts_l10 + df.reb_l10 + df.ast_l10
    df.to_pickle(cache)
    return df


def buckets(te: pd.DataFrame) -> dict[str, np.ndarray]:
    """Descriptive slices of the test rows (never used to decide anything)."""
    def cut(series, edges, labels):
        out = np.array(["unknown"] * len(series), dtype=object)
        v = series.to_numpy(float)
        for lo, hi, lab in zip(edges[:-1], edges[1:], labels):
            out[(v >= lo) & (v < hi)] = lab
        return out
    return {
        "role (last-10 minutes)": cut(te.min_l10, [20, 28, 34, 100], ["20-28", "28-34", "34+"]),
        "matchup confidence (mu_conf)": cut(te.df_mu_conf, [0, 0.3, 0.6, 1.01], ["low (<0.3)", "medium (0.3-0.6)", "high (>=0.6)"]),
        "defender sample (pd_expo)": cut(te.df_pd_expo, [0, 0.5, 0.8, 1.01], ["thin (<0.5)", "moderate (0.5-0.8)", "ample (>=0.8)"]),
        "direct history with this defence (mu_direct)": cut(te.df_mu_direct, [0, 0.1, 0.4, 1.01], ["almost none (<0.1)", "some (0.1-0.4)", "much (>=0.4)"]),
    }


def overlap(df: pd.DataFrame) -> dict:
    """Largest absolute Spearman correlation between each defensive feature and any existing feature (a sample, for speed)."""
    s = df[(df.n_prior >= 5) & df.season.isin([2023, 2024])].sample(20000, random_state=0)
    res = {}
    for c in D.ALL:
        best = (0.0, None)
        for f in FEATURES:
            ok = s[c].notna() & s[f].notna()
            if ok.sum() > 1000 and s.loc[ok, c].nunique() > 1 and s.loc[ok, f].nunique() > 1:
                rho = abs(float(spearmanr(s.loc[ok, c], s.loc[ok, f])[0]))
                if rho > best[0]:
                    best = (rho, f)
        res[c] = {"max_abs_spearman_with_existing": best[0], "existing_feature": best[1]}
    return res


def fold(df, name, variants, rng, detail=True):
    return run_fold(df, name, variants, rng, detail, bucket_fn=buckets, assoc_cols=D.ALL, coverage_cols=D.ALL)


def main():
    final = "--final" in sys.argv
    df = load()
    rng = np.random.default_rng(0)
    if not final:
        variants = {**D.GROUPS, "ALL (information only, never adopted)": D.ALL}
        res = {f: fold(df, f, variants, rng) for f in ("A", "B")}
        verdict = {g: passes(res, g, ["A", "B"]) for g in D.GROUPS}
        res["verdict_dev"] = verdict
        res["overlap_with_existing_features"] = overlap(df)
        (OUT / "def_dev.json").write_text(json.dumps(res, indent=1))
        print("development verdict:", verdict)
        return
    lock = OUT / "DEF_FINAL_DONE"
    if lock.exists():
        sys.exit("Fold F was already used for the defensive features. Delete the lock only to record a NEW pre-registered experiment.")
    dev = json.loads((OUT / "def_dev.json").read_text())
    keep = [g for g, ok in dev["verdict_dev"].items() if ok]
    if not keep:
        sys.exit("No group passed on A and B, so there is nothing to confirm and fold F is NOT used.")
    res = fold(df, "F", {g: D.GROUPS[g] for g in keep}, rng)
    out = {"groups_confirmed_on_F": [g for g in keep if all(res["stats"][st][g]["ci_hi"] >= 0 for st in ("pts", "reb", "ast", "fg3m"))], "F": res}
    (OUT / "def_final.json").write_text(json.dumps(out, indent=1))
    lock.write_text("done")
    print("final:", out["groups_confirmed_on_F"])


if __name__ == "__main__":
    main()
