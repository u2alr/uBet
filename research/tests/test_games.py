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


def test_serving_matches_training_when_the_report_is_right():
    """Parity: take a late-season game, treat it as NOT YET PLAYED, and supply the players who actually sat out as the injury report. The features must equal the historical ones."""
    players, teams = features.load_raw()
    pl, _ = TD.augment(players, teams)
    full = G.team_absences(pl).set_index(["GAME_ID", "TEAM_ID"])
    pl = pl.assign(date=pd.to_datetime(pl.GAME_DATE))
    checked = 0
    for (gid, team), row in full[full.ab_n > 0].iloc[-40:].iterrows():
        g = pl[pl.GAME_ID == gid].iloc[0]
        tg = pl[(pl.TEAM_ID == team)]
        before = sorted(tg[(tg.date < g.date) & (tg.SEASON_ID == g.SEASON_ID)].GAME_ID.unique())[-10:]
        recent = tg[tg.GAME_ID.isin(before)].groupby("PLAYER_ID").MIN.agg(["count", "mean"])
        rotation = set(recent[(recent["count"] >= 3) & (recent["mean"] >= 15)].index)
        played_now = set(tg[(tg.GAME_ID == gid) & (tg.MIN > 0)].PLAYER_ID)
        sat_out = rotation - played_now
        upcoming = pd.DataFrame([{"GAME_ID": gid, "TEAM_ID": team, "date": g.date}])
        history = pl[pl.date < g.date]      # serving happens after every played game and before the target, so nothing later exists
        served = G.team_absences(history, upcoming=upcoming, out_ids=set(sat_out)).set_index(["GAME_ID", "TEAM_ID"]).loc[(gid, team)]
        for c in ("ab_min", "ab_pts", "ab_n", "ab_top"):
            assert abs(served[c] - row[c]) < 1e-9, (gid, team, c, served[c], row[c])
        assert {int(i) for i in served.ab_ids.split(",") if i} == {int(x) for x in sat_out}
        checked += 1
    assert checked >= 10, "the fixture needs enough games with an absent rotation player"


def test_a_player_not_in_the_rotation_is_never_absent():
    players, teams = features.load_raw()
    pl, _ = TD.augment(players, teams)
    last = pl.sort_values("GAME_DATE").iloc[-1]
    upcoming = pd.DataFrame([{"GAME_ID": 999999999, "TEAM_ID": last.TEAM_ID, "date": pd.to_datetime(last.GAME_DATE) + pd.Timedelta(days=2)}])
    ghost = 123456789   # a player id that has never appeared
    out = G.team_absences(pl, upcoming=upcoming, out_ids={ghost}).set_index(["GAME_ID", "TEAM_ID"]).loc[(999999999, last.TEAM_ID)]
    assert out.ab_n == 0 and out.ab_min == 0, "a name the report lists but who is no part of the rotation changes nothing"


def test_cross_season_rotation_keeps_a_player_out_since_game_one_and_drops_one_who_moved():
    """AVAIL3: the rotation reaches back across the season boundary, but a player whose latest appearance was for another team is not a rotation player here."""
    A, B = 1, 2
    rows = []
    gid = 0

    def game(date, season, team, minutes_by_player):
        nonlocal gid
        gid += 1
        for pid, m in minutes_by_player.items():
            rows.append(dict(GAME_ID=gid, TEAM_ID=team, PLAYER_ID=pid, GAME_DATE=date, SEASON_ID=season, MIN=m, PTS=m / 2))
        return gid

    # last season: team A's rotation is players 10..14; team B's is 20..24 (ten games each, on separate days)
    for d in range(10):
        game(f"2026-03-{d + 1:02d}", 22025, A, {10: 30, 11: 28, 12: 26, 13: 24, 14: 20})
        game(f"2026-03-{d + 1:02d}", 22025, B, {20: 30, 21: 28, 22: 26, 23: 24, 24: 20})
    # new season: player 11 (was with A) now plays for B; player 10 is out from the first game (no appearances at all); A's first game is on Oct 25
    game("2026-10-24", 22026, B, {20: 30, 21: 28, 22: 26, 23: 24, 24: 20, 11: 22})   # player 11 appears for B
    players = pd.DataFrame(rows)
    upcoming = pd.DataFrame([{"GAME_ID": 900, "TEAM_ID": A, "date": pd.Timestamp("2026-10-26")}])
    out = G.team_absences(players, upcoming=upcoming, out_ids={10, 11}, cross_season=True).set_index(["GAME_ID", "TEAM_ID"]).loc[(900, A)]
    assert set(int(i) for i in out.ab_ids.split(",") if i) == {10}, "10 (out since game one) counts as absent; 11 (now plays for B) does not"
    within = G.team_absences(players, upcoming=upcoming, out_ids={10, 11}, cross_season=False).set_index(["GAME_ID", "TEAM_ID"]).loc[(900, A)]
    assert within.ab_n == 0, "the within-season definition cannot see either, which is the blind spot AVAIL3 fixes"


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
