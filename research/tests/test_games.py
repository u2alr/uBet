"""Game-winner features: Elo behaviour, shapes, and the leakage guarantee. Runs on generated data only.

    python research/tests/test_games.py
"""
import os
import sys
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import fixture_data  # noqa: E402

tmp = Path(tempfile.mkdtemp(prefix="ubet_games_"))
fixture_data.make(tmp)
os.environ.setdefault("UBET_RESEARCH_DATA", str(tmp))

import features  # noqa: E402
import game_features as G  # noqa: E402
import test_defense as TD  # noqa: E402

COLS = ["elo_diff"] + G.ALL


def build(players, teams):
    pl, tm = TD.augment(players, teams)
    miss = features.build(pl, tm)[["GAME_ID", "TEAM_ID", "miss_prev"]].drop_duplicates(["GAME_ID", "TEAM_ID"])
    return G.build_games(tm, miss)


def test_one_row_per_game_with_a_label_and_a_regular_flag():
    players, teams = features.load_raw()
    g = build(players, teams)
    assert g.GAME_ID.is_unique
    assert set(g.y.unique()) <= {0.0, 1.0}
    assert g.regular.all(), "the fixture holds regular-season games only"
    assert len(g) == teams.GAME_ID.nunique()


def test_elo_starts_equal_rewards_the_winner_and_reads_ratings_before_the_game():
    teams = TD.augment(*features.load_raw())[1]
    t = G._team_games(teams)
    e = G._elo(t)
    first = t[t.home == 1].sort_values(["date", "GAME_ID"]).iloc[0]
    row = e[e.GAME_ID == first.GAME_ID].iloc[0]
    assert (row.elo_home, row.elo_away) == (G.ELO_START, G.ELO_START), "the first game of a team is rated before it is played"
    # After a home win the home team's rating rose, so its NEXT pre-game rating is above the start.
    nxt = t[(t.TEAM_ID == first.TEAM_ID) & (t.GAME_ID != first.GAME_ID)].sort_values("date").iloc[0]
    later = e[e.GAME_ID == nxt.GAME_ID].iloc[0]
    mine = later.elo_home if nxt.home == 1 else later.elo_away
    assert (mine > G.ELO_START) == (first.PTS > first.opp_pts)


def test_elo_is_zero_sum_across_a_season():
    teams = TD.augment(*features.load_raw())[1]
    t = G._team_games(teams)
    _, rating, _ = G._elo(t, state=True)
    assert abs(sum(rating.values()) / len(rating) - G.ELO_START) < 1e-6 * G.ELO_START + 30, "ratings move between teams, they are not created"


def test_leakage_future_deletion_and_same_day_corruption():
    players, teams = features.load_raw()
    full = build(players, teams)
    dates = np.sort(teams.GAME_DATE.unique())

    def same(a, b, upto, label):
        x = a[a.date <= upto].set_index("GAME_ID")[COLS].sort_index()
        y = b[b.date <= upto].set_index("GAME_ID")[COLS].sort_index()
        both = x.index.intersection(y.index)
        bad = int((~np.isclose(x.loc[both].to_numpy(float), y.loc[both].to_numpy(float), rtol=1e-9, atol=1e-9, equal_nan=True)).any(axis=1).sum())
        print(f"  {label}: {len(both):,} games compared, {bad} differ")
        return bad

    bad = 0
    for frac in (0.45, 0.8):
        cut = pd.Timestamp(dates[int(len(dates) * frac)])
        bad += same(full, build(players[pd.to_datetime(players.GAME_DATE) <= cut], teams[pd.to_datetime(teams.GAME_DATE) <= cut]), cut, f"future deleted after {cut.date()}")
    for frac in (0.25, 0.55, 0.85):
        day = pd.Timestamp(dates[int(len(dates) * frac)])
        rng = np.random.default_rng(1)
        pl2, tm2 = players.copy(), teams.copy()
        pm = pd.to_datetime(pl2.GAME_DATE) == day
        for col in ("PTS", "REB", "AST", "FG3M", "OREB"):
            pl2.loc[pm, col] = rng.integers(40, 90, size=pm.sum())
        tmask = pd.to_datetime(tm2.GAME_DATE) == day
        for col in ("PTS", "FGA", "FTA", "TOV", "OREB"):
            tm2.loc[tmask, col] = rng.integers(40, 130, size=tmask.sum())
        bad += same(full, build(pl2, tm2), day, f"results of {day.date()} corrupted")
    # Control: the test can fail. Ratings after a corrupted day must move.
    day = pd.Timestamp(dates[int(len(dates) * 0.3)])
    tm3 = teams.copy()
    tm3.loc[pd.to_datetime(tm3.GAME_DATE) == day, "PTS"] = 200
    other = build(players, tm3)
    later = (full.date > day).to_numpy()
    moved = int((~np.isclose(full.loc[later, "elo_diff"].to_numpy(float), other.loc[later, "elo_diff"].to_numpy(float))).sum())
    print(f"  control: corrupting one day moves {moved:,} later Elo gaps (must be > 0)")
    assert moved > 0
    assert bad == 0, f"{bad} games changed when only the future or the same day was altered"


if __name__ == "__main__":
    fails = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print("PASS", name)
            except Exception as e:  # noqa: BLE001
                fails += 1
                import traceback
                traceback.print_exc()
                print("FAIL", name, e)
    sys.exit(1 if fails else 0)
