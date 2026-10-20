"""Tests for calibration_report.py on picks whose true quality is known by construction.

    ingest/.venv/Scripts/python research/tests/test_calibration_report.py
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import calibration_report as cr  # noqa: E402


def make(n, truth_of, shown_of, seed=0):
    """n picks. `truth_of(p)` is the real chance that a pick shown at probability p wins."""
    rng = np.random.default_rng(seed)
    p = rng.uniform(0.35, 0.75, n)
    win = rng.random(n) < truth_of(p)
    price = np.round(1 / np.clip(shown_of(p) - 0.03, 0.05, 0.95), 2)
    dates = pd.to_datetime("2026-11-01") + pd.to_timedelta(rng.integers(0, 40, n), unit="D")
    return pd.DataFrame({
        "side": "over", "price": price, "p_over": shown_of(p), "model_prob": p, "market_prob": shown_of(p), "push": 0.0,
        "hit": np.where(win, 1, 0), "model": "gbm-v1", "game_date": dates.strftime("%Y-%m-%d"),
        "legacy": False, "stat": "pts", "line": 20.5, "player_id": 1, "actual": 20.0,
    })


def test_calibrated_picks_look_calibrated():
    g = cr.prepare(make(4000, truth_of=lambda p: p, shown_of=lambda p: p))
    r = cr.report(g)
    assert abs(r["win_rate"] - r["mean_predicted"]) < 0.02
    for b in r["calibration"]:
        assert abs(b["predicted"] - b["observed"]) < 0.08, b
    print(f"PASS calibrated: win rate {r['win_rate']:.3f} vs predicted {r['mean_predicted']:.3f}")


def test_overconfident_picks_are_exposed():
    # the app shows 0.35-0.75 but the truth is pulled halfway to 50%: classic overconfidence
    g = cr.prepare(make(6000, truth_of=lambda p: 0.5 + 0.5 * (p - 0.5), shown_of=lambda p: p))
    r = cr.report(g)
    top = max(r["calibration"], key=lambda b: b["predicted"])
    bottom = min(r["calibration"], key=lambda b: b["predicted"])
    assert top["predicted"] - top["observed"] > 0.03 and bottom["observed"] - bottom["predicted"] > 0.03
    print(f"PASS overconfidence exposed: top bin shown {top['predicted']:.2f}, actually {top['observed']:.2f}")


def test_refunds_are_excluded_from_calibration_but_not_profit():
    df = make(400, truth_of=lambda p: p, shown_of=lambda p: p)
    df.loc[:49, "hit"] = 2
    g = cr.prepare(df)
    r = cr.report(g)
    assert r["pushes"] == 50 and r["n_decided"] == 350
    assert (g[g.hit == 2].profit == 0).all()
    print("PASS refunds: excluded from calibration, zero profit")


def test_refuses_to_conclude_from_a_small_sample():
    g = cr.prepare(make(120, truth_of=lambda p: p, shown_of=lambda p: p))
    assert not cr.enough(g)
    one_day = make(2000, truth_of=lambda p: p, shown_of=lambda p: p)
    one_day["game_date"] = "2026-11-02"
    assert not cr.enough(cr.prepare(one_day)), "many picks on one date are not enough"
    assert cr.enough(cr.prepare(make(2000, truth_of=lambda p: p, shown_of=lambda p: p)))
    print("PASS guard: needs both enough picks and enough different game dates")


def test_profit_arithmetic():
    df = make(10, truth_of=lambda p: p, shown_of=lambda p: p)
    df["price"] = 2.0
    df["hit"] = [1] * 6 + [0] * 3 + [2]
    g = cr.prepare(df)
    assert abs(g.profit.sum() - (6 * 1.0 - 3 * 1.0)) < 1e-9
    print("PASS profit: wins pay price-1, losses cost 1, refunds 0")


if __name__ == "__main__":
    test_calibrated_picks_look_calibrated()
    test_overconfident_picks_are_exposed()
    test_refunds_are_excluded_from_calibration_but_not_profit()
    test_refuses_to_conclude_from_a_small_sample()
    test_profit_arithmetic()
    print("\nALL PASS")
