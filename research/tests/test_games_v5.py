"""game-winner model v5 candidate features (PREREG_GAMES_V5.md): they must look only backwards and mean what they say."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import game_features_v5 as V5  # noqa: E402

TEAMS = V5.EAST + V5.WEST                   # strongest first: the lower index always wins


def season(days: int, flip_after: int | None = None) -> pd.DataFrame:
    """All 30 teams play every day (circle-method pairings). The lower index wins, except that from `flip_after` on the higher index wins instead."""
    rows, order = [], list(range(30))
    for d in range(1, days + 1):
        rot = [order[0]] + order[1:][(d % 29):] + order[1:][:(d % 29)]
        for k in range(15):
            a, b = sorted((rot[k], rot[29 - k]))
            home_is_a = d % 2 == 0
            a_wins = not (flip_after is not None and d > flip_after)
            date = (pd.Timestamp("2026-10-20") + pd.Timedelta(days=d)).strftime("%Y-%m-%d")
            gid = 2_000_000 + d * 100 + k
            for tid, idx, opp, pts, at_home in ((a + 1, a, b, 110 if a_wins else 100, home_is_a), (b + 1, b, a, 100 if a_wins else 110, not home_is_a)):
                rows.append({"GAME_ID": gid, "TEAM_ID": tid, "TEAM_ABBREVIATION": TEAMS[idx], "GAME_DATE": date, "SEASON_ID": 22026,
                             "MATCHUP": f"{TEAMS[idx]} vs. {TEAMS[opp]}" if at_home else f"{TEAMS[idx]} @ {TEAMS[opp]}",
                             "PTS": pts, "FGA": 85, "FTA": 22, "TOV": 13, "OREB": 10, "DREB": 33, "FG3A": 35, "FG3M": 12, "MIN": 240})
    return pd.DataFrame(rows)


def at(m: pd.DataFrame, team: str, day: int) -> pd.Series:
    return m[(m.GAME_ID // 100 == 20000 + day) & (m.TEAM_ID == TEAMS.index(team) + 1)].iloc[0]


def test_a_runaway_leader_is_safe_and_the_worst_team_is_out_of_it_but_only_late_in_the_season():
    m = V5.motivation(season(70))
    assert at(m, "ATL", 65).cushion > 0.3 and at(m, "ATL", 65).outofit == 0.0
    assert at(m, "UTA", 65).outofit > 0.3 and at(m, "UTA", 65).cushion == 0.0
    assert at(m, "ATL", 20).cushion == 0.0 and at(m, "UTA", 20).outofit == 0.0, "no opinion before 50 games"


def test_nothing_earlier_moves_when_the_future_is_rewritten():
    a, b = V5.motivation(season(70)), V5.motivation(season(70, flip_after=60))
    key = lambda m: m[m.GAME_ID // 100 <= 20000 + 60].sort_values(["GAME_ID", "TEAM_ID"]).reset_index(drop=True)  # noqa: E731
    assert np.allclose(key(a)[["cushion", "outofit"]], key(b)[["cushion", "outofit"]])
    assert not np.allclose(a.sort_values(["GAME_ID", "TEAM_ID"])[["cushion", "outofit"]], b.sort_values(["GAME_ID", "TEAM_ID"])[["cushion", "outofit"]])


def test_playoff_and_preseason_games_do_not_count_toward_the_standings():
    t = season(70)
    t["GAME_ID"] = t.GAME_ID - 2_000_000 + 4_000_000                    # ids starting with 4 are playoff games
    assert V5.motivation(t).empty


def test_density_flags_and_the_home_teams_own_trip_are_home_minus_away():
    days = ["2026-11-01", "2026-11-02", "2026-11-04", "2026-11-05", "2026-11-06"]
    rows = []
    for i, d in enumerate(days, start=1):
        for tid, ab, opp, home in ((1, "BOS", "ATL", i % 2 == 0), (2, "ATL", "BOS", i % 2 == 1)):
            rows.append({"GAME_ID": 2_000_000 + i, "TEAM_ID": tid, "TEAM_ABBREVIATION": ab, "GAME_DATE": d, "SEASON_ID": 22026,
                         "MATCHUP": f"{ab} vs. {opp}" if home else f"{ab} @ {opp}", "PTS": 100, "FGA": 85, "FTA": 22, "TOV": 13, "OREB": 10, "DREB": 33,
                         "FG3A": 35, "FG3M": 12, "MIN": 240})
    teams = pd.DataFrame(rows)
    base = pd.DataFrame({"GAME_ID": [2_000_005], "home_id": [2], "away_id": [1]})      # the last game: ATL (id 2) hosts BOS (id 1)... both played all five
    out = V5.build_v5(base, teams)
    assert out.three_in_four_diff.iloc[0] == 0.0, "both teams played the same dates, so the difference is zero"
    assert out.g7_diff.iloc[0] == 0.0 and np.isfinite(out.home_miles.iloc[0])


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
