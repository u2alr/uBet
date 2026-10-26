"""Context features must use only earlier games (same two checks as test_leakage.py), have the documented meaning on a hand-made case, and not need any external data.

    python research/tests/test_context_features.py
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

tmp = Path(tempfile.mkdtemp(prefix="ubet_ctx_"))
fixture_data.make(tmp)
os.environ.setdefault("UBET_RESEARCH_DATA", str(tmp))

import context_features as C  # noqa: E402
import features  # noqa: E402
import test_leakage as tl  # noqa: E402


def full_build(players, teams):
    return C.add_context(features.build(players, teams), teams)


def test_haversine_and_city_table():
    assert abs(C.haversine_miles(C.CITY["BOS"], C.CITY["LAL"]) - 2600) < 80          # Boston to Los Angeles, about 2,600 miles
    assert C.haversine_miles(C.CITY["BOS"], C.CITY["BOS"]) == 0
    assert len(C.CITY) == 30 and all(v[2] in (-5, -6, -7, -8) for v in C.CITY.values())


def test_game_city_is_the_home_teams():
    assert C._game_city("BOS vs. PHI", "BOS") == "BOS" and C._game_city("PHI @ BOS", "PHI") == "BOS" and C._game_city("garbage", "BOS") is None


def test_no_context_feature_uses_the_game_it_describes_or_later_games():
    players, teams = features.load_raw()
    full = full_build(players, teams)
    cutoffs, corrupt_days, _ = tl.pick_dates(players)
    bad = 0
    c = pd.Timestamp(cutoffs[0])
    cut = full_build(players[pd.to_datetime(players.GAME_DATE) <= c], teams[pd.to_datetime(teams.GAME_DATE) <= c])
    a = full[full.date <= c].set_index(tl.KEY).sort_index()
    b = cut[cut.date <= c].set_index(tl.KEY).sort_index()
    assert a.index.equals(b.index)
    for col in C.ALL:
        same = np.isclose(a[col].to_numpy(float), b[col].to_numpy(float), equal_nan=True, rtol=1e-9, atol=1e-9)
        if not same.all():
            bad += 1
            print(f"  LEAK (future deletion) in {col}: {(~same).sum()} rows")
    d = pd.Timestamp(corrupt_days[1])
    rng = np.random.default_rng(0)
    corrupt, tcor = players.copy(), teams.copy()
    mask = ((pd.to_datetime(players.GAME_DATE) == d) & (players.MIN > 0)).to_numpy()
    for col in ["PTS", "REB", "AST", "FG3M", "MIN"]:
        corrupt.loc[mask, col] = rng.integers(40, 90, size=mask.sum())
    tmask = (pd.to_datetime(teams.GAME_DATE) == d).to_numpy()
    tcor.loc[tmask, "PLUS_MINUS"] = rng.integers(-40, 40, size=tmask.sum())
    tcor.loc[tmask, "MIN"] = 265
    cor = full_build(corrupt, tcor)
    a2 = full[full.date <= d].set_index(tl.KEY).sort_index()
    b2 = cor[cor.date <= d].set_index(tl.KEY).sort_index()
    for col in C.ALL:
        same = np.isclose(a2[col].to_numpy(float), b2[col].to_numpy(float), equal_nan=True, rtol=1e-9, atol=1e-9)
        if not same.all():
            bad += 1
            print(f"  LEAK (same-day corruption) in {col}: {(~same).sum()} rows")
    assert bad == 0, f"{bad} context features used the game itself or the future"


def test_coverage_is_reported_not_hidden():
    players, teams = features.load_raw()
    full = full_build(players, teams)
    cov = {c: float(full[c].notna().mean()) for c in C.ALL}
    assert all(0 < v <= 1 for v in cov.values()), cov
    assert cov["ctx_g7"] < 1, "a player's first game has no history, so the feature is missing there rather than zero"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
