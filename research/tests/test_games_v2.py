"""game-winner model v2 features (PREREG_GAMES_V2.md): they must look only backwards, and they must do what they say.

A feature that quietly peeks at the game it predicts makes a model look better than it is, so the first test changes the FUTURE and demands that the past does not move.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import game_features_v2 as V  # noqa: E402


def league(n_days=60, seed=1) -> pd.DataFrame:
    """A small synthetic league in the shape of game_features._team_games: one row per game with the HOME side's view (home == 1)."""
    rng = np.random.default_rng(seed)
    strength = {1: 8.0, 2: 3.0, 3: 0.0, 4: -4.0, 5: -7.0}
    rows, gid = [], 100
    for d in range(n_days):
        ids = list(strength)
        rng.shuffle(ids)
        for h, a in ((ids[0], ids[1]), (ids[2], ids[3])):
            margin = strength[h] - strength[a] + 2.0 + rng.normal(0, 9)
            rows.append({"GAME_ID": gid, "date": pd.Timestamp("2025-11-01") + pd.Timedelta(days=d), "TEAM_ID": h, "OPP": a, "PTS": 110 + margin / 2, "opp_pts": 110 - margin / 2, "home": 1})
            gid += 1
    return pd.DataFrame(rows)


def test_ratings_never_see_the_game_they_predict():
    t = league()
    base, _ = V.srs_table(t)
    t2 = t.copy()
    cut = t2.date.sort_values().iloc[len(t2) // 2]
    future = t2.date >= cut
    t2.loc[future, "PTS"] += 40            # rewrite the second half of the season: a huge change to every future result
    changed, _ = V.srs_table(t2)
    m = base.merge(changed, on="GAME_ID", suffixes=("_a", "_b")).merge(t2[["GAME_ID", "date"]], on="GAME_ID")
    before = m[m.date <= cut]              # games up to and including the first changed day were rated before any changed result could count
    for h in V.HALF_LIVES:
        assert np.allclose(before[f"srs{h}_home_a"], before[f"srs{h}_home_b"]), f"srs{h} moved before the changed games were played"
        assert np.allclose(before[f"srs{h}_away_a"], before[f"srs{h}_away_b"])
    after = m[m.date > cut + pd.Timedelta(days=5)]
    assert not np.allclose(after["srs60_home_a"], after["srs60_home_b"]), "the later ratings must react to the changed results (otherwise this test proves nothing)"


def test_ratings_order_teams_by_strength_and_find_home_court():
    t = league(n_days=200)
    srs, models = V.srs_table(t)
    final = V.current_ratings(models, t.date.max() + pd.Timedelta(days=1))[120]
    ratings, hca = final
    order = sorted(ratings, key=ratings.get, reverse=True)
    assert order == [1, 2, 3, 4, 5], order
    assert 0.5 < hca < 4.0, hca            # the league was built with 2 points of home court
    assert ratings[1] - ratings[5] > 10


def test_a_common_opponent_chain_favours_the_team_with_the_better_result():
    d = pd.Timestamp
    games = [(d("2026-10-20"), "ATL", "LAL", True), (d("2026-10-22"), "MEM", "LAL", False)]
    rows = []
    for date, team, opp, won in games:
        rows += [{"team": team, "opp": opp, "date": date, "won": won}, {"team": opp, "opp": team, "date": date, "won": not won}]
    pairs = pd.DataFrame([{"GAME_ID": 1, "date": d("2026-11-01"), "home_id": "ATL", "away_id": "MEM"}, {"GAME_ID": 2, "date": d("2026-10-21"), "home_id": "ATL", "away_id": "MEM"}])
    out = V.common_opponent(pd.DataFrame(rows), pairs).set_index("GAME_ID")
    assert out.loc[1, "co_diff"] == 1.0 and out.loc[1, "co_n"] == 1
    assert out.loc[2, "co_n"] == 0, "on 10-21 only the ATL game had happened, so there was no common opponent yet"


def test_game_score_matches_the_published_formula():
    p = pd.DataFrame([{"PTS": 20, "FGM": 8, "FGA": 16, "FTA": 4, "FTM": 3, "OREB": 2, "DREB": 6, "STL": 1, "AST": 5, "BLK": 1, "PF": 2, "TOV": 3}])
    expect = 20 + 0.4 * 8 - 0.7 * 16 - 0.4 * (4 - 3) + 0.7 * 2 + 0.3 * 6 + 1 + 0.7 * 5 + 0.7 * 1 - 0.4 * 2 - 3
    assert abs(float(V.game_score(p).iloc[0]) - expect) < 1e-9


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
