"""Load NBA player game logs (via nba_api) into the Cloudflare D1 database.

stats.nba.com blocks cloud IPs, so this runs on your own machine and pushes
rows to D1 with wrangler.

    ingest/.venv/Scripts/python ingest/sync.py "Stephen Curry" "Victor Wembanyama"
    ingest/.venv/Scripts/python ingest/sync.py --league           # fast: the whole league in a few requests, only what is new
    ingest/.venv/Scripts/python ingest/sync.py --all-active       # slow: one player at a time
    ingest/.venv/Scripts/python ingest/sync.py --remote "Stephen Curry"   # production D1
"""
import argparse
import datetime
import json
import subprocess
import sys
import time
from pathlib import Path

import pandas as pd  # noqa: F401  (nba_api depends on it; the tests build frames with `sync.pd`)
from nba_api.stats.endpoints import commonallplayers, leaguegamelog, playergamelog
from nba_api.stats.static import players, teams

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(__file__).resolve().parent / "out.sql"
TEAM_IDS = {t["abbreviation"]: t["id"] for t in teams.get_teams()}
# The app shows this as "synced 2h ago".
MARK_SYNCED = "INSERT OR REPLACE INTO meta (key,value) VALUES ('last_sync', datetime('now'));"
# Picks are graded here, right after new box scores land (the website no longer writes to the database on page views).
# Removes box-score rows with impossible minutes that an older version of this script ingested. Idempotent.
CLEAN_SQL = "DELETE FROM player_games WHERE minutes <= 0 OR minutes > 70;"
GRADE_SQL = (
    (Path(__file__).resolve().parent / "grade.sql").read_text(encoding="utf-8")
)
MIN_GAMES = 10  # below this, always include the previous season


def season_str(start_year: int) -> str:
    return f"{start_year}-{str(start_year + 1)[2:]}"


def current_start_year() -> int:
    today = datetime.date.today()
    return today.year if today.month >= 10 else today.year - 1


def q(v: str) -> str:
    return "'" + v.replace("'", "''") + "'"


def fetch_games(player_id: int, start_year: int, game_type: str = "regular"):
    # stats.nba.com times out under load; retry with backoff before giving up.
    for attempt in range(4):
        try:
            df = playergamelog.PlayerGameLog(
                player_id=player_id,
                season=season_str(start_year),
                season_type_all_star={"playoffs": "Playoffs", "preseason": "Pre Season"}.get(game_type, "Regular Season"),
                timeout=60,
            ).get_data_frames()[0]
            return start_year, df, game_type
        except Exception:
            if attempt == 3:
                raise
            time.sleep(3 * (attempt + 1))


def current_teams() -> dict[int, str]:
    """player id -> current team abbreviation, from one league-wide call (reflects trades)."""
    for attempt in range(4):
        try:
            df = commonallplayers.CommonAllPlayers(is_only_current_season=1, timeout=60).get_data_frames()[0]
            return {int(r.PERSON_ID): r.TEAM_ABBREVIATION for r in df.itertuples() if r.TEAM_ABBREVIATION}
        except Exception:
            if attempt == 3:
                raise
            time.sleep(3 * (attempt + 1))
    return {}


def player_sql(p: dict, n_seasons: int, teams: dict[int, str]) -> list[str]:
    start = current_start_year()
    seasons = [fetch_games(p["id"], start)]
    # Always pull n_seasons; the current one may be nearly empty early in the year.
    for back in range(1, max(n_seasons, 2 if len(seasons[0][1]) < MIN_GAMES else 1)):
        time.sleep(0.7)
        seasons.append(fetch_games(p["id"], start - back))

    # Playoffs: only for seasons where they can have happened (not the current one before April),
    # and only if the player played that regular season.
    today = datetime.date.today()
    for year, df, _ in list(seasons):
        if len(df) == 0 or (year == start and (today.month >= 10 or today.month <= 3)):
            continue
        time.sleep(0.7)
        seasons.append(fetch_games(p["id"], year, "playoffs"))

    # Preseason: current season only. The model gives it a small weight, mostly useful for
    # rookies and players on new teams who have little regular-season history yet.
    time.sleep(0.7)
    seasons.append(fetch_games(p["id"], start, "preseason"))

    # Prefer the league's current roster data (reflects offseason trades); fall back to the last game.
    team = teams.get(p["id"])
    if not team:
        for _, df, kind in seasons:
            if kind == "regular" and len(df):
                team = df.iloc[0].MATCHUP.split(" ")[0]
                break
    sql = [
        f"INSERT OR REPLACE INTO players (id, name, team, position) "
        f"VALUES ({p['id']}, {q(p['full_name'])}, {q(team) if team else 'NULL'}, NULL);"
    ]
    for year, df, kind in seasons:
        for r in df.itertuples():
            date = datetime.datetime.strptime(r.GAME_DATE, "%b %d, %Y").strftime("%Y-%m-%d")
            sql += box_sql(p["id"], int(r.Game_ID), date, year, kind, r)
    return sql


def box_sql(player_id: int, gid: int, date: str, year: int, kind: str, r) -> list[str]:
    """The `games` and `player_games` rows for one box-score line (`r` has the NBA.com columns); nothing for a DNP. Shared by the per-player and league-wide paths."""
    if not r.MIN or not 0 < r.MIN <= 70:
        return []  # DNP, or a corrupt minutes value (NBA.com has published negative minutes)
    matchup = r.MATCHUP
    home = " vs. " in matchup
    mine, theirs = (matchup.split(" vs. ") if home else matchup.split(" @ "))
    # Preseason opponents can be non-NBA clubs with no id; 0 means unknown.
    mine_id, theirs_id = TEAM_IDS.get(mine, 0), TEAM_IDS.get(theirs, 0)
    home_id, away_id = (mine_id, theirs_id) if home else (theirs_id, mine_id)
    return [
        f"INSERT OR REPLACE INTO games (id,date,season,home_team_id,visitor_team_id,game_type) "
        f"VALUES ({gid},{q(date)},{year},{home_id},{away_id},{q(kind)});",
        f"INSERT OR REPLACE INTO player_games (player_id,game_id,team_id,minutes,pts,reb,ast,fg3m,stl,blk,"
        f"fgm,fga,fg3a,ftm,fta,oreb,dreb,tov,pf,plus_minus,opp,is_home,won) "
        f"VALUES ({player_id},{gid},{mine_id},{r.MIN},{r.PTS},{r.REB},{r.AST},{r.FG3M},{r.STL},{r.BLK},"
        f"{r.FGM},{r.FGA},{r.FG3A},{r.FTM},{r.FTA},{r.OREB},{r.DREB},{r.TOV},{r.PF},{int(r.PLUS_MINUS or 0)},"
        f"{q(theirs)},{int(home)},{int(r.WL == 'W')});",
    ]


def run_sql(sql: list[str], remote: bool) -> None:
    OUT.write_text("\n".join(sql), encoding="utf-8")
    subprocess.run(["npx", "wrangler", "d1", "execute", "ubet", "--remote" if remote else "--local", "--file", str(OUT)], cwd=ROOT, shell=True, check=True)


def stored_state(remote: bool, start: int) -> tuple[str | None, int]:
    """(date of the newest stored regular-season game this season or None, stored preseason games this season), asked of the same database the run will write to."""
    cmd = (f"SELECT (SELECT max(date) FROM games WHERE season = {start} AND game_type = 'regular') AS last_date, "
           f"(SELECT count(*) FROM games WHERE season = {start} AND game_type = 'preseason') AS pre")
    out = subprocess.run(["npx", "wrangler", "d1", "execute", "ubet", "--remote" if remote else "--local", "--command", cmd, "--json"],
                         cwd=ROOT, shell=True, check=True, capture_output=True, text=True).stdout
    row = json.loads(out[out.index("["):])[0]["results"][0]
    return row["last_date"], int(row["pre"])


def fetch_league(season: str, season_type: str, date_from: str | None = None):
    """Every player's games of one season in ONE request (the same call research/pull_raw.py makes)."""
    for attempt in range(4):
        try:
            return leaguegamelog.LeagueGameLog(
                season=season, season_type_all_star=season_type, player_or_team_abbreviation="P", timeout=90,
                **({"date_from_nullable": date_from} if date_from else {}),
            ).get_data_frames()[0]
        except Exception:
            if attempt == 3:
                raise
            time.sleep(3 * (attempt + 1))


def league_sql(frames: list, teams: dict[int, str], keep: set[int]) -> list[str]:
    """`frames` is [(season start year, game type, league-wide player log)]. Same rows as the per-player path, built from one table per season,
    for the players in `keep` only (the per-player path syncs current players, not everyone who played last season)."""
    sql, seen = [], {}
    for year, kind, df in frames:
        for r in df.itertuples():
            if int(r.PLAYER_ID) not in keep:
                continue
            rows = box_sql(int(r.PLAYER_ID), int(r.GAME_ID), str(r.GAME_DATE)[:10], year, kind, r)
            if rows:
                sql += rows
                seen.setdefault(int(r.PLAYER_ID), (r.PLAYER_NAME, r.TEAM_ABBREVIATION, r.GAME_DATE))
                if r.GAME_DATE > seen[int(r.PLAYER_ID)][2]:
                    seen[int(r.PLAYER_ID)] = (r.PLAYER_NAME, r.TEAM_ABBREVIATION, r.GAME_DATE)
    head = []
    for pid, (name, abbr, _) in seen.items():
        known = players.find_player_by_id(pid)                  # same spelling the per-player path stores
        team = teams.get(pid) or abbr
        head.append(f"INSERT OR REPLACE INTO players (id, name, team, position) VALUES ({pid}, {q(known['full_name'] if known else name)}, {q(team) if team else 'NULL'}, NULL);")
    return head + sql


def league_sync(remote: bool, teams: dict[int, str], full: bool = False) -> None:
    """Whole-league box-score sync. A normal run asks only for games since 3 days before the newest stored one (a handful of rows); the first run of a season, or --full, loads the season."""
    start = current_start_year()
    last_date, pre = (None, 0) if full else stored_state(remote, start)
    since = None
    if last_date:
        d = datetime.date.fromisoformat(last_date) - datetime.timedelta(days=3)
        since = d.strftime("%m/%d/%Y")                           # NBA.com wants MM/DD/YYYY
    season = season_str(start)
    frames = [(start, "regular", fetch_league(season, "Regular Season", since))]
    if last_date is None:                                        # nothing stored for this season yet: also the previous season, for players with little history
        frames.append((start - 1, "regular", fetch_league(season_str(start - 1), "Regular Season")))
    if pre == 0:
        frames.append((start, "preseason", fetch_league(season, "Pre Season")))
    today = datetime.date.today()
    if 4 <= today.month <= 6:
        frames.append((start, "playoffs", fetch_league(season, "Playoffs", since)))
    sql = league_sql(frames, teams, set(teams) | {p["id"] for p in players.get_active_players()})
    for year, kind, df in frames:
        print(f"{season_str(year)} {kind}: {len(df)} player-games", flush=True)
    run_sql(sql + [CLEAN_SQL, MARK_SYNCED, GRADE_SQL], remote)
    print(f"[1/1] Synced the league ({'since ' + since if since else 'full season'})", flush=True)


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows consoles choke on accented names
    ap = argparse.ArgumentParser()
    ap.add_argument("names", nargs="*")
    ap.add_argument("--all-active", action="store_true")
    ap.add_argument("--seasons", type=int, default=2, help="how many seasons of history to load (default 2)")
    ap.add_argument("--delay", type=float, default=0.7, help="seconds between players (raise it if NBA.com times out)")
    ap.add_argument("--start", type=int, default=0, help="skip the first N players (resume an interrupted --all-active run)")
    ap.add_argument("--league", action="store_true", help="fast path: every player's games from a few league-wide requests, only what is new since the last sync")
    ap.add_argument("--full", action="store_true", help="with --league: load the whole season again instead of only what is new")
    ap.add_argument("--grade-only", action="store_true", help="just grade logged picks against the box scores already stored")
    ap.add_argument("--teams-only", action="store_true", help="just refresh every player's current team (fast)")
    ap.add_argument("--remote", action="store_true", help="write to production D1 instead of local")
    args = ap.parse_args()

    if args.grade_only:
        OUT.write_text(GRADE_SQL, encoding="utf-8")
        subprocess.run(["npx", "wrangler", "d1", "execute", "ubet", "--remote" if args.remote else "--local", "--file", str(OUT)],
                       cwd=ROOT, shell=True, check=True)
        print("Graded logged picks")
        return

    teams = current_teams()

    if args.teams_only:
        flush_teams = [f"UPDATE players SET team = {q(t)} WHERE id = {pid};" for pid, t in teams.items()]
        OUT.write_text("\n".join(flush_teams), encoding="utf-8")
        subprocess.run(
            ["npx", "wrangler", "d1", "execute", "ubet", "--remote" if args.remote else "--local", "--file", str(OUT)],
            cwd=ROOT, shell=True, check=True,
        )
        print(f"Updated teams for {len(teams)} players")
        return

    if args.league:
        league_sync(args.remote, teams, args.full)
        return

    if args.all_active:
        targets = players.get_active_players()
    else:
        targets = []
        for n in args.names:
            found = players.find_players_by_full_name(n)
            if not found:
                sys.exit(f"No player matches {n!r}")
            targets.append(found[0])
    if not targets:
        sys.exit("Give player names or --all-active")
    targets = targets[args.start:]

    def flush(sql: list[str], final: bool = False) -> None:
        # last_sync means "every requested player is up to date": only a clean, finished run may set it.
        sql = sql + [CLEAN_SQL] + ([MARK_SYNCED] if final and not failed else []) + [GRADE_SQL]
        OUT.write_text("\n".join(sql), encoding="utf-8")
        subprocess.run(
            ["npx", "wrangler", "d1", "execute", "ubet", "--remote" if args.remote else "--local", "--file", str(OUT)],
            cwd=ROOT,
            shell=True,
            check=True,
        )

    # Save in batches so a crash or network failure never loses the whole run.
    sql: list[str] = []
    failed: list[str] = []
    for i, p in enumerate(targets, 1):
        try:
            sql += player_sql(p, args.seasons, teams)
            print(f"[{i}/{len(targets)}] {p['full_name']}", flush=True)
        except Exception as e:  # keep going; one failure shouldn't lose the batch
            failed.append(p['full_name'])
            print(f"[{i}/{len(targets)}] {p['full_name']} FAILED: {e}", flush=True)
        if i % 50 == 0 and sql:
            flush(sql)
            sql = []
        time.sleep(args.delay)  # be polite to stats.nba.com
    flush(sql, final=True)
    if failed:
        # Non-zero exit so the Sync button reports it, and no last_sync stamp so the stale-data warning stays on.
        sys.exit(f"{len(failed)} of {len(targets)} players failed (not marked as synced): {', '.join(failed[:10])}")


if __name__ == "__main__":
    main()
