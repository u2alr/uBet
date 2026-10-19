"""Pull raw league-wide game logs from NBA.com into research/data/ (one CSV per season/type/level).

LeagueGameLog returns every player (or team) game of a season in a single request, so four seasons
need only a handful of calls instead of ~500 per-player calls. Files that already exist are skipped,
so an interrupted run resumes where it stopped.

    ingest/.venv/Scripts/python research/pull_raw.py
"""
import sys
import time
from pathlib import Path

from nba_api.stats.endpoints import leaguegamelog

DATA = Path(__file__).resolve().parent / "data"
SEASONS = ["2022-23", "2023-24", "2024-25", "2025-26"]
TYPES = {"regular": "Regular Season", "playoffs": "Playoffs"}
LEVELS = {"P": "player", "T": "team"}


def fetch(season: str, season_type: str, level: str):
    for attempt in range(5):
        try:
            return leaguegamelog.LeagueGameLog(
                season=season,
                season_type_all_star=season_type,
                player_or_team_abbreviation=level,
                timeout=90,
            ).get_data_frames()[0]
        except Exception as e:  # NBA.com times out under load
            print(f"  attempt {attempt + 1} failed: {e}", flush=True)
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"gave up on {season} {season_type} {level}")


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    DATA.mkdir(exist_ok=True)
    for season in SEASONS:
        for tkey, tname in TYPES.items():
            for lkey, lname in LEVELS.items():
                out = DATA / f"{lname}_{season}_{tkey}.csv"
                if out.exists():
                    print(f"skip {out.name}")
                    continue
                df = fetch(season, tname, lkey)
                df.to_csv(out, index=False)
                print(f"saved {out.name}: {len(df)} rows", flush=True)
                time.sleep(2)


if __name__ == "__main__":
    main()
