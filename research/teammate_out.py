"""Teammate-out lift (PREREG_TEAMMATE_OUT.md). Point-in-time: a game's lift uses only EARLIER games' with/without totals.

    ingest/.venv/Scripts/python research/teammate_out.py            # folds A and B
    ingest/.venv/Scripts/python research/teammate_out.py --final    # fold F, once

Also importable: `compute_lifts(df)` returns one row of lifts per player-game; production reuses `lift_for` with the DB history.
"""
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

sys.path.insert(0, str(Path(__file__).resolve().parent))
from features import FEATURES, STATS  # noqa: E402
from improve_model import boot  # noqa: E402
from models import HGB, Dispersion, nb_logpmf  # noqa: E402

OUT = Path(__file__).resolve().parent / "out"
FOLDS = {"A": ([2022], 2023), "B": ([2022, 2023], 2024), "F": ([2022, 2023, 2024], 2025)}
COLS = ["minutes", "pts", "reb", "ast", "fg3m"]
K, MIN_IN, MIN_OUT, CAP = 10.0, 3, 1, 0.30
ROT_MIN, ROT_APPEAR, ROT_WINDOW = 15.0, 3, 10


def lift_for(stats: dict, absent: list[int], player: int) -> np.ndarray:
    """Sum over absent rotation teammates of the shrunk (out - in) mean difference. `stats[(player, mate)] = [n_out, sum_out[5], n_in, sum_in[5]]`."""
    total = np.zeros(len(COLS))
    for o in absent:
        s = stats.get((player, o))
        if not s or s[0] < MIN_OUT or s[2] < MIN_IN:
            continue
        total += (s[1] / s[0] - s[3] / s[2]) * s[0] / (s[0] + K)
    return total


def compute_lifts(df: pd.DataFrame) -> pd.DataFrame:
    """One row per player-game (same order as df): lift_<col> for the 5 columns and the number of absent rotation teammates."""
    df = df.sort_values(["date", "GAME_ID", "PLAYER_ID"])
    lift = {c: np.zeros(len(df)) for c in COLS}
    n_abs = np.zeros(len(df))
    pos = {idx: i for i, idx in enumerate(df.index)}
    for team, tg in df.groupby("TEAM_ID", sort=False):
        order = tg.groupby("GAME_ID").date.first().sort_values().index.tolist()
        by_game = {gid: sub for gid, sub in tg.groupby("GAME_ID")}
        history: list[dict[int, float]] = []          # per earlier team game: player -> minutes
        stats: dict[tuple[int, int], list] = {}
        for gid in order:
            sub = by_game[gid]
            present = dict(zip(sub.PLAYER_ID, sub.minutes))
            recent = history[-ROT_WINDOW:]
            tally: dict[int, list[float]] = defaultdict(list)
            for h in recent:
                for pid, m in h.items():
                    tally[pid].append(m)
            rotation = [pid for pid, v in tally.items() if len(v) >= ROT_APPEAR and np.mean(v) >= ROT_MIN]
            absent = [pid for pid in rotation if pid not in present]
            vals = sub[COLS].to_numpy(float)
            for row_i, (idx, pid) in enumerate(zip(sub.index, sub.PLAYER_ID)):
                mates = [a for a in absent if a != pid]
                if mates:
                    l = lift_for(stats, mates, pid)
                    for k, c in enumerate(COLS):
                        lift[c][pos[idx]] = l[k]
                    n_abs[pos[idx]] = len(mates)
            # update the with/without totals AFTER this game's lift was read
            for row_i, pid in enumerate(sub.PLAYER_ID):
                for o in rotation:
                    if o == pid:
                        continue
                    s = stats.get((pid, o))
                    if s is None:
                        s = stats[(pid, o)] = [0, np.zeros(len(COLS)), 0, np.zeros(len(COLS))]
                    if o in present:
                        s[2] += 1
                        s[3] += vals[row_i]
                    else:
                        s[0] += 1
                        s[1] += vals[row_i]
            history.append(present)
    out = pd.DataFrame({f"lift_{c}": lift[c] for c in COLS}, index=df.index)
    out["n_absent_rot"] = n_abs
    return out.loc[df.index]


def hgb(train, test, stat):
    return HistGradientBoostingRegressor(loss="poisson", **HGB).fit(train[FEATURES], train[stat]).predict(test[FEATURES])


def run_fold(df, name, rng):
    tr_seasons, te_season = FOLDS[name]
    base = (df.n_prior >= 5) & df["pts_l10"].notna()
    tr = df[base & df.season.isin(tr_seasons)].sort_values("date")
    te = df[base & (df.season == te_season) & (df.min_l10 >= 20)].sort_values("date")
    cut = int(len(tr) * 0.8)
    fit_part, alpha_part = tr.iloc[:cut], tr.iloc[cut:]
    weeks = te.date.dt.to_period("W").astype(str).to_numpy()
    changed = (te.n_absent_rot > 0).to_numpy()
    out = {"n_test": len(te), "n_changed": int(changed.sum()), "stats": {}}
    df_stats = [*STATS, "pra"]
    for stat in df_stats:
        probe = hgb(fit_part, alpha_part, stat)
        disp = Dispersion().fit(probe, alpha_part[stat].to_numpy(float))
        mu0 = hgb(tr, te, stat)
        lift = (te.lift_pts + te.lift_reb + te.lift_ast).to_numpy() if stat == "pra" else te[f"lift_{stat}"].to_numpy()
        lift = np.clip(lift, -CAP * mu0, CAP * mu0)
        mu1 = np.maximum(mu0 + lift, 0.1)
        y = te[stat].to_numpy(float)
        ls0, ls1 = nb_logpmf(y, mu0, disp.alpha(mu0)), nb_logpmf(y, mu1, disp.alpha(mu1))
        r = {}
        d, lo, hi = boot((ls1 - ls0)[changed], weeks[changed], rng)
        r["changed"] = {"dlogscore": d, "ci_lo": lo, "ci_hi": hi, "mae_base": float(np.mean(np.abs(y - mu0)[changed])), "mae_lift": float(np.mean(np.abs(y - mu1)[changed])),
                        "bias_base": float(np.mean((y - mu0)[changed])), "bias_lift": float(np.mean((y - mu1)[changed])), "mean_lift": float(np.mean(lift[changed]))}
        d, lo, hi = boot(ls1 - ls0, weeks, rng)
        r["all"] = {"dlogscore": d, "ci_lo": lo, "ci_hi": hi}
        out["stats"][stat] = r
        c = r["changed"]
        print(f"{name} {stat:5s} changed rows {int(changed.sum())}: dlogscore {c['dlogscore']:+.4f} [{c['ci_lo']:+.4f},{c['ci_hi']:+.4f}]  MAE {c['mae_base']:.3f}->{c['mae_lift']:.3f}  bias {c['bias_base']:+.3f}->{c['bias_lift']:+.3f}  | all rows {r['all']['dlogscore']:+.4f}", flush=True)
    return out


def main():
    final = "--final" in sys.argv
    df = pd.read_pickle(OUT / "features.pkl")
    df = df.assign(pra=df.pts + df.reb + df.ast).join(compute_lifts(df))
    print(f"lifts computed; rows with an absent rotation teammate: {int((df.n_absent_rot > 0).sum())} of {len(df)}", flush=True)
    rng = np.random.default_rng(0)
    res = {f: run_fold(df, f, rng) for f in (["F"] if final else ["A", "B"])}
    (OUT / f"teammate_out_{'final' if final else 'dev'}.json").write_text(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
