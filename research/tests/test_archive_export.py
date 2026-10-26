"""The archive exporter must feed market_eval.py without inventing prices, and must refuse stale, too-old or unavailable observations."""
import datetime as dt
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import archive_to_snapshots as A  # noqa: E402

try:
    import market_eval as me  # noqa: E402  (needs scikit-learn)
except ImportError:
    me = None

START = "2026-10-27T00:30:00Z"


def at(minutes_before: float) -> str:
    return (A.parse(START) - dt.timedelta(minutes=minutes_before)).strftime("%Y-%m-%dT%H:%M:%SZ")


def row(minutes_before, side, price, **kw):
    base = dict(eventId="e1", eventStart=START, playerName="Jaylen Brown", stat="pts", line=24.5, side=side, book="DraftKings", source="theoddsapi",
                capturedAt=at(minutes_before), price=price, marketStatus="open", freshness="fresh")
    base.update(kw)
    return base


def pair(minutes_before, over, under, **kw):
    return [row(minutes_before, "over", over, **kw), row(minutes_before, "under", under, **kw)]


def test_nearest_prior_observation_within_tolerance_is_used_and_later_ones_are_ignored():
    rows = pair(200, 1.9, 1.9) + pair(15, 1.8, 2.0)
    o = A.snapshot("e1", START, rows, 180)                  # 200 min before tip is 20 minutes before the 180-minute target: usable
    price = {x["name"]: x["price"] for x in o["data"]["bookmakers"][0]["markets"][0]["outcomes"]}
    assert price == {"Over": 1.9, "Under": 1.9}
    assert o["_request"]["minutes_before_tip"] == 180
    assert A.snapshot("e1", START, rows, 20) is None, "the 15-minute observation is after the 20-minute target; the 200-minute one is far too old"


def test_close_uses_the_last_observation_before_the_target_never_a_later_one():
    rows = pair(200, 1.9, 1.9) + pair(30, 1.85, 1.95) + pair(2, 1.5, 2.6)
    c = A.snapshot("e1", START, rows, 20)
    price = {x["name"]: x["price"] for x in c["data"]["bookmakers"][0]["markets"][0]["outcomes"]}
    assert price == {"Over": 1.85, "Under": 1.95}, "the 2-minute observation is after the 20-minute target and must not leak in"


def test_stale_unavailable_and_too_old_observations_are_left_out_not_filled_in():
    assert A.snapshot("e1", START, pair(30, 1.9, 1.9, freshness="stale"), 20) is None
    assert A.snapshot("e1", START, pair(30, None, None, marketStatus="unavailable"), 20) is None
    assert A.snapshot("e1", START, pair(120, 1.9, 1.9), 20) is None, "an observation 100 minutes before the target is not a snapshot of that moment"


def test_export_writes_market_eval_files_and_counts_what_it_skipped():
    with tempfile.TemporaryDirectory() as d:
        rows = pair(185, 1.9, 1.9) + pair(30, 1.85, 1.95) + [dict(row(30, "over", 1.9), eventId="no_start", eventStart=None)]
        res = A.export(rows, Path(d))
        assert res["snapshots_written"] == 2 and res["events"] == 2 and res["snapshots_skipped"] == 1
        files = sorted(p.name for p in Path(d).glob("*.json"))
        assert files == ["e1_m180.json", "e1_m20.json"]
        if me is not None:
            parsed = me.parse_snapshot(Path(d) / "e1_m20.json")
            assert len(parsed) == 1 and parsed[0]["over"] == 1.85 and parsed[0]["under"] == 1.95 and parsed[0]["minutes"] == 20


def test_single_sided_markets_never_become_two_sided_rows():
    with tempfile.TemporaryDirectory() as d:
        A.export([row(30, "over", 1.9)], Path(d))
        if me is not None and list(Path(d).glob("*.json")):
            assert me.parse_snapshot(next(Path(d).glob("*_m20.json"))) == []


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
