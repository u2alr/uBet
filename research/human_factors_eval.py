"""Ablation of the Human Factors features under PREREG_HUMAN_FACTORS.md. Nothing is tuned; the rules are fixed there.

    ingest/.venv/Scripts/python research/human_factors_eval.py            # development folds A and B
    ingest/.venv/Scripts/python research/human_factors_eval.py --final    # fold F ONCE, only for groups that passed on A and B

Outputs: research/out/hf_dev.json, research/out/hf_final.json, research/out/HF_FINAL_DONE (a second final run is refused), and the report research/RESULTS_HUMAN_FACTORS.md
is generated from those files by `python research/human_factors_report.py`.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import LogisticRegression

sys.path.insert(0, str(Path(__file__).resolve().parent))
from features import FEATURES, load_raw  # noqa: E402
from human_factors import ALL, GROUPS, add_human_factors  # noqa: E402
from improve_model import boot  # noqa: E402
from models import HGB, Dispersion, nb_logpmf, nb_p_over  # noqa: E402

OUT = Path(__file__).resolve().parent / "out"
FOLDS = {"A": ([2022], 2023), "B": ([2022, 2023], 2024), "F": ([2022, 2023, 2024], 2025)}
RULE_STATS = ["pts", "reb", "ast", "fg3m"]       # the pre-registered rule is judged on these four
ALL_STATS = RULE_STATS + ["pra"]                 # PRA is reported too
MIN_BUCKET = 300


def load() -> pd.DataFrame:
    cache = OUT / "hf.pkl"
    if cache.exists():
        return pd.read_pickle(cache)
    _, teams = load_raw()
    df = add_human_factors(pd.read_pickle(OUT / "features.pkl"), teams)
    df["pra"] = df.pts + df.reb + df.ast
    df["pra_l10"] = df.pts_l10 + df.reb_l10 + df.ast_l10
    df.to_pickle(cache)
    return df


def fit(train, test, stat, cols):
    return HistGradientBoostingRegressor(loss="poisson", **HGB).fit(train[cols], train[stat]).predict(test[cols])


def slope(p, over):
    z = np.log(p / (1 - p)).reshape(-1, 1)
    m = LogisticRegression(C=1e6, max_iter=200).fit(z, over)
    return float(m.coef_[0][0]), float(m.intercept_[0])


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
        "rest difference (own minus opponent, days)": cut(te.hf_rest_diff, [-99, -1.5, -0.5, 0.5, 1.5, 99], ["<= -2", "-1", "0", "+1", ">= +2"]),
        "estimated travel (miles since previous game)": np.where(te.hf_miles.isna(), "unknown", np.where(te.hf_miles < 25, "none or same city", np.where(te.hf_miles < 500, "under 500", np.where(te.hf_miles < 1500, "500-1500", "over 1500")))),
        "back-to-back": np.where(te.hf_b2b.isna(), "unknown", np.where(te.hf_b2b == 1, "back-to-back", "normal rest")),
    }


def run_fold(df: pd.DataFrame, name: str, variants: dict[str, list[str]], rng, detail: bool = True) -> dict:
    tr_seasons, te_season = FOLDS[name]
    base = (df.n_prior >= 5) & df["pts_l10"].notna()
    tr = df[base & df.season.isin(tr_seasons)].sort_values("date")
    te = df[base & (df.season == te_season) & (df.min_l10 >= 20)].sort_values("date")
    cut = int(len(tr) * 0.8)
    fit_part, alpha_part = tr.iloc[:cut], tr.iloc[cut:]
    weeks = te.date.dt.to_period("W").astype(str).to_numpy()
    bk = buckets(te)
    out = {"n_test": len(te), "season": f"{te_season}-{str(te_season + 1)[2:]}", "coverage": {c: float(te[c].notna().mean()) for c in ALL}, "stats": {}}
    for stat in ALL_STATS:
        disp = Dispersion().fit(fit(fit_part, alpha_part, stat, FEATURES), alpha_part[stat].to_numpy(float))
        y = te[stat].to_numpy(float)
        line = np.floor(te[f"{stat}_l10"].to_numpy(float)) + 0.5
        over = (y > line).astype(float)
        mu0 = fit(tr, te, stat, FEATURES)
        ls0 = nb_logpmf(y, mu0, disp.alpha(mu0))
        z0 = (y - mu0) / np.sqrt(mu0 + disp.alpha(mu0) * mu0 ** 2)
        p0 = np.clip(nb_p_over(line, mu0, disp.alpha(mu0)), 1e-4, 1 - 1e-4)
        res = {"baseline": {"mae": float(np.mean(np.abs(y - mu0))), "brier_pseudo": float(np.mean((p0 - over) ** 2)),
                            "logloss_pseudo": float(-np.mean(over * np.log(p0) + (1 - over) * np.log(1 - p0))), "cal_slope": slope(p0, over)[0], "cal_intercept": slope(p0, over)[1]}}
        for vname, extra in variants.items():
            mu = fit(tr, te, stat, FEATURES + extra)
            ls = nb_logpmf(y, mu, disp.alpha(mu))
            p = np.clip(nb_p_over(line, mu, disp.alpha(mu)), 1e-4, 1 - 1e-4)
            d = ls - ls0
            dm, lo, hi = boot(d, weeks, rng)
            sl, ic = slope(p, over)
            r = {"dlogscore": dm, "ci_lo": lo, "ci_hi": hi, "mae": float(np.mean(np.abs(y - mu))), "brier_pseudo": float(np.mean((p - over) ** 2)),
                 "logloss_pseudo": float(-np.mean(over * np.log(p) + (1 - over) * np.log(1 - p))), "cal_slope": sl, "cal_intercept": ic}
            if detail:
                r["buckets"] = {}
                for bname, labels in bk.items():
                    r["buckets"][bname] = {}
                    for lab in sorted(set(labels)):
                        m = labels == lab
                        if m.sum() < MIN_BUCKET:
                            r["buckets"][bname][lab] = {"n": int(m.sum()), "note": f"fewer than {MIN_BUCKET} rows: not interpreted"}
                            continue
                        bm, blo, bhi = boot(d[m], weeks[m], rng)
                        r["buckets"][bname][lab] = {"n": int(m.sum()), "dlogscore": bm, "ci_lo": blo, "ci_hi": bhi}
            res[vname] = r
        if detail:   # does any new feature explain what the baseline misses? Spearman against the baseline's standardised residual
            part = {}
            for c in ALL:
                ok = te[c].notna().to_numpy()
                part[c] = {"rho_with_baseline_residual": float(spearmanr(te.loc[ok, c], z0[ok])[0]) if ok.sum() > 500 and te.loc[ok, c].nunique() > 1 else None, "n": int(ok.sum())}
            res["partial_association"] = part
        out["stats"][stat] = res
        print(f"{name} {stat:5s} " + "  ".join(f"{k}: {v['dlogscore']:+.4f} [{v['ci_lo']:+.4f},{v['ci_hi']:+.4f}]" for k, v in res.items() if isinstance(v, dict) and 'dlogscore' in v), flush=True)
    return out


def overlap(df: pd.DataFrame) -> dict:
    """Largest absolute Spearman correlation between each human-factor feature and any existing feature (a sample, for speed)."""
    s = df[(df.n_prior >= 5) & df.season.isin([2023, 2024])].sample(20000, random_state=0)
    res = {}
    for c in ALL:
        best = (0.0, None)
        for f in FEATURES:
            ok = s[c].notna() & s[f].notna()
            if ok.sum() > 1000 and s.loc[ok, c].nunique() > 1 and s.loc[ok, f].nunique() > 1:
                rho = abs(float(spearmanr(s.loc[ok, c], s.loc[ok, f])[0]))
                if rho > best[0]:
                    best = (rho, f)
        res[c] = {"max_abs_spearman_with_existing": best[0], "existing_feature": best[1]}
    return res


def passes(folds: dict, group: str, names: list[str]) -> bool:
    for f in names:
        s = folds[f]["stats"]
        above = sum(1 for st in RULE_STATS if s[st][group]["ci_lo"] > 0)
        below = sum(1 for st in RULE_STATS if s[st][group]["ci_hi"] < 0)
        if above < 3 or below > 0:
            return False
    return True


def main():
    final = "--final" in sys.argv
    df = load()
    rng = np.random.default_rng(0)
    if not final:
        variants = {**{g: cols for g, cols in GROUPS.items()}, "ALL (information only, never adopted)": ALL}
        res = {f: run_fold(df, f, variants, rng) for f in ("A", "B")}
        verdict = {g: passes(res, g, ["A", "B"]) for g in GROUPS}
        res["verdict_dev"] = verdict
        res["overlap_with_existing_features"] = overlap(df)
        keep = [g for g, ok in verdict.items() if ok]
        if keep:     # variant E: baseline plus every group that passed
            union = [c for g in keep for c in GROUPS[g]]
            res["E_groups"] = keep
            res["E"] = {f: run_fold(df, f, {"E": union}, rng, detail=False) for f in ("A", "B")}
        (OUT / "hf_dev.json").write_text(json.dumps(res, indent=1))
        print("development verdict:", verdict)
        return
    lock = OUT / "HF_FINAL_DONE"
    if lock.exists():
        sys.exit("Fold F was already used for the human factors. Delete the lock only to record a NEW pre-registered experiment.")
    dev = json.loads((OUT / "hf_dev.json").read_text())
    keep = [g for g, ok in dev["verdict_dev"].items() if ok]
    if not keep:
        sys.exit("No group passed on A and B, so there is nothing to confirm and fold F is NOT used.")
    res = run_fold(df, "F", {g: GROUPS[g] for g in keep}, rng)
    out = {"groups_confirmed_on_F": [g for g in keep if all(res["stats"][st][g]["ci_hi"] >= 0 for st in RULE_STATS)], "F": res}
    (OUT / "hf_final.json").write_text(json.dumps(out, indent=1))
    lock.write_text("done")
    print("final:", out["groups_confirmed_on_F"])


if __name__ == "__main__":
    main()
