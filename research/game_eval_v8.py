"""Walk-forward evaluation of v8 under PREREG_GAMES_V8.md: what the league's own pre-game injury reports add. The rules are fixed there; nothing is tuned.

    ingest/.venv/Scripts/python research/game_eval_v8.py            # folds E0, A, B, F and the 2026-27 season so far
    ingest/.venv/Scripts/python research/game_eval_v8.py --rebuild  # rebuild the feature cache first

Needs research/data/injuries/injury_reports.csv (research/backfill_injuries.py). Writes research/out/games_v8.json.
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
import game_features as G  # noqa: E402
import game_features_v2 as V  # noqa: E402
import game_features_v8 as V8  # noqa: E402

warnings.filterwarnings("ignore")
OUT = Path(__file__).resolve().parent / "out"
DEV = ["E0", "A", "B"]
FIRST_SEASON = 2020                      # the reports exist from December 2020: every model, the reference included, trains only from the 2020-21 season on
ALPHA = 0.05 / len(V8.GROUPS)            # two candidates: 97.5% interval
ACTUAL_ABSENCE = list(G.GROUPS["AVAIL3"]) + ["ab_gs"]
R = V.LIN_V2                                                   # reference (unattainable before tip): who actually played
B0 = [c for c in V.LIN_V2 if c not in ACTUAL_ABSENCE] + ["rep_out", "has_rep"]      # what the live system can know: listed Out only
MODELS = {"R": R, "B0": B0, **{k: B0 + cols for k, cols in V8.GROUPS.items()}}


def load():
    cache = OUT / "games_v8.pkl"
    if cache.exists() and "--rebuild" not in sys.argv:
        return pd.read_pickle(cache), pd.read_pickle(OUT / "games_v8_listed.pkl")
    pl, tm = E.load_all()
    g, lp = V8.build_v8(E.load(), tm, pl, return_listed=True)
    g.to_pickle(cache)
    lp.to_pickle(OUT / "games_v8_listed.pkl")
    return g, lp


def play_rates(lp: pd.DataFrame, pl: pd.DataFrame) -> dict:
    """Information only: of the players listed with each status in the report used, the share who then played (had minutes) that day, by season. Cannot adopt anything."""
    played = set(zip(pl[pl["MIN"] > 0].PLAYER_ID.astype(int), pd.to_datetime(pl[pl["MIN"] > 0].GAME_DATE).dt.strftime("%Y-%m-%d")))
    m = lp.dropna(subset=["PLAYER_ID"]).copy()
    m["played"] = [(int(p), d) in played for p, d in zip(m.PLAYER_ID, m.date)]
    m["season"] = pd.to_datetime(m.date).map(lambda d: d.year if d.month >= 9 else d.year - 1)
    return {f"{status}|{season}": {"n": int(len(x)), "played": float(x.played.mean())} for (status, season), x in m.groupby(["status", "season"]) if len(x) >= 20}


def main():
    g, lp = load()
    pl, _ = E.load_all()
    reg = g[g.regular & (g.season >= FIRST_SEASON)]
    cover = reg.groupby("season").has_rep.mean().round(3).to_dict()
    print("share of games with a usable report, by season:", cover, flush=True)
    rng = np.random.default_rng(0)
    res, kept = {}, {}
    for name, (trs, tes) in {**E.FOLDS, "new": (list(range(2018, 2026)), 2026)}.items():
        trs = [y for y in trs if y >= FIRST_SEASON]
        tr, te = reg[reg.season.isin(trs)], reg[reg.season == tes]
        if te.empty or tr.empty:
            continue
        y, weeks = te.y.to_numpy(), te.week.to_numpy()
        preds = {k: E.fit_logistic(tr, te, cols, E.C_LIN)[0] for k, cols in MODELS.items()}
        ll = {k: E.logloss(y, p) for k, p in preds.items()}
        out = {"n_test": int(len(te)), "has_report": float(te.has_rep.mean()), "models": {}}
        for k, v in ll.items():
            d = ll["B0"] - v
            m, lo, hi = E4.boot(d, weeks, rng) if k != "B0" else (0.0, 0.0, 0.0)
            out["models"][k] = {"logloss": float(v.mean()), "dlogloss_vs_B0": m, "ci95_lo": lo, "ci95_hi": hi}
            print(f"{name:3s} {k:3s} logloss {v.mean():.4f}  vs B0 {m:+.5f} [{lo:+.5f},{hi:+.5f}]", flush=True)
        res[name], kept[name] = out, {"weeks": weeks, "ll": ll}
    rule = {}
    F = res["F"]["models"]
    for k in V8.GROUPS:
        d = np.concatenate([kept[f]["ll"]["B0"] - kept[f]["ll"][k] for f in DEV])
        wk = np.concatenate([kept[f]["weeks"] for f in DEV])
        m, lo, hi = E4.boot(d, wk, rng, ALPHA)
        signs = [float(np.sign((kept[f]["ll"]["B0"] - kept[f]["ll"][k]).mean())) for f in DEV]
        r = {"pooled_dlogloss": m, "ci_lo_975": lo, "ci_hi_975": hi, "F_not_worse": bool(F[k]["logloss"] - F["B0"]["logloss"] <= 0.001),
             "positive_seasons": int(sum(1 for s in signs if s > 0)), "improves_in_at_least_two_of_three": bool(sum(1 for s in signs if s > 0) >= 2)}
        r["adopt"] = bool(lo > 0 and r["F_not_worse"] and r["improves_in_at_least_two_of_three"])
        rule[k] = r
    rates = play_rates(lp, pl)
    print("\nrule:", json.dumps(rule, indent=1))
    print("\nplay rates by listed status and season (information only):")
    for k, v in sorted(rates.items()):
        print(f"  {k:24s} n={v['n']:5d}  played {v['played']:.2f}")
    (OUT / "games_v8.json").write_text(json.dumps({"coverage": cover, "folds": res, "rule": rule, "play_rates": rates}, indent=1))


if __name__ == "__main__":
    main()
