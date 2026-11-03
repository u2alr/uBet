"""injury_outcomes.py must match each report entry to the team's NEXT game, use the newest report before it, and count "played" only on minutes."""
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import injury_outcomes as I  # noqa: E402

norm = lambda s: s.lower().replace(".", "")  # noqa: E731

teams = pd.DataFrame([
    {"TEAM_ABBREVIATION": "BOS", "GAME_ID": 1, "GAME_DATE": "2026-11-05"}, {"TEAM_ABBREVIATION": "NYK", "GAME_ID": 1, "GAME_DATE": "2026-11-05"},
    {"TEAM_ABBREVIATION": "BOS", "GAME_ID": 2, "GAME_DATE": "2026-11-07"}, {"TEAM_ABBREVIATION": "MIA", "GAME_ID": 2, "GAME_DATE": "2026-11-07"},
])
players = pd.DataFrame([
    {"GAME_ID": 1, "PLAYER_NAME": "Jayson Tatum", "MIN": 31.0}, {"GAME_ID": 1, "PLAYER_NAME": "Jaylen Brown", "MIN": 0.0},
    {"GAME_ID": 2, "PLAYER_NAME": "Jaylen Brown", "MIN": 28.0},
])


def test_each_entry_is_judged_on_the_teams_next_game_and_the_newest_report_wins():
    log = pd.DataFrame([
        {"as_of": "2026-11-04 09:00", "team": "BOS", "player": "Jayson Tatum", "status": "Out"},
        {"as_of": "2026-11-05 03:00", "team": "BOS", "player": "Jayson Tatum", "status": "Questionable"},   # newer, same game: this one counts
        {"as_of": "2026-11-05 03:00", "team": "BOS", "player": "Jaylen Brown", "status": "Questionable"},
        {"as_of": "2026-11-06 03:00", "team": "BOS", "player": "Jaylen Brown", "status": "Questionable"},   # the next game
        {"as_of": "2026-11-08 03:00", "team": "BOS", "player": "Someone", "status": "Out"},                  # no game after it yet: dropped
    ])
    df = I.outcomes(log, players, teams, norm)
    got = {(r.player, r.game): (r.status, r.played) for r in df.itertuples()}
    assert got[("jayson tatum", 1)] == ("Questionable", True)
    assert got[("jaylen brown", 1)] == ("Questionable", False), "zero minutes is not playing"
    assert got[("jaylen brown", 2)] == ("Questionable", True)
    assert len(df) == 3


def test_the_summary_counts_players_and_shares_by_status():
    log = pd.DataFrame([{"as_of": "2026-11-05 03:00", "team": "BOS", "player": "Jayson Tatum", "status": "Questionable"}, {"as_of": "2026-11-05 03:00", "team": "BOS", "player": "Jaylen Brown", "status": "Questionable"}])
    s = I.summary(I.outcomes(log, players, teams, norm)).set_index("status")
    assert s.loc["Questionable", "n"] == 2 and s.loc["Questionable", "played"] == 1 and s.loc["Questionable", "share"] == 0.5
    assert I.summary(I.outcomes(log.iloc[0:0], players, teams, norm)).empty


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
