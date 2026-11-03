"""shadow_report.py must score each model on the newest prediction made BEFORE tip-off, join it to the right result, and never let a shadow touch the shipped number."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import shadow_report as S  # noqa: E402


def log(rows) -> pd.DataFrame:
    return pd.DataFrame(rows, columns=["date", "home", "away", "as_of", "model_home_prob", "model_v1_prob", "shadow_prob", "shadow2_prob", "market_home_prob"])


results = pd.DataFrame([{"date": "2026-11-05", "home": "DET", "away": "PHI", "home_won": 1}, {"date": "2026-11-05", "home": "BOS", "away": "MIL", "home_won": 0}])


def test_the_newest_prediction_made_before_the_game_is_the_one_scored():
    rows = log([
        ("2026-11-05", "DET", "PHI", "2026-11-04 09:00", 0.60, 0.55, 0.62, 0.65, 0.58),
        ("2026-11-05", "DET", "PHI", "2026-11-05 07:00", 0.70, 0.55, 0.72, 0.75, 0.58),     # newer, still before the game: this one
        ("2026-11-05", "DET", "PHI", "2026-11-06 01:00", 0.99, 0.99, 0.99, 0.99, 0.99),     # made after the game date: never used
    ])
    pick = S.latest_before_tipoff(rows)
    assert len(pick) == 1 and pick.model_home_prob.iloc[0] == 0.70


def test_log_loss_is_the_models_own_and_a_shadow_is_compared_with_the_shipped_number_on_the_same_games():
    rows = log([("2026-11-05", "DET", "PHI", "2026-11-05 07:00", 0.70, 0.60, 0.80, np.nan, 0.65), ("2026-11-05", "BOS", "MIL", "2026-11-05 07:00", 0.70, 0.60, 0.80, np.nan, 0.65)])
    r = S.score(rows, results)
    assert r["games"] == 2
    shipped = -(np.log(0.7) + np.log(0.3)) / 2                      # won one at 70%, lost one at 70%
    assert abs(r["models"]["model_home_prob"]["logloss"] - shipped) < 1e-9
    shadow = -(np.log(0.8) + np.log(0.2)) / 2
    assert abs(r["models"]["shadow_prob"]["dlogloss_vs_v2"] - (shipped - shadow)) < 1e-9
    assert "shadow2_prob" not in r["models"], "a model with no stored numbers is left out, not scored as zero"


def test_a_game_with_no_result_yet_is_not_scored_and_an_empty_record_does_not_fail():
    rows = log([("2026-11-09", "DET", "PHI", "2026-11-09 07:00", 0.7, 0.6, 0.8, 0.8, 0.65)])
    assert S.score(rows, results)["games"] == 0
    assert S.score(rows.iloc[0:0], results)["games"] == 0


def test_results_are_read_from_the_home_teams_side_of_the_box_score():
    teams = pd.DataFrame([
        {"GAME_ID": 1, "TEAM_ID": 10, "GAME_DATE": "2026-11-05", "TEAM_ABBREVIATION": "DET", "MATCHUP": "DET vs. PHI", "WL": "W"},
        {"GAME_ID": 1, "TEAM_ID": 11, "GAME_DATE": "2026-11-05", "TEAM_ABBREVIATION": "PHI", "MATCHUP": "PHI @ DET", "WL": "L"},
    ])
    r = S.home_results(teams)
    assert r.iloc[0].to_dict() == {"date": "2026-11-05", "home": "DET", "away": "PHI", "home_won": 1}


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
