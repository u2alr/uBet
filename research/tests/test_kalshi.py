"""Tests for collect_kalshi.py and kalshi_eval.py on synthetic data with known answers.

    ingest/.venv/Scripts/python research/tests/test_kalshi.py

They check parsing, change-only storage, the freshness/liquidity rules, fee and price arithmetic, the
outcome join, and the pre-registered refusal to show results below the minimum evidence. They cannot say
anything about how good Kalshi's prices are; that needs real outcomes.
"""
import datetime as dt
import sys
import tempfile
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "research"))
import collect_kalshi as ck  # noqa: E402
import kalshi_eval as ke  # noqa: E402


def market(strike=24.5, bid="0.5400", ask="0.5600"):
    """Field names exactly as the live API returns them (checked against a real response)."""
    return {"ticker": "KXNBAPTS-26OCT20OKCSAS-SASVWEMBANYAMA1-25", "event_ticker": "KXNBAPTS-26OCT20OKCSAS",
            "title": "Victor Wembanyama: 25+ points", "yes_sub_title": "Victor Wembanyama: 25+",
            "floor_strike": strike, "strike_type": "greater", "occurrence_datetime": "2026-10-21T04:30:00Z",
            "yes_bid_dollars": bid, "yes_ask_dollars": ask, "yes_bid_size_fp": "2.00", "yes_ask_size_fp": "1.00",
            "last_price_dollars": "0.5600", "volume_fp": "402.61", "volume_24h_fp": "185.68", "open_interest_fp": "347.61"}


def test_parse():
    r = ck.parse_market(market(), "KXNBAPTS", "2026-10-19T12:00:00Z")
    assert r["player"] == "Victor Wembanyama" and r["stat"] == "pts" and r["kind"] == "prop"
    assert r["strike"] == 24.5 and r["bid"] == 0.54 and r["ask"] == 0.56 and r["event_date"] == "2026-10-20"
    assert r["tip_est"] == "2026-10-21T01:30:00Z", r["tip_est"]  # end 04:30Z minus 3h = 9:30pm ET tip
    assert ck.event_date("KXNBAGAME-26OCT25MEMSAC") == "2026-10-25" and ck.event_date("KXNBAMVP") is None
    g = ck.parse_market({**market(), "yes_sub_title": "Sacramento", "floor_strike": None}, "KXNBAGAME", "x")
    assert g["kind"] == "game" and g["player"] is None and g["strike"] is None
    print("PASS parse: field names, player/stat/date, tip-off estimate, game markets")


def test_change_only_storage(tmp):
    conn = ck.connect(tmp / "k.sqlite")
    row = ck.parse_market(market(), "KXNBAPTS", "t1")
    assert ck.store(conn, [row]) == 1
    assert ck.store(conn, [{**row, "captured_at": "t2"}]) == 0, "unchanged quote must not be stored again"
    assert ck.store(conn, [{**row, "captured_at": "t3", "bid": 0.55}]) == 1
    assert conn.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0] == 2
    print("PASS storage: only changed quotes are written")


def test_fee_and_prices():
    assert ke.fee(0.54) == 0.02 and ke.fee(0.50) == 0.02 and ke.fee(0.10) == 0.01 and ke.fee(0.01) == 0.01
    print("PASS fee: rounded up to the cent")


def build(tmp, spread_close=0.02, run_gap=False):
    """Three finished games; every prop quoted at open and close; collector running every 10 minutes."""
    conn = ck.connect(tmp / f"b_{spread_close}_{run_gap}.sqlite")
    tip = dt.datetime(2025, 1, 10, 0, 30, tzinfo=dt.timezone.utc)
    t = tip - dt.timedelta(hours=4)  # collector runs from 4h before tip to the tip
    while t <= tip:
        gap = run_gap and tip - dt.timedelta(minutes=40) < t < tip - dt.timedelta(minutes=2)
        if not gap:
            conn.execute("INSERT OR REPLACE INTO runs (captured_at, markets, stored) VALUES (?,?,0)", (ke.iso(t), 1))
        t += dt.timedelta(minutes=10)
    end = (tip + dt.timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M:%SZ")
    base = {**market(), "occurrence_datetime": end, "event_ticker": "KXNBAPTS-25JAN09AAABBB"}
    for k, (player, strike) in enumerate([("Alpha One", 24.5), ("Beta Two", 19.5), ("Gamma Three", 9.5)]):
        m = {**base, "ticker": f"KXNBAPTS-25JAN09AAABBB-{k}", "yes_sub_title": f"{player}: x+", "floor_strike": strike}
        early = ck.parse_market({**m, "yes_bid_dollars": "0.50", "yes_ask_dollars": "0.54"}, "KXNBAPTS", ke.iso(tip - dt.timedelta(hours=5)))
        close = ck.parse_market({**m, "yes_bid_dollars": f"{0.60:.2f}", "yes_ask_dollars": f"{0.60 + spread_close:.2f}"},
                                "KXNBAPTS", ke.iso(tip - dt.timedelta(minutes=45)))
        ck.store(conn, [early]); ck.store(conn, [close])
    conn.commit()
    return conn


def test_build_props(tmp):
    truth = {"alpha one": 30, "beta two": 10, "gamma three": 9}  # 30>24.5 yes, 10>19.5 no, 9>9.5 no
    prob = lambda player, d, s, k: 0.6
    outcome = lambda player, d, s: truth.get(player.lower())
    df = ke.build_props(build(tmp), prob, outcome)
    assert len(df) == 3 and sorted(df.y.tolist()) == [0.0, 0.0, 1.0], df
    r = df.iloc[0]
    assert abs(r.p_open - 0.52) < 1e-9 and abs(r.p_close - 0.61) < 1e-9, (r.p_open, r.p_close)
    assert abs(r.open_over - 1 / (0.54 + 0.02)) < 1e-9          # YES at 0.54 plus a 2-cent fee
    assert abs(r.open_under - 1 / (0.50 + 0.02)) < 1e-9         # NO costs 1 - bid = 0.50, fee 2 cents
    assert ke.build_props(build(tmp, spread_close=0.12), prob, outcome).empty, "wide spread must be excluded"
    assert ke.build_props(build(tmp, run_gap=True), prob, outcome).empty, "no collector run before close must be excluded"
    assert ke.build_props(build(tmp), prob, lambda p, d, s: None).empty, "no box score (did not play) must be excluded"
    print("PASS build_props: open/close quotes, YES/NO prices with fee, outcome join, liquidity and freshness rules")


def test_minimum_guard():
    few = pd.DataFrame({"date": pd.to_datetime(["2025-01-01"] * 2000)})
    assert not ke.enough(few), "2,000 props on one date must not unlock results (needs 30 dates)"
    many = pd.DataFrame({"date": pd.date_range("2025-01-01", periods=40).repeat(40)})
    assert ke.enough(many) and not ke.enough(many.head(100))
    print("PASS guard: results stay locked until 1,500 props across 30 dates")


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
        tmp = Path(d)
        test_parse()
        test_change_only_storage(tmp)
        test_fee_and_prices()
        test_build_props(tmp)
        test_minimum_guard()
    print("\nALL PASS")
