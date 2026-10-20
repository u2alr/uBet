"""Load NBA player game logs (via nba_api) into the Cloudflare D1 database.

stats.nba.com blocks cloud IPs, so this runs on your own machine and pushes
rows to D1 with wrangler.

    ingest/.venv/Scripts/python ingest/sync.py "Stephen Curry" "Victor Wembanyama"
    ingest/.venv/Scripts/python ingest/sync.py --all-active
    ingest/.venv/Scripts/python ingest/sync.py --remote "Stephen Curry"   # production D1
"""
import argparse
import datetime
import subprocess
import sys
import time
from pathlib import Path

from nba_api.stats.endpoints import commonallplayers, playergamelog
from nba_api.stats.static import players, teams

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(__file__).resolve().parent / "out.sql"
TEAM_IDS = {t["abbreviation"]: t["id"] for t in teams.get_teams()}
# The app shows this as "synced 2h ago".
MARK_SYNCED = "INSERT OR REPLACE INTO meta (key,value) VALUES ('last_sync', datetime('now'));"
# Picks are graded here, right after new box scores land (the website no longer writes to the database on page views).
# Removes box-score rows with impossible minutes that an older version of this script ingested. Idempotent.
CLEAN_SQL = "DELETE FROM player_games WHERE minutes <= 0 OR minutes > 70;"
GRADE_SQL = (Path(__file__).resolve().parent / "grade.sql").read_text(encoding="utf-8")
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
            if not r.MIN or not 0 < r.MIN <= 70:
                continue  # DNP, or a corrupt minutes value (NBA.com has published negative minutes)
            matchup = r.MATCHUP
            home = " vs. " in matchup
            mine, theirs = (matchup.split(" vs. ") if home else matchup.split(" @ "))
            # Preseason opponents can be non-NBA clubs with no id; 0 means unknown.
            mine_id, theirs_id = TEAM_IDS.get(mine, 0), TEAM_IDS.get(theirs, 0)
            home_id, away_id = (mine_id, theirs_id) if home else (theirs_id, mine_id)
            date = datetime.datetime.strptime(r.GAME_DATE, "%b %d, %Y").strftime("%Y-%m-%d")
            gid = int(r.Game_ID)
            sql.append(
                f"INSERT OR REPLACE INTO games (id,date,season,home_team_id,visitor_team_id,game_type) "
                f"VALUES ({gid},{q(date)},{year},{home_id},{away_id},{q(kind)});"
            )
            sql.append(
                f"INSERT OR REPLACE INTO player_games (player_id,game_id,team_id,minutes,pts,reb,ast,fg3m,stl,blk,"
                f"fgm,fga,fg3a,ftm,fta,oreb,dreb,tov,pf,plus_minus,opp,is_home,won) "
                f"VALUES ({p['id']},{gid},{mine_id},{r.MIN},{r.PTS},{r.REB},{r.AST},{r.FG3M},{r.STL},{r.BLK},"
                f"{r.FGM},{r.FGA},{r.FG3A},{r.FTM},{r.FTA},{r.OREB},{r.DREB},{r.TOV},{r.PF},{int(r.PLUS_MINUS or 0)},"
                f"{q(theirs)},{int(home)},{int(r.WL == 'W')});"
            )
    return sql


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows consoles choke on accented names
    ap = argparse.ArgumentParser()
    ap.add_argument("names", nargs="*")
    ap.add_argument("--all-active", action="store_true")
    ap.add_argument("--seasons", type=int, default=2, help="how many seasons of history to load (default 2)")
    ap.add_argument("--delay", type=float, default=0.7, help="seconds between players (raise it if NBA.com times out)")
    ap.add_argument("--start", type=int, default=0, help="skip the first N players (resume an interrupted --all-active run)")
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
        flush_teams = [f"UPDATE players SET team = {q(t)} WHERE id = {pid};" for pid, t in teams.items()] + [MARK_SYNCED]
        OUT.write_text("\n".join(flush_teams), encoding="utf-8")
        subprocess.run(
            ["npx", "wrangler", "d1", "execute", "ubet", "--remote" if args.remote else "--local", "--file", str(OUT)],
            cwd=ROOT, shell=True, check=True,
        )
        print(f"Updated teams for {len(teams)} players")
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

    def flush(sql: list[str]) -> None:
        sql = sql + [CLEAN_SQL, MARK_SYNCED, GRADE_SQL]
        OUT.write_text("\n".join(sql), encoding="utf-8")
        subprocess.run(
            ["npx", "wrangler", "d1", "execute", "ubet", "--remote" if args.remote else "--local", "--file", str(OUT)],
            cwd=ROOT,
            shell=True,
            check=True,
        )

    # Save in batches so a crash or network failure never loses the whole run.
    sql: list[str] = []
    for i, p in enumerate(targets, 1):
        try:
            sql += player_sql(p, args.seasons, teams)
            print(f"[{i}/{len(targets)}] {p['full_name']}", flush=True)
        except Exception as e:  # keep going; one failure shouldn't lose the batch
            print(f"[{i}/{len(targets)}] {p['full_name']} FAILED: {e}", flush=True)
        if i % 50 == 0 and sql:
            flush(sql)
            sql = []
        time.sleep(args.delay)  # be polite to stats.nba.com
    if sql:
        flush(sql)


if __name__ == "__main__":
    main()
