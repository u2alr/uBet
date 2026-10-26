"""project.py must not change any model feature unless the experimental flag is passed (see research/INJURY_FEATURES.md)."""
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
try:
    import project as P
except ImportError:  # nba_api not installed: skip cleanly
    P = None


def frame():
    return pd.DataFrame({
        "PLAYER_ID": [1, 2, 3], "PLAYER_NAME": ["Star Player", "Role Player", "Other Guy"], "TEAM_ID": [10, 10, 10],
        "GAME_ID": [P.DUMMY_BASE if P else 9, P.DUMMY_BASE if P else 9, P.DUMMY_BASE if P else 9],
        "min_l10": [34.0, 22.0, 18.0], "miss_prev": [0.0, 0.0, 0.0], "miss_prev2": [0.0, 0.0, 0.0],
    })


def test_listed_out_players_are_dropped_and_no_feature_changes():
    if P is None:
        return
    df = frame()
    out = P.drop_out_players(df.copy(), {P.norm_name("Star Player")})
    assert list(out.PLAYER_ID) == [2, 3]
    assert (out.miss_prev == 0).all() and (out.miss_prev2 == 0).all(), "the default path must not touch the missing-teammate features"


def test_the_experimental_override_is_the_only_path_that_changes_features():
    if P is None:
        return
    out = P.apply_injury_news(frame(), {P.norm_name("Star Player")})
    assert (out.miss_prev == 34.0).all(), "documented behaviour of the opt-in flag"


def test_the_flag_is_off_by_default():
    if P is None:
        return
    src = Path(P.__file__).read_text(encoding="utf-8")
    assert '"--injury-features", action="store_true"' in src
    assert "if args.injury_features:" in src


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
