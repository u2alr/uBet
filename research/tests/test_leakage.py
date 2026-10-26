"""Leakage tests for research/features.py. Run:  ingest/.venv/Scripts/python research/tests/test_leakage.py

1. FUTURE DELETION: rebuild features from data truncated at a cutoff date. Every feature of every row on or
   before the cutoff must be identical to the full build. If any feature peeked at later games, it changes.
2. SELF/SAME-DAY CORRUPTION: scramble the box-score results of every game on one date, rebuild, and check
   that features of all rows on or before that date are unchanged. If a feature used the row's own result
   (or a same-day result), it changes.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from features import FEATURES, build, load_raw  # noqa: E402

KEY = ["PLAYER_ID", "GAME_ID"]


def compare(full: pd.DataFrame, other: pd.DataFrame, upto: pd.Timestamp, label: str) -> int:
    a = full[full.date <= upto].set_index(KEY).sort_index()
    b = other[other.date <= upto].set_index(KEY).sort_index()
    assert a.index.equals(b.index), f"{label}: row sets differ ({len(a)} vs {len(b)})"
    bad = 0
    for col in FEATURES:
        x, y = a[col].to_numpy(float), b[col].to_numpy(float)
        same = np.isclose(x, y, equal_nan=True, rtol=1e-9, atol=1e-9)
        if not same.all():
            bad += 1
            print(f"  LEAK in {label}: feature {col!r} differs in {(~same).sum()} rows")
    print(f"{label}: {len(a):,} rows, {len(FEATURES)} features, {bad} features changed")
    return bad


def pick_dates(players: pd.DataFrame) -> tuple[list[str], list[str], str]:
    """Cutoffs and corruption days chosen from the data itself (so the same test runs on real data and on the generated CI fixture):
    two cutoffs at 45% and 80% of the game days, three corruption days at 25%, 55% and 85%, and one control day at 55%."""
    days = sorted(pd.to_datetime(players.GAME_DATE).dt.strftime("%Y-%m-%d").unique())
    at = lambda q: days[int(len(days) * q)]  # noqa: E731
    return [at(0.45), at(0.80)], [at(0.25), at(0.55), at(0.85)], at(0.55)


def main():
    players, teams = load_raw()
    full = build(players, teams)
    failures = 0
    cutoffs, corrupt_days, control_day = pick_dates(players)

    for cutoff in cutoffs:
        c = pd.Timestamp(cutoff)
        pl = players[pd.to_datetime(players.GAME_DATE) <= c]
        tm = teams[pd.to_datetime(teams.GAME_DATE) <= c]
        failures += compare(full, build(pl, tm), c, f"future-deletion @ {cutoff}")

    rng = np.random.default_rng(0)
    dates = pd.to_datetime(players.GAME_DATE)
    for day in corrupt_days:
        d = pd.Timestamp(day)
        corrupt = players.copy()
        mask = ((dates == d) & (players.MIN > 0)).to_numpy()
        assert mask.sum() > 0, f"no games on {day}"
        for col in ["PTS", "REB", "AST", "FG3M", "MIN", "FGA", "FTA", "TOV", "OREB"]:
            corrupt.loc[mask, col] = rng.integers(40, 90, size=mask.sum())
        t_corrupt = teams.copy()
        tmask = (pd.to_datetime(teams.GAME_DATE) == d).to_numpy()
        for col in ["PTS", "FGA", "FTA", "TOV", "OREB"]:
            t_corrupt.loc[tmask, col] = rng.integers(40, 130, size=tmask.sum())
        failures += compare(full, build(corrupt, t_corrupt), d, f"self/same-day corruption @ {day}")

    # Sanity check that the test itself can fail: features of LATER rows must change when we corrupt a day.
    d = pd.Timestamp(control_day)
    corrupt = players.copy()
    mask = ((dates == d) & (players.MIN > 0)).to_numpy()
    corrupt.loc[mask, "PTS"] = 80
    later = build(corrupt, teams)
    a = full[full.date > d].set_index(KEY).sort_index()["pts_l5"].to_numpy(float)
    b = later[later.date > d].set_index(KEY).sort_index()["pts_l5"].to_numpy(float)
    changed = (~np.isclose(a, b, equal_nan=True)).sum()
    print(f"control: corrupting one day changes pts_l5 in {changed:,} later rows (must be > 0)")
    assert changed > 0, "control failed: the test cannot detect changes"

    print("\nPASS: no leakage detected" if failures == 0 else f"\nFAIL: {failures} leaking feature checks")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
