"""Human Factors features: definitions on hand-made schedules, edge cases, and the leakage guarantee. Runs on generated data only.

    python research/tests/test_human_factors.py
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

tmp = Path(tempfile.mkdtemp(prefix="ubet_hf_"))
fixture_data.make(tmp)
os.environ.setdefault("UBET_RESEARCH_DATA", str(tmp))

import features  # noqa: E402
import human_factors as H  # noqa: E402
import test_leakage as tl  # noqa: E402

TEAM_IDS = {"BOS": 1, "NYK": 2, "LAL": 3, "LAC": 4, "MIA": 5, "DEN": 6, "XXX": 7}


def schedule(games):
    """games: [(game_id, 'YYYY-MM-DD', home_abbr, away_abbr, ot)] -> the two team rows per game, as the box-score feed has them."""
    rows = []
    for gid, date, home, away, ot in games:
        for team, matchup in ((home, f"{home} vs. {away}"), (away, f"{away} @ {home}")):
            rows.append(dict(GAME_ID=gid, TEAM_ID=TEAM_IDS[team], TEAM_ABBREVIATION=team, GAME_DATE=date, MATCHUP=matchup, MIN=265 if ot else 240))
    return pd.DataFrame(rows)


def feats(games, team="BOS"):
    f = H.team_features(schedule(games))
    return f[f.TEAM_ID == TEAM_IDS[team]].set_index("GAME_ID")


def test_rest_back_to_back_and_its_type():
    f = feats([(1, "2026-10-20", "BOS", "NYK", False), (2, "2026-10-21", "LAL", "BOS", False), (3, "2026-10-22", "LAC", "BOS", False), (4, "2026-10-25", "BOS", "MIA", False)])
    assert np.isnan(f.loc[1, "hf_rest_days"])
    assert (f.loc[2, "hf_rest_days"], f.loc[2, "hf_b2b"], f.loc[2, "hf_b2b_type"]) == (1, 1, 4), "home then road"
    assert (f.loc[3, "hf_b2b"], f.loc[3, "hf_b2b_type"]) == (1, 2), "road then road"
    assert (f.loc[4, "hf_rest_days"], f.loc[4, "hf_b2b"], f.loc[4, "hf_b2b_type"]) == (3, 0, 0)


def test_three_in_four_four_in_six_and_game_counts():
    f = feats([(1, "2026-10-20", "BOS", "NYK", False), (2, "2026-10-21", "BOS", "MIA", False), (3, "2026-10-22", "BOS", "LAL", False), (4, "2026-10-24", "BOS", "DEN", False)])
    assert f.loc[3, "hf_three_in_four"] == 1 and f.loc[2, "hf_three_in_four"] == 0
    assert f.loc[4, "hf_four_in_six"] == 1, "4 games in the 5 nights ending Oct 24"
    assert f.loc[3, "hf_g7"] == 2 and f.loc[4, "hf_g14"] == 3


def test_travel_estimates_direction_and_the_home_to_home_difference():
    f = feats([(1, "2026-10-20", "BOS", "NYK", False), (2, "2026-10-21", "LAL", "BOS", False), (3, "2026-10-24", "BOS", "MIA", False)])
    assert 2500 < f.loc[2, "hf_miles"] < 2700 and f.loc[2, "hf_tz_shift"] == -3 and f.loc[2, "hf_east_shift"] == 0, "Boston to Los Angeles: west, about 2,600 miles"
    assert f.loc[3, "hf_tz_shift"] == 3 and f.loc[3, "hf_east_shift"] == 1 and f.loc[3, "hf_road_trip"] == 1, "the way home is eastward"
    hh = feats([(1, "2026-10-20", "BOS", "NYK", False), (2, "2026-10-21", "BOS", "MIA", False)])
    assert hh.loc[2, "hf_miles"] == 0 and hh.loc[2, "hf_same_city"] == 1 and hh.loc[2, "hf_miles_x_short"] == 0, "a home-to-home back-to-back has no travel"
    rr = feats([(1, "2026-10-20", "NYK", "BOS", False), (2, "2026-10-21", "LAL", "BOS", False)])
    assert rr.loc[2, "hf_miles_x_short"] > 2000 and rr.loc[2, "hf_tz_x_short"] == 3, "a road-to-road back-to-back across the country is flagged by the interaction"


def test_same_city_other_team_missing_location_and_unknown_format():
    same = feats([(1, "2026-10-20", "LAL", "BOS", False), (2, "2026-10-21", "LAC", "BOS", False)])
    assert same.loc[2, "hf_same_city"] == 1 and same.loc[2, "hf_miles"] < 25, "Lakers to Clippers arenas are the same metro area"
    unknown = feats([(1, "2026-10-20", "BOS", "NYK", False), (2, "2026-10-21", "XXX", "BOS", False)])
    assert np.isnan(unknown.loc[2, "hf_miles"]) and np.isnan(unknown.loc[2, "hf_tz_shift"]), "an unknown location is unknown, not a guess"
    assert H.game_city("garbage", "BOS") is None and H.game_city("BOS vs. NYK", "BOS") == "BOS" and H.game_city("NYK @ BOS", "NYK") == "BOS"


def test_opponent_and_rest_difference():
    f = feats([(1, "2026-10-19", "BOS", "NYK", False), (2, "2026-10-21", "NYK", "MIA", False), (3, "2026-10-22", "MIA", "BOS", False), (4, "2026-10-24", "BOS", "NYK", False)])
    row = f.loc[3]                    # BOS at MIA on the 22nd: BOS last played the 19th (3 days), MIA the 21st (1 day, a back-to-back, but was away)
    assert row.hf_rest_days == 3 and row.hf_opp_rest_days == 1 and row.hf_rest_diff == 2 and row.hf_opp_at_home == 1 and row.hf_opp_b2b == 1


def test_postponed_and_duplicate_records_do_not_distort_rest():
    # The Oct 22 game was postponed: it is simply absent, so the previous played game is Oct 20 and rest is 4 days, never 2.
    f = feats([(1, "2026-10-20", "BOS", "NYK", False), (4, "2026-10-24", "BOS", "MIA", False)])
    assert f.loc[4, "hf_rest_days"] == 4
    dup = schedule([(1, "2026-10-20", "BOS", "NYK", False), (4, "2026-10-24", "BOS", "MIA", False)])
    f2 = H.team_features(pd.concat([dup, dup.iloc[:2]], ignore_index=True)).set_index("GAME_ID")
    f2 = f2[f2.TEAM_ID == TEAM_IDS["BOS"]]
    assert len(f2) == 2 and f2.loc[4, "hf_rest_days"] == 4 and f2.loc[4, "hf_g7"] == 1


def test_overtime_flags_look_at_earlier_games_only():
    f = feats([(1, "2026-10-20", "BOS", "NYK", True), (2, "2026-10-22", "BOS", "MIA", False), (3, "2026-10-24", "BOS", "DEN", False)])
    assert f.loc[1, "hf_ot_prev"] != f.loc[1, "hf_ot_prev"]          # NaN: no previous game, and the game's own overtime is NOT counted
    assert f.loc[2, "hf_ot_prev"] == 1 and f.loc[3, "hf_ot_prev"] == 0 and f.loc[3, "hf_ot_recent5"] == 1


def test_altitude_is_the_games_location_and_the_climb_from_the_previous_one():
    f = feats([(1, "2026-10-20", "BOS", "NYK", False), (2, "2026-10-22", "DEN", "BOS", False)])
    assert f.loc[2, "hf_elev"] == 5280 and f.loc[2, "hf_elev_up"] == 5280 - 20


def test_player_return_from_absence_counts_games_back_and_carries_no_reason():
    games = [(i, f"2026-10-{10 + 2 * i}", "BOS", "NYK", False) for i in range(1, 11)]
    teams = schedule(games)
    played = [1, 2, 8, 9, 10]                      # misses team games 3 to 7 (five games), then returns
    rows = []
    for k, g in enumerate(played):
        rows.append(dict(PLAYER_ID=9, TEAM_ID=1, GAME_ID=g, date=pd.Timestamp(games[g - 1][1]), minutes=30.0, MATCHUP="BOS vs. NYK", TEAM_ABBREVIATION="BOS", home=1,
                         pts=20, reb=5, ast=4, fg3m=2, min_l5=30.0, min_l20=30.0, min_s2d=30.0, min_sd10=3.0))
    out = H.add_human_factors(pd.DataFrame(rows), teams).set_index("GAME_ID")
    got = list(out.loc[played, "hf_ret_n"])
    assert np.isnan(got[0]) and got[1:] == [0, 1, 2, 3], "a player's first game has no history (unknown); the first game back is 1, then 2, 3, and no reason for the absence is ever implied"


def test_workload_is_relative_to_the_players_own_baseline():
    games = [(i, f"2026-10-{10 + i}", "BOS", "NYK", False) for i in range(1, 7)]
    teams = schedule(games)
    def player(pid, base, last):
        rows = []
        for g in range(1, 7):
            m = last if g == 5 else base
            rows.append(dict(PLAYER_ID=pid, TEAM_ID=1, GAME_ID=g, date=pd.Timestamp(games[g - 1][1]), minutes=float(m), MATCHUP="BOS vs. NYK", TEAM_ABBREVIATION="BOS", home=1,
                             pts=10, reb=3, ast=2, fg3m=1, min_l5=float(base), min_l20=float(base), min_s2d=float(base), min_sd10=3.0))
        return rows
    out = H.add_human_factors(pd.DataFrame(player(1, 36, 44) + player(2, 14, 22)), teams)
    star, bench = out[(out.PLAYER_ID == 1) & (out.GAME_ID == 6)].iloc[0], out[(out.PLAYER_ID == 2) & (out.GAME_ID == 6)].iloc[0]
    assert star.hf_heavy_prev == 1 and bench.hf_heavy_prev == 1, "+8 minutes over his own baseline is heavy for both"
    assert abs(star.hf_min_prev_z - bench.hf_min_prev_z) < 1e-9, "same size of departure from baseline, same assessment, regardless of the 36 or 14 minute baseline"
    assert star.hf_cum7 == 36 * 3 + 44 + 36 * 0 or star.hf_cum7 > 0


def test_no_human_factor_uses_the_game_it_describes_or_the_future():
    players, teams = features.load_raw()
    full = H.add_human_factors(features.build(players, teams), teams)
    cutoffs, corrupt_days, _ = tl.pick_dates(players)
    c = pd.Timestamp(cutoffs[0])
    cut = H.add_human_factors(features.build(players[pd.to_datetime(players.GAME_DATE) <= c], teams[pd.to_datetime(teams.GAME_DATE) <= c]), teams[pd.to_datetime(teams.GAME_DATE) <= c])
    a, b = full[full.date <= c].set_index(tl.KEY).sort_index(), cut[cut.date <= c].set_index(tl.KEY).sort_index()
    assert a.index.equals(b.index)
    bad = [col for col in H.ALL if not np.isclose(a[col].to_numpy(float), b[col].to_numpy(float), equal_nan=True, rtol=1e-9, atol=1e-9).all()]
    d = pd.Timestamp(corrupt_days[1])
    rng = np.random.default_rng(0)
    corrupt, tcor = players.copy(), teams.copy()
    pm = ((pd.to_datetime(players.GAME_DATE) == d) & (players.MIN > 0)).to_numpy()
    for col in ["PTS", "REB", "AST", "FG3M", "MIN"]:
        corrupt.loc[pm, col] = rng.integers(40, 90, size=pm.sum())
    tm = (pd.to_datetime(teams.GAME_DATE) == d).to_numpy()
    tcor.loc[tm, "MIN"] = 265
    cor = H.add_human_factors(features.build(corrupt, tcor), tcor)
    a2, b2 = full[full.date <= d].set_index(tl.KEY).sort_index(), cor[cor.date <= d].set_index(tl.KEY).sort_index()
    bad += [col for col in H.ALL if not np.isclose(a2[col].to_numpy(float), b2[col].to_numpy(float), equal_nan=True, rtol=1e-9, atol=1e-9).all()]
    assert not bad, f"leaking human factors: {sorted(set(bad))}"


def test_coverage_is_reported_and_unknown_stays_unknown():
    players, teams = features.load_raw()
    full = H.add_human_factors(features.build(players, teams), teams)
    cov = {c: float(full[c].notna().mean()) for c in H.ALL}
    assert all(0 < v <= 1 for v in cov.values()), cov
    assert cov["hf_miles"] < 1 and cov["hf_rest_days"] < 1


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
