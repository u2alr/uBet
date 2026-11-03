"""Scores the live record: for every game played since 2026-11-03, the number each model stored BEFORE tip-off (game_lean_log) against what happened.

    ingest/.venv/Scripts/python research/shadow_report.py [path to the local D1 folder]

Models: the shipped games-v2, the old games-v1, the two SHADOWS (returning players, player importance; PREREG_GAMES_V3.md and PREREG_GAMES_V4.md), and the market's no-margin chance when a price was
stored. Nothing here changes a displayed number. The rule for adopting importance is fixed in PREREG_GAMES_V4.md: at least 300 live games, a paired log-loss improvement over games-v2 whose 95%
interval is entirely above 0.
"""
import sqlite3
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

MODELS = {"model_home_prob": "games-v2 (shipped)", "model_v1_prob": "games-v1", "shadow_prob": "shadow: returning players", "shadow2_prob": "shadow: player importance", "market_home_prob": "market (no margin)"}
NEEDED = 300
EPS = 1e-6


def latest_before_tipoff(log: pd.DataFrame) -> pd.DataFrame:
    """One row per game: the newest stored prediction that was made on or before the game's date."""
    d = log.copy()
    d = d[d.as_of.astype(str).str[:10] <= d.date.astype(str)]
    return d.sort_values("as_of").drop_duplicates(["date", "home", "away"], keep="last")


def home_results(teams: pd.DataFrame) -> pd.DataFrame:
    """(date, home, away, home_won) for every game in the team box scores."""
    t = teams.drop_duplicates(["GAME_ID", "TEAM_ID"])
    home = t[t.MATCHUP.str.contains(" vs. ")][["GAME_ID", "GAME_DATE", "TEAM_ABBREVIATION", "WL"]].rename(columns={"TEAM_ABBREVIATION": "home", "WL": "wl"})
    away = t[t.MATCHUP.str.contains(" @ ")][["GAME_ID", "TEAM_ABBREVIATION"]].rename(columns={"TEAM_ABBREVIATION": "away"})
    r = home.merge(away, on="GAME_ID")
    return pd.DataFrame({"date": r.GAME_DATE.astype(str), "home": r.home, "away": r.away, "home_won": (r.wl == "W").astype(int)})


def score(log: pd.DataFrame, results: pd.DataFrame, rng=None) -> dict:
    g = latest_before_tipoff(log).merge(results, on=["date", "home", "away"], how="inner")
    out = {"games": int(len(g)), "models": {}, "needed": NEEDED}
    if g.empty:
        return out
    y = g.home_won.to_numpy(float)
    ll = lambda p: -(y * np.log(np.clip(p, EPS, 1 - EPS)) + (1 - y) * np.log(1 - np.clip(p, EPS, 1 - EPS)))   # noqa: E731
    rng = rng or np.random.default_rng(0)
    base = ll(g.model_home_prob.to_numpy(float))
    for col, label in MODELS.items():
        if col not in g or g[col].notna().sum() == 0:
            continue
        ok = g[col].notna().to_numpy()
        l = ll(g[col].to_numpy(float))
        entry = {"label": label, "n": int(ok.sum()), "logloss": float(l[ok].mean())}
        if col != "model_home_prob":
            d = (base - l)[ok]
            days = g.date.to_numpy()[ok]
            wk = pd.Series(d).groupby(days).agg(["sum", "count"])
            s, c = wk["sum"].to_numpy(), wk["count"].to_numpy()
            idx = rng.integers(0, len(s), size=(2000, len(s)))
            st = s[idx].sum(1) / c[idx].sum(1)
            entry.update({"dlogloss_vs_v2": float(d.mean()), "ci_lo": float(np.percentile(st, 2.5)), "ci_hi": float(np.percentile(st, 97.5))})
        out["models"][col] = entry
    return out


def main():
    from game_eval_v2 import load_all
    folder = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / ".wrangler" / "state" / "v3" / "d1" / "miniflare-D1DatabaseObject")
    log = None
    for f in sorted(folder.glob("*.sqlite")):
        if f.name.startswith("metadata"):
            continue
        db = sqlite3.connect(f)
        if db.execute("select 1 from sqlite_master where name = 'game_lean_log'").fetchone():
            log = pd.read_sql_query("select * from game_lean_log", db)
            break
    if log is None or log.empty:
        sys.exit("No game_lean_log rows. It fills each time research/game_snapshot.py runs.")
    _, tm = load_all()
    r = score(log, home_results(tm))
    print(f"{r['games']} live games have a stored pre-game prediction and a result (the adoption rule needs {NEEDED}).")
    for col, m in r["models"].items():
        extra = "" if "dlogloss_vs_v2" not in m else f"  vs games-v2 {m['dlogloss_vs_v2']:+.4f} [{m['ci_lo']:+.4f}, {m['ci_hi']:+.4f}]"
        print(f"  {m['label']:28s} n={m['n']:4d} log loss {m['logloss']:.4f}{extra}")
    if r["games"] < NEEDED:
        print(f"Too early to conclude anything: {NEEDED - r['games']} more games needed before the importance rule can be applied.")


if __name__ == "__main__":
    main()
