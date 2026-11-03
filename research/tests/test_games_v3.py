"""game-winner model v3 candidate features (PREREG_GAMES_V3.md): the roster delta and the roster continuity must look only backwards, and must do what they say."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import game_features_v3 as V3  # noqa: E402


def box(rows) -> pd.DataFrame:
    return pd.DataFrame(rows, columns=["PLAYER_ID", "TEAM_ID", "GAME_ID", "GAME_DATE", "MIN", "GS", "SEASON_ID"])


def league(star_games, n=36, other_team_games=None):
    """Team 1: a star (id 99, 30 min, game score 22) who plays only `star_games`, plus five steady players (game score 8). Team 2 just exists."""
    rows = []
    for i in range(1, n + 1):
        d = (pd.Timestamp("2026-10-20") + pd.Timedelta(days=i)).strftime("%Y-%m-%d")
        for pid in (1, 2, 3, 4, 5):
            rows.append((pid, 1, 1000 + i, d, 28.0, 8.0, 22026))
        if i in star_games:
            rows.append((99, 1, 1000 + i, d, 30.0, 22.0, 22026))
        for pid in (11, 12, 13, 14, 15):
            rows.append((pid, 2, 1000 + i, d, 28.0, 8.0, 22026))
    return box(rows)


def rd_of(df, team=1) -> pd.Series:
    out = V3.roster_delta(df)
    return out[out.TEAM_ID == team].set_index("GAME_ID").rd


def test_a_returning_star_is_positive_and_a_missing_regular_is_negative():
    games = set(range(1, 21)) | set(range(30, 53))                # plays 1-20, misses 21-29, back from game 30
    rd = rd_of(league(games, n=52))
    assert rd[1030] > 5, rd[1030]                                  # back after nine missed games: today's roster is stronger than the recent results suggest
    assert rd[1025] < -5, rd[1025]                                 # out today but played most of the recent window: the results still include him
    assert abs(rd[1015]) < 1e-9                                    # playing as always
    assert 5 < rd[1036] < rd[1030] + 1e-9                          # six games later he has still missed 9 of the last 20, so the results still undersell him
    assert abs(rd[1050]) < 1e-9, rd[1050]                          # twenty games on, the window is all games he played: the results now include him


def test_a_star_out_for_the_whole_window_is_already_in_the_results():
    games = set(range(1, 8))                                       # last played in game 7, out since: by game 33 the window holds no star games
    rd = rd_of(league(games))
    assert abs(rd[1033]) < 1e-9, rd[1033]


def test_it_never_looks_forward_and_never_reads_the_games_own_stats():
    games = set(range(1, 21)) | {30}
    base = rd_of(league(games))
    # rewrite the future (games after 25): nothing earlier may move
    late = league(games)
    late.loc[late.GAME_ID > 1025, "GS"] += 50
    late.loc[late.GAME_ID > 1025, "MIN"] = 5.0
    changed = rd_of(late)
    for gid in range(1001, 1026):
        assert abs(base[gid] - changed[gid]) < 1e-9, gid
    # the star's performance in the game being predicted is not an input: only whether he played
    boosted = league(games)
    boosted.loc[(boosted.PLAYER_ID == 99) & (boosted.GAME_ID == 1030), "GS"] = 500.0
    assert abs(rd_of(boosted)[1030] - base[1030]) < 1e-9


def test_a_player_who_left_for_another_team_is_not_counted_as_absent():
    df = league(set(range(1, 21)))
    moved = df[(df.PLAYER_ID == 99) & (df.GAME_ID > 1020)]
    assert moved.empty
    # after game 20 he plays for team 2 instead
    extra = box([(99, 2, 1000 + i, (pd.Timestamp("2026-10-20") + pd.Timedelta(days=i)).strftime("%Y-%m-%d"), 30.0, 22.0, 22026) for i in range(21, 37)])
    rd = rd_of(pd.concat([df, extra], ignore_index=True), team=1)
    assert abs(rd[1025]) < 1e-9, rd[1025]                          # he is gone, not out
    assert abs(rd_of(df)[1025]) > 5                                # whereas if he had not played elsewhere he would count as missing


def test_for_a_game_not_yet_played_a_player_who_left_is_not_assumed_to_play_and_a_listed_player_is_not_either():
    # star 99 plays for team 1 in games 1-20, then for team 2: for team 1's NEXT game he must not be counted as "back".
    df = league(set(range(1, 21)), n=36)
    extra = box([(99, 2, 1000 + i, (pd.Timestamp("2026-10-20") + pd.Timedelta(days=i)).strftime("%Y-%m-%d"), 30.0, 22.0, 22026) for i in range(21, 37)])
    both = pd.concat([df, extra], ignore_index=True)
    up = pd.DataFrame([{"GAME_ID": 9001, "TEAM_ID": 1, "date": pd.Timestamp("2026-11-30")}])
    rd = V3.roster_delta(both, upcoming=up, out_ids=set()).set_index(["GAME_ID", "TEAM_ID"]).rd
    assert abs(rd[(9001, 1)]) < 1e-9, rd[(9001, 1)]
    # a star who played for team 1 right up to now is not "returning" (he plays, as always), and listing him Out is a large negative
    steady = league(set(range(1, 37)), n=36)
    up2 = pd.DataFrame([{"GAME_ID": 9002, "TEAM_ID": 1, "date": pd.Timestamp("2026-11-30")}])
    assert abs(V3.roster_delta(steady, upcoming=up2, out_ids=set()).set_index(["GAME_ID", "TEAM_ID"]).rd[(9002, 1)]) < 1e-9
    assert V3.roster_delta(steady, upcoming=up2, out_ids={99}).set_index(["GAME_ID", "TEAM_ID"]).rd[(9002, 1)] < -15


def test_continuity_is_the_share_of_current_minutes_from_last_seasons_players():
    rows = []
    for i in range(1, 31):                                         # last season: players 1-5 give team 1 their minutes
        d = (pd.Timestamp("2025-11-01") + pd.Timedelta(days=i)).strftime("%Y-%m-%d")
        rows += [(pid, 1, 500 + i, d, 30.0, 8.0, 22025) for pid in (1, 2, 3, 4, 5)]
    for i in range(1, 12):                                         # this season: players 1, 2, 3 return, 6 and 7 are new
        d = (pd.Timestamp("2026-10-20") + pd.Timedelta(days=i)).strftime("%Y-%m-%d")
        rows += [(pid, 1, 1000 + i, d, 30.0, 8.0, 22026) for pid in (1, 2, 3, 6, 7)]
    c = V3.continuity(box(rows))
    c = c[c.TEAM_ID == 1].set_index("GAME_ID")
    assert np.isnan(c.loc[1001, "cont"]) and c.loc[1001, "n_prior"] == 0       # nothing known before the first game
    assert abs(c.loc[1005, "cont"] - 0.6) < 1e-9                                # 3 of the 5 rotation players were here last season
    assert c.loc[1005, "n_prior"] == 4
    assert V3.early_weight([0, 25, 50]).tolist() == [1.0, 0.0, 0.0]


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
