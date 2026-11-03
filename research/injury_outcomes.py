"""How often do players listed Out / Doubtful / Questionable / Day-To-Day actually play? Joins `injury_log` (recorded by game_snapshot.py before every game) to the box scores.

    ingest/.venv/Scripts/python research/injury_outcomes.py [path to the local D1 folder]

There are no historical injury reports, so this can only be answered from what has been recorded since 2026-11-03: each report entry is matched to the team's NEXT game after it was read, and
counts as "played" if the player has minutes in that game. The newest report before the game is the one used. With few rows per status the shares mean little, and the script says so.
This is the data a status-aware availability feature would need (PREREG_GAMES_V3.md: Questionable and Doubtful players could not be tested).
"""
import sqlite3
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

ENOUGH = 30


def outcomes(log: pd.DataFrame, players: pd.DataFrame, teams: pd.DataFrame, norm) -> pd.DataFrame:
    """One row per (player, game): the latest status read before tip-off, and whether he played. `log`: as_of ('YYYY-MM-DD HH:MM'), team (abbreviation), player, status."""
    games = teams.drop_duplicates(["TEAM_ABBREVIATION", "GAME_ID"]).assign(date=lambda d: pd.to_datetime(d.GAME_DATE))[["TEAM_ABBREVIATION", "GAME_ID", "date"]].sort_values("date")
    played = {(int(r.GAME_ID), norm(str(r.PLAYER_NAME))) for r in players[players["MIN"] > 0].itertuples()}
    rows = []
    for r in log.sort_values("as_of").itertuples():
        day = pd.Timestamp(str(r.as_of)[:10])
        nxt = games[(games.TEAM_ABBREVIATION == r.team) & (games.date >= day)].head(1)
        if nxt.empty:
            continue                                                                  # that game has not been played (or is not in the box scores yet)
        rows.append({"player": norm(str(r.player)), "team": r.team, "game": int(nxt.GAME_ID.iloc[0]), "status": str(r.status), "as_of": r.as_of})
    df = pd.DataFrame(rows, columns=["player", "team", "game", "status", "as_of"])
    if df.empty:
        return df.assign(played=[])
    df = df.sort_values("as_of").drop_duplicates(["player", "game"], keep="last")
    df["played"] = [(g, p) in played for g, p in zip(df.game, df.player)]
    return df


def summary(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame(columns=["status", "n", "played", "share"])
    s = df.groupby("status").played.agg(n="size", played="sum").reset_index()
    s["share"] = s.played / s.n
    return s.sort_values("n", ascending=False)


def main():
    from game_eval_v2 import load_all
    from project import norm_name
    folder = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / ".wrangler" / "state" / "v3" / "d1" / "miniflare-D1DatabaseObject")
    log = None
    for f in sorted(folder.glob("*.sqlite")):
        if f.name.startswith("metadata"):
            continue
        db = sqlite3.connect(f)
        if db.execute("select 1 from sqlite_master where name = 'injury_log'").fetchone():
            log = pd.read_sql_query("select as_of, team, player, status from injury_log", db)
            break
    if log is None or log.empty:
        sys.exit("No injury_log rows found. It fills each time research/game_snapshot.py runs.")
    pl, tm = load_all()
    df = outcomes(log, pl, tm, norm_name)
    print(f"{len(log):,} report entries, {df.shape[0]:,} with a game that has since been played")
    s = summary(df)
    print(s.to_string(index=False))
    if s.empty or s.n.max() < ENOUGH:
        print(f"Too few rows per status to say anything (want at least {ENOUGH} for a status). Keep the sync running; this fills in as games are played.")


if __name__ == "__main__":
    main()
