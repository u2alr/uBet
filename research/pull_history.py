"""Pull older seasons (2018-19 to 2021-22, regular season) into research/data/history/ for the game-winner model v2 (PREREG_GAMES_V2.md addendum).

Kept apart from research/data/ on purpose: `features.load_raw` reads only that folder, so the player-prop research, the game model v1 and every cache stay exactly as they were.

    ingest/.venv/Scripts/python research/pull_history.py
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pull_raw import LEVELS, fetch  # noqa: E402

HISTORY = Path(__file__).resolve().parent / "data" / "history"
SEASONS = ["2018-19", "2019-20", "2020-21", "2021-22"]


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    HISTORY.mkdir(parents=True, exist_ok=True)
    for season in SEASONS:
        for lkey, lname in LEVELS.items():
            out = HISTORY / f"{lname}_{season}_regular.csv"
            if out.exists():
                print(f"skip {out.name}")
                continue
            df = fetch(season, "Regular Season", lkey)
            df.to_csv(out, index=False)
            print(f"saved {out.name}: {len(df)} rows", flush=True)
            time.sleep(2)


if __name__ == "__main__":
    main()
