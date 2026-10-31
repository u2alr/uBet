"""Pull per-game defensive matchups (who guarded whom, for how many possessions, with what result) from NBA.com's BoxScoreMatchupsV3 into research/data/matchups.sqlite.

One request per game, resumable (games already stored are skipped). Matchup data is recorded PER GAME, so a feature built for game N can use only games before N: unlike season
aggregates (which already include the games being predicted), nothing here is end-of-season.

    ingest/.venv/Scripts/python research/pull_matchups.py [--delay 0.7] [--limit N]
"""
import argparse
import sqlite3
import sys
import time
from pathlib import Path

import pandas as pd
from nba_api.stats.endpoints import boxscorematchupsv3

DATA = Path(__file__).resolve().parent / "data"
DB = DATA / "matchups.sqlite"
COLS = {
    "teamId": "off_team", "personIdOff": "off_id", "positionOff": "off_pos", "personIdDef": "def_id",
    "partialPossessions": "poss", "switchesOn": "switches", "playerPoints": "pts", "teamPoints": "team_pts",
    "matchupAssists": "ast", "matchupPotentialAssists": "pot_ast", "matchupTurnovers": "tov", "matchupBlocks": "blk",
    "matchupFieldGoalsMade": "fgm", "matchupFieldGoalsAttempted": "fga", "matchupThreePointersMade": "fg3m", "matchupThreePointersAttempted": "fg3a",
    "helpFieldGoalsMade": "help_fgm", "helpFieldGoalsAttempted": "help_fga", "matchupFreeThrowsAttempted": "fta", "shootingFouls": "sfoul",
}


def game_ids() -> list[tuple[str, str]]:
    out = {}
    for f in sorted(DATA.glob("team_*_*.csv")):
        d = pd.read_csv(f, usecols=["GAME_ID", "GAME_DATE"], dtype={"GAME_ID": str})
        for gid, date in zip(d.GAME_ID, d.GAME_DATE):
            out[gid] = date
    return sorted(out.items(), key=lambda kv: (kv[1], kv[0]))


def minutes(s) -> float:
    try:
        m, sec = str(s).split(":")
        return int(m) + int(sec) / 60
    except ValueError:
        return float("nan")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--delay", type=float, default=0.7)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--part", type=int, default=0, help="with --parts N: pull only every Nth missing game starting at this offset, so N pullers can run side by side")
    ap.add_argument("--parts", type=int, default=1)
    ap.add_argument("--reverse", action="store_true", help="work from the newest game backwards (run beside a forward pull to halve the time)")
    a = ap.parse_args()
    con = sqlite3.connect(DB)
    con.execute("CREATE TABLE IF NOT EXISTS matchups (game_id TEXT, date TEXT, mins REAL, " + ", ".join(f"{c} REAL" if c not in ('off_pos', 'game_id') else f"{c} TEXT" for c in COLS.values()) + ")")
    con.execute("CREATE TABLE IF NOT EXISTS pulled (game_id TEXT PRIMARY KEY, date TEXT, rows INTEGER, at TEXT)")
    con.execute("CREATE INDEX IF NOT EXISTS m_game ON matchups (game_id)")
    done = {r[0] for r in con.execute("SELECT game_id FROM pulled")}
    todo = [(g, d) for g, d in game_ids() if g not in done]
    todo = todo[a.part::a.parts]
    if a.reverse:
        todo.reverse()
    if a.limit:
        todo = todo[: a.limit]
    print(f"{len(done)} games stored, {len(todo)} to pull", flush=True)
    fails = 0
    for i, (gid, date) in enumerate(todo, 1):
        if con.execute("SELECT 1 FROM pulled WHERE game_id=?", (gid,)).fetchone():
            continue   # another puller got there first
        for attempt in range(4):
            try:
                df = boxscorematchupsv3.BoxScoreMatchupsV3(game_id=gid, timeout=40).get_data_frames()[0]
                break
            except IndexError:
                df = pd.DataFrame()   # the feed has no matchup tracking for this game (an empty response, not an error): recorded as pulled with 0 rows so it is not retried forever
                break
            except Exception as e:  # noqa: BLE001 - the library raises many types; retry then skip
                df = None
                time.sleep(2 * (attempt + 1))
        if df is None:
            fails += 1
            print(f"[{i}/{len(todo)}] {gid} failed ({fails} so far)", flush=True)
            if fails > 40:
                sys.exit("Too many failures; stopping. Re-run to resume.")
            continue
        if df.empty:
            con.execute("INSERT OR REPLACE INTO pulled VALUES (?,?,?,datetime('now'))", (gid, date, 0))
            con.commit()
            continue
        rows = pd.DataFrame({"game_id": gid, "date": date, "mins": df["matchupMinutes"].map(minutes)})
        for src, dst in COLS.items():
            rows[dst] = df[src].values
        rows.to_sql("matchups", con, if_exists="append", index=False)
        con.execute("INSERT OR REPLACE INTO pulled VALUES (?,?,?,datetime('now'))", (gid, date, len(rows)))
        con.commit()
        if i % 50 == 0:
            print(f"[{i}/{len(todo)}] {date}", flush=True)
        time.sleep(a.delay)
    print("done", flush=True)


if __name__ == "__main__":
    main()

