"""Tests for devig.py and market_eval.py on data where the correct answer is known by construction.

    ingest/.venv/Scripts/python research/tests/test_market_eval.py

There is no real historical odds data yet, so these tests prove the analysis code can (a) de-vig correctly,
(b) parse the documented snapshot shape, (c) detect a model that carries real information beyond the market,
and (d) NOT find information in a model that is pure noise. They cannot prove anything about the real market.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "research"))
import market_eval as me  # noqa: E402
from devig import power, proportional, shin  # noqa: E402


def test_devig():
    for fn in (proportional, power, shin):
        p = fn([1.91, 1.91])
        assert abs(p.sum() - 1) < 1e-9 and abs(p[0] - 0.5) < 1e-6, fn.__name__
        p = fn([1.5, 2.8])
        assert abs(p.sum() - 1) < 1e-9
    prop = proportional([1.5, 2.8])
    assert abs(prop[0] - (1 / 1.5) / (1 / 1.5 + 1 / 2.8)) < 1e-12
    # Favourite-longshot bias: power and Shin give the favourite MORE than proportional does.
    assert power([1.5, 2.8])[0] > prop[0] and shin([1.5, 2.8])[0] > prop[0]
    # A book with no margin is left alone.
    assert np.allclose(shin([2.0, 2.0]), [0.5, 0.5])
    print("PASS devig: sums to 1, symmetric -> 0.5, favourite-longshot ordering holds")


def snapshot(event="ev1", minutes=20, rows=None):
    """Synthetic file in the documented historical shape (verified against a live response's keys)."""
    outcomes = []
    for player, point, over, under in rows:
        outcomes += [{"name": "Over", "description": player, "price": over, "point": point},
                     {"name": "Under", "description": player, "price": under, "point": point}]
    return {"timestamp": "2026-01-01T00:00:00Z", "previous_timestamp": "x", "next_timestamp": "y",
            "data": {"id": event, "sport_key": "basketball_nba", "commence_time": "2026-01-02T00:30:00Z",
                     "home_team": "A", "away_team": "B",
                     "bookmakers": [{"key": "bk1", "title": "Book 1", "markets": [{"key": "player_points", "last_update": "z", "outcomes": outcomes}]},
                                    {"key": "bk2", "title": "Book 2", "markets": [{"key": "player_points", "last_update": "z", "outcomes": outcomes}]}]},
            "_request": {"event_id": event, "minutes_before_tip": minutes}}


def test_parse(tmp: Path):
    tmp.mkdir(exist_ok=True)
    for m, prices in [(180, (1.95, 1.87)), (20, (1.80, 2.02))]:
        (tmp / f"ev1_m{m}.json").write_text(json.dumps(snapshot(minutes=m, rows=[("Nikola Jokić", 24.5, *prices)])))
    rows = pd.DataFrame([r for f in sorted(tmp.glob("ev1_m*.json")) for r in me.parse_snapshot(f)])
    assert len(rows) == 4 and set(rows.minutes) == {180, 20} and set(rows.stat) == {"pts"}
    props = me.to_props(me.consensus(rows))
    assert len(props) == 1
    r = props.iloc[0]
    # The over shortened from 1.95 to 1.80 at close, so its probability must rise, to exactly the de-vigged value.
    assert abs(r.p_open - power([1.95, 1.87])[0]) < 1e-9 and abs(r.p_close - power([1.80, 2.02])[0]) < 1e-9
    assert r.p_close > r.p_open
    assert me.norm_name("Nikola Jokić") == me.norm_name("Nikola Jokic") == "nikola jokic"
    print("PASS parse: snapshot shape -> consensus -> open/close pairing, accents normalised")


def simulate(n, informative: bool, seed=0):
    """Truth p -> outcome y. Market sees truth with noise; the model sees it with independent noise (or none)."""
    rng = np.random.default_rng(seed)
    z = rng.normal(0, 0.5, n)                       # true log-odds of the over
    p_true = 1 / (1 + np.exp(-z))
    y = (rng.random(n) < p_true).astype(float)
    p_market = 1 / (1 + np.exp(-(z + rng.normal(0, 0.35, n))))
    noise = rng.normal(0, 0.35, n) if informative else rng.normal(0, 0.5, n)
    p_model = 1 / (1 + np.exp(-((z + noise) if informative else noise)))
    # early prices carry a 5% margin; the closing line has moved toward the truth
    p_open = 1 / (1 + np.exp(-(z + rng.normal(0, 0.6, n))))
    df = pd.DataFrame(dict(y=y, p_close=p_market, p_model=p_model, p_open=p_open,
                           open_over=1 / (p_open * 1.05), open_under=1 / ((1 - p_open) * 1.05),
                           week=rng.integers(0, 40, n).astype(str)))
    return df


def test_detects_information():
    res = me.evaluate(simulate(8000, informative=True, seed=1))
    lo, hi = res["blend"]["model_coef_ci"]
    assert lo > 0.05, f"informative model not detected: coef {res['blend']['model_coef']:.3f} CI [{lo:.3f},{hi:.3f}]"
    assert res["blend_in_sample"]["logloss"] < res["market_close"]["logloss"]
    print(f"PASS informative model detected: coefficient {res['blend']['model_coef']:.2f}, CI [{lo:.2f}, {hi:.2f}]")


def test_rejects_noise():
    hits = 0
    for seed in range(8):
        res = me.evaluate(simulate(6000, informative=False, seed=10 + seed))
        lo, hi = res["blend"]["model_coef_ci"]
        hits += lo > 0
    assert hits <= 1, f"a pure-noise model looked informative in {hits}/8 simulations (expected about 0.2)"
    print(f"PASS noise rejected: a pure-noise model had a CI above 0 in {hits}/8 simulations")


def test_clv_sign():
    # Early prices are noisy views of the truth; the close is sharper. A model that sees the truth should
    # produce bets whose expected value at the CLOSING probability is positive.
    df = simulate(20000, informative=True, seed=3)
    res = me.evaluate(df, model_weight=0.5, edge_threshold=0.03)
    p = res["policy"]
    assert p["bets"] > 200 and p["clv_ci"][0] > 0, f"policy CLV not positive: {p}"
    print(f"PASS CLV: {p['bets']} bets, mean CLV {p['clv_mean']:+.3f}, CI [{p['clv_ci'][0]:+.3f}, {p['clv_ci'][1]:+.3f}]")


if __name__ == "__main__":
    test_devig()
    try:
        test_parse(ROOT / "research" / "out" / "fixture")
    except AssertionError as e:
        print("parse test assertion:", e)
        raise
    test_detects_information()
    test_rejects_noise()
    test_clv_sign()
    print("\nALL PASS")
