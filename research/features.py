"""Point-in-time feature builder.

Every feature for a player-game is computed ONLY from games played strictly before it (shift(1) before
any rolling/expanding window; team context comes from earlier team games). tests/test_leakage.py checks
this by deleting the future and by corrupting the row's own result, then asserting the features don't move.

Leakage-safe stand-in for injury news: we do not have the official injury report, so "who is out" is
approximated from PAST appearances only (rotation teammates who missed the previous game(s), and how many
team games the player himself has just missed). It is weaker than the real report, and says so.
"""
from pathlib import Path

import numpy as np
import pandas as pd

DATA = Path(__file__).resolve().parent / "data"
STATS = ["pts", "reb", "ast", "fg3m"]
COUNT_COLS = {"PTS": "pts", "REB": "reb", "AST": "ast", "FG3M": "fg3m", "MIN": "min"}


def load_raw() -> tuple[pd.DataFrame, pd.DataFrame]:
    players, teams = [], []
    for f in sorted(DATA.glob("player_*.csv")):
        d = pd.read_csv(f)
        d["gtype"] = "playoffs" if f.stem.endswith("playoffs") else "regular"
        players.append(d)
    for f in sorted(DATA.glob("team_*.csv")):
        d = pd.read_csv(f)
        d["gtype"] = "playoffs" if f.stem.endswith("playoffs") else "regular"
        teams.append(d)
    return pd.concat(players, ignore_index=True), pd.concat(teams, ignore_index=True)


def _team_table(t: pd.DataFrame) -> pd.DataFrame:
    """One row per team-game with rolling (prior-only) offence, defence, pace and rest."""
    t = t.copy()
    t["date"] = pd.to_datetime(t.GAME_DATE)
    t["poss"] = t.FGA + 0.44 * t.FTA + t.TOV - t.OREB
    t = t.sort_values(["TEAM_ID", "date", "GAME_ID"]).reset_index(drop=True)
    opp = t[["GAME_ID", "TEAM_ID", "PTS"]].rename(columns={"TEAM_ID": "OPP_ID", "PTS": "pts_against"})
    t = t.merge(opp, on="GAME_ID")
    t = t[t.TEAM_ID != t.OPP_ID].reset_index(drop=True)
    t = t.sort_values(["TEAM_ID", "date", "GAME_ID"]).reset_index(drop=True)

    g = t.groupby("TEAM_ID")
    for col, name in [("PTS", "t_off"), ("pts_against", "t_def"), ("poss", "t_pace")]:
        t[name] = g[col].transform(lambda x: x.shift(1).rolling(10, min_periods=3).mean())
    t["t_rest"] = g["date"].transform(lambda x: (x - x.shift(1)).dt.days).clip(upper=10)
    t["t_b2b"] = (t.t_rest <= 1).astype(float)
    t.loc[t.t_rest.isna(), "t_b2b"] = np.nan
    t["t_games_before"] = g.cumcount()
    return t[["GAME_ID", "TEAM_ID", "OPP_ID", "date", "t_off", "t_def", "t_pace", "t_rest", "t_b2b", "t_games_before"]]


def _missing_rotation(p: pd.DataFrame) -> pd.DataFrame:
    """For each team-game: typical minutes of rotation teammates who skipped the previous game(s).

    Uses appearances in earlier team games only. A player is 'rotation' if he averaged >= 15 min over the
    team's last 10 games and appeared in >= 3 of them.
    """
    rows = []
    for team, tg in p.groupby("TEAM_ID"):
        games = (
            tg.groupby("GAME_ID").agg(date=("date", "first")).sort_values(["date"]).reset_index()
        )
        by_game = {gid: dict(zip(sub.PLAYER_ID, sub["min"])) for gid, sub in tg.groupby("GAME_ID")}
        order = games.GAME_ID.tolist()
        for i, gid in enumerate(order):
            recent = order[max(0, i - 10):i]
            stats: dict[int, list[float]] = {}
            for rg in recent:
                for pid, m in by_game[rg].items():
                    stats.setdefault(pid, []).append(m)
            rotation = {pid: np.mean(v) for pid, v in stats.items() if len(v) >= 3 and np.mean(v) >= 15}
            miss1 = miss2 = 0.0
            if i >= 1:
                last = by_game[order[i - 1]]
                miss1 = sum(m for pid, m in rotation.items() if pid not in last)
                if i >= 2:
                    last2 = by_game[order[i - 2]]
                    miss2 = sum(m for pid, m in rotation.items() if pid not in last and pid not in last2)
            rows.append((gid, team, miss1, miss2, len(rotation)))
    return pd.DataFrame(rows, columns=["GAME_ID", "TEAM_ID", "miss_prev", "miss_prev2", "n_rotation"])


def build(players: pd.DataFrame, teams: pd.DataFrame) -> pd.DataFrame:
    p = players[players.MIN > 0].copy()
    p["date"] = pd.to_datetime(p.GAME_DATE)
    p["home"] = p.MATCHUP.str.contains(" vs. ").astype(int)
    p["season"] = p.SEASON_ID.astype(str).str[-4:].astype(int)
    p["playoffs"] = (p.gtype == "playoffs").astype(int)
    p = p.rename(columns={k: v for k, v in COUNT_COLS.items()})
    p = p.sort_values(["PLAYER_ID", "date", "GAME_ID"]).reset_index(drop=True)

    g = p.groupby("PLAYER_ID")
    gs = p.groupby(["PLAYER_ID", "season"])
    for s in STATS + ["min"]:
        prev = g[s].transform(lambda x: x.shift(1))
        p[f"{s}_l3"] = g[s].transform(lambda x: x.shift(1).rolling(3, min_periods=2).mean())
        p[f"{s}_l5"] = g[s].transform(lambda x: x.shift(1).rolling(5, min_periods=3).mean())
        p[f"{s}_l10"] = g[s].transform(lambda x: x.shift(1).rolling(10, min_periods=5).mean())
        p[f"{s}_l20"] = g[s].transform(lambda x: x.shift(1).rolling(20, min_periods=8).mean())
        p[f"{s}_l40"] = g[s].transform(lambda x: x.shift(1).rolling(40, min_periods=10).mean())
        p[f"{s}_ewm"] = g[s].transform(lambda x: x.shift(1).ewm(halflife=5, min_periods=3).mean())
        p[f"{s}_sd10"] = g[s].transform(lambda x: x.shift(1).rolling(10, min_periods=5).std())
        p[f"{s}_s2d"] = gs[s].transform(lambda x: x.shift(1).expanding(min_periods=1).mean())
        del prev
    p["n_prior"] = g.cumcount()
    p["n_prior_season"] = gs.cumcount()

    # Per-minute production over the last 10 / 20 games (sum / sum, so low-minute games don't dominate).
    for s in STATS:
        for w in (10, 20):
            num = g[s].transform(lambda x: x.shift(1).rolling(w, min_periods=5).sum())
            den = g["min"].transform(lambda x: x.shift(1).rolling(w, min_periods=5).sum())
            p[f"{s}_pm{w}"] = num / den

    # Rest and absence for the player himself.
    p["p_rest"] = g["date"].transform(lambda x: (x - x.shift(1)).dt.days).clip(upper=30)

    t = _team_table(teams)
    own = t.rename(columns={
        "t_off": "own_off", "t_def": "own_def", "t_pace": "own_pace", "t_rest": "own_rest", "t_b2b": "own_b2b",
        "t_games_before": "own_games_before",
    }).drop(columns=["OPP_ID", "date"])
    opp = t.rename(columns={"TEAM_ID": "OPP_ID", "OPP_ID": "TEAM_ID", "t_off": "opp_off", "t_def": "opp_def",
                            "t_pace": "opp_pace", "t_rest": "opp_rest", "t_b2b": "opp_b2b"})[
        ["GAME_ID", "TEAM_ID", "opp_off", "opp_def", "opp_pace", "opp_rest", "opp_b2b"]]
    # opp's row is keyed by (GAME_ID, opp team); join it onto our team's row via the opponent id.
    own = own.merge(t[["GAME_ID", "TEAM_ID", "OPP_ID"]], on=["GAME_ID", "TEAM_ID"])
    opp = opp.rename(columns={"TEAM_ID": "OPP_ID"})
    opp = opp.merge(t[["GAME_ID", "TEAM_ID"]].rename(columns={"TEAM_ID": "OPP_ID"}), on=["GAME_ID", "OPP_ID"])
    ctx = own.merge(opp, on=["GAME_ID", "OPP_ID"], how="left")
    p = p.merge(ctx, on=["GAME_ID", "TEAM_ID"], how="left")

    p = p.merge(_missing_rotation(p), on=["GAME_ID", "TEAM_ID"], how="left")

    # Team games the player has just sat out (returning from injury / rest), from past appearances only.
    team_dates = {tid: np.sort(sub.date.unique()) for tid, sub in t.groupby("TEAM_ID")}
    prev_date = g["date"].transform(lambda x: x.shift(1))
    missed = np.zeros(len(p))
    for i, (tid, d, d0) in enumerate(zip(p.TEAM_ID.values, p.date.values, prev_date.values)):
        if pd.isna(d0):
            missed[i] = np.nan
            continue
        arr = team_dates[tid]
        missed[i] = max(np.searchsorted(arr, d, side="left") - np.searchsorted(arr, d0, side="right"), 0)
    p["games_missed"] = np.minimum(missed, 20)

    p["minutes"] = p["min"]  # the target for the minutes model; features above use the shifted copies
    return p.sort_values(["date", "GAME_ID", "PLAYER_ID"]).reset_index(drop=True)


FEATURES = (
    [f"{s}_{w}" for s in STATS + ["min"] for w in ("l3", "l5", "l10", "l20", "l40", "ewm", "sd10", "s2d")]
    + [f"{s}_pm{w}" for s in STATS for w in (10, 20)]
    + ["n_prior", "n_prior_season", "p_rest", "games_missed", "home", "playoffs",
       "own_off", "own_def", "own_pace", "own_rest", "own_b2b", "own_games_before",
       "opp_off", "opp_def", "opp_pace", "opp_rest", "opp_b2b",
       "miss_prev", "miss_prev2", "n_rotation"]
)


if __name__ == "__main__":
    import time

    t0 = time.time()
    pl, tm = load_raw()
    df = build(pl, tm)
    out = Path(__file__).resolve().parent / "out"
    out.mkdir(exist_ok=True)
    df.to_pickle(out / "features.pkl")
    print(f"built {len(df):,} rows x {len(df.columns)} cols in {time.time() - t0:.0f}s -> out/features.pkl")
