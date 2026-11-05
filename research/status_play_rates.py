"""How often players listed with each status on the NBA's pre-game injury report actually played, measured from the stored reports and the box scores.

    ingest/.venv/Scripts/python research/status_play_rates.py

Reads research/out/games_v8_listed.pkl (written by game_eval_v8.py: one row per player listed in the report used for each game) and the box scores, and writes shared/statusPlayRates.json,
which the Lineups page shows as history. It is a measurement of the past, not a prediction for any one player: it ignores who he is, how long he has been out and what the injury is.
"""
import json
import sys
from datetime import date
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import game_eval_v2 as E  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "shared" / "statusPlayRates.json"
LAST_FULL_SEASON = 2025                  # 2026-27 is still in progress: only completed seasons are pooled


def main():
    lp = pd.read_pickle(ROOT / "research" / "out" / "games_v8_listed.pkl")
    pl, _ = E.load_all()
    pl = pl[pl["MIN"] > 0]
    played = set(zip(pl.PLAYER_ID.astype(int), pd.to_datetime(pl.GAME_DATE).dt.strftime("%Y-%m-%d")))
    m = lp.dropna(subset=["PLAYER_ID"]).copy()
    m["season"] = pd.to_datetime(m.date).map(lambda d: d.year if d.month >= 9 else d.year - 1)
    m = m[m.season <= LAST_FULL_SEASON]
    m["played"] = [(int(p), d) in played for p, d in zip(m.PLAYER_ID, m.date)]
    rates = {}
    for status, key in (("Out", "out"), ("Doubtful", "doubtful"), ("Questionable", "questionable"), ("Probable", "probable")):
        x = m[m.status == status]
        rates[key] = {"n": int(len(x)), "played": round(float(x.played.mean()), 3)}
    doc = {
        "measured": date.today().isoformat(),
        "seasons": f"2020-21 to {LAST_FULL_SEASON}-{str(LAST_FULL_SEASON + 1)[2:]}",
        "source": "the NBA's pre-game injury reports (the latest of the day printed at least an hour before tip) joined to box scores: did the listed player play that day. Players matched by name; unmatched names are left out",
        "rates": rates,
    }
    OUT.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(doc, indent=2))


if __name__ == "__main__":
    main()
