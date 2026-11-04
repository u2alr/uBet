"""market_games_report.py: only priced games count, the blend is what the site shows, and no verdict is given before the pre-registered minimum."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import market_games_report as M  # noqa: E402


def make(n, informative: bool, seed=1):
    """n games on n/2 days. The market is calibrated; the model either knows more (informative) or is pure noise around 50%."""
    rng = np.random.default_rng(seed)
    truth = rng.uniform(0.25, 0.75, n)
    won = (rng.uniform(size=n) < truth).astype(int)
    market = np.clip(truth + rng.normal(0, 0.03, n), 0.05, 0.95)
    model = truth if informative else np.clip(rng.normal(0.5, 0.15, n), 0.05, 0.95)
    dates = [f"2026-12-{1 + (i // 2) % 28:02d}" if i < 56 else f"2027-01-{1 + (i // 2) % 28:02d}" for i in range(n)]
    teams = [(f"H{i:03d}", f"A{i:03d}") for i in range(n)]
    log = pd.DataFrame({"date": dates, "home": [t[0] for t in teams], "away": [t[1] for t in teams], "as_of": [d + " 09:00" for d in dates], "model_home_prob": model, "market_home_prob": market})
    res = pd.DataFrame({"date": dates, "home": [t[0] for t in teams], "away": [t[1] for t in teams], "home_won": won})
    return log, res


def test_no_verdict_below_the_minimum_and_the_note_says_how_many_more():
    log, res = make(100, True)
    r = M.evaluate(log, res)
    assert r["games"] == 100 and r["verdict"] is None
    assert "200 more" in r["note"]


def test_a_game_with_no_market_price_is_not_counted():
    log, res = make(50, True)
    log.loc[:19, "market_home_prob"] = np.nan
    assert M.evaluate(log, res)["games"] == 30


def test_the_blend_is_thirty_percent_model_and_seventy_percent_market():
    log, res = make(40, True)
    r = M.evaluate(log, res)
    g = log.merge(res, on=["date", "home", "away"])
    b = 0.3 * g.model_home_prob + 0.7 * g.market_home_prob
    expect = float(M._ll(g.home_won.to_numpy(float), b.to_numpy()).mean())
    assert abs(r["logloss"]["blend"] - expect) < 1e-9


def test_a_noise_model_does_not_beat_the_market_and_an_empty_record_does_not_fail():
    log, res = make(600, False)
    r = M.evaluate(log, res)
    assert r["games"] == 600 and r["H2_model_vs_market"]["hi"] < 0, "noise should be worse than a calibrated market"
    assert r["verdict"] is not None
    empty = M.evaluate(log.iloc[0:0], res)
    assert empty["games"] == 0 and empty["verdict"] is None


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
