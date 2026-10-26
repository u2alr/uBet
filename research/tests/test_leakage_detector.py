"""A SEEDED leak must make the leakage test fail. Without this, a leakage test that quietly stopped detecting anything would stay green.

Two leaks are planted in a copy of the feature builder, on the generated fixture league (research/tests/fixture_data.py):
  1. self-leak: a rolling mean that includes the game being predicted (the classic missing shift(1));
  2. future-leak: a feature built from the NEXT game's result.
The checks are the same ones test_leakage.py applies to the real feature code. The real `build` must pass them; each leaky build must fail them.

    python research/tests/test_leakage_detector.py
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

tmp = Path(tempfile.mkdtemp(prefix="ubet_fixture_"))
fixture_data.make(tmp)
os.environ["UBET_RESEARCH_DATA"] = str(tmp)

import features  # noqa: E402
import test_leakage as tl  # noqa: E402

KEY = tl.KEY


def build_leaky_self(players, teams):
    """pts_l5 includes the current game: no shift."""
    df = features.build(players, teams)
    g = df.groupby("PLAYER_ID")
    df["pts_l5"] = g["pts"].transform(lambda x: x.rolling(5, min_periods=3).mean())
    return df


def build_leaky_future(players, teams):
    """pts_l10 is the player's NEXT game's points (a feature from the future)."""
    df = features.build(players, teams)
    g = df.groupby("PLAYER_ID")
    df["pts_l10"] = g["pts"].transform(lambda x: x.shift(-1))
    return df


def leak_count(builder) -> int:
    """Run the same two checks as test_leakage.py (future deletion and same-day corruption); return how many feature checks changed."""
    players, teams = features.load_raw()
    full = builder(players, teams)
    cutoffs, corrupt_days, _ = tl.pick_dates(players)
    bad = 0
    for cutoff in cutoffs[:1]:
        c = pd.Timestamp(cutoff)
        bad += tl.compare(full, builder(players[pd.to_datetime(players.GAME_DATE) <= c], teams[pd.to_datetime(teams.GAME_DATE) <= c]), c, f"future-deletion @ {cutoff}")
    rng = np.random.default_rng(0)
    d = pd.Timestamp(corrupt_days[1])
    dates = pd.to_datetime(players.GAME_DATE)
    corrupt = players.copy()
    mask = ((dates == d) & (players.MIN > 0)).to_numpy()
    for col in ["PTS", "REB", "AST", "FG3M", "MIN"]:
        corrupt.loc[mask, col] = rng.integers(40, 90, size=mask.sum())
    bad += tl.compare(full, builder(corrupt, teams), d, f"same-day corruption @ {corrupt_days[1]}")
    return bad


def test_the_real_feature_builder_has_no_leak_on_the_fixture():
    assert leak_count(features.build) == 0


def test_a_missing_shift_is_detected():
    assert leak_count(build_leaky_self) > 0, "the self-leak was NOT detected: the leakage test is blind"


def test_a_feature_from_the_future_is_detected():
    assert leak_count(build_leaky_future) > 0, "the future-leak was NOT detected: the leakage test is blind"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
