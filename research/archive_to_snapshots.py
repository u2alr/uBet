"""Turn the point-in-time odds archive (D1 table odds_quotes, migration 0018) into the snapshot files research/market_eval.py reads.

    ingest/.venv/Scripts/python research/archive_to_snapshots.py --local            # read the local D1, write research/data/odds_hist/prospective/
    ingest/.venv/Scripts/python research/archive_to_snapshots.py --from-json rows.json

market_eval.py (rules fixed in PREREG_MARKET.md) wants, per game, a snapshot about 180 minutes before tip ("open") and one about 20 minutes before ("close").
This reconstructs each from what the archive observed: for every market, the latest observation at or before the target time, accepted only if it was made no
more than TOLERANCE minutes earlier and was not stale or unavailable. Anything else is left out, never filled in.

What this is NOT: it does not change the pre-registered design, the hypotheses, the minimum of 3,000 matched props, or the analysis code. It only supplies
PROSPECTIVELY collected prices in the format the existing evaluation already reads. The "close" is a closing PROXY (last observation before tip), never a true
closing line. Until enough games accumulate, market_eval.py itself refuses to draw a conclusion.
"""
import argparse
import datetime as dt
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(__file__).resolve().parent / "data" / "odds_hist" / "prospective"
STAT_MARKET = {"pts": "player_points", "reb": "player_rebounds", "ast": "player_assists", "fg3m": "player_threes"}
TARGETS = (180, 20)
TOLERANCE = 25  # minutes: an observation older than the target by more than this is not used


def parse(t: str) -> dt.datetime:
    return dt.datetime.fromisoformat(t.replace("Z", "+00:00"))


def state_at(rows: list[dict], target: dt.datetime, tolerance: int = TOLERANCE) -> dict[tuple, dict]:
    """Latest usable observation per market key at or before `target`. Unavailable, stale and too-old observations are dropped."""
    latest: dict[tuple, dict] = {}
    for r in sorted(rows, key=lambda r: r["capturedAt"]):
        if parse(r["capturedAt"]) > target:
            break
        latest[(r["playerName"], r["stat"], r["line"], r["side"], r["book"], r["source"])] = r
    out = {}
    for k, r in latest.items():
        age = (target - parse(r["capturedAt"])).total_seconds() / 60
        if r["marketStatus"] != "open" or r["price"] is None or r.get("freshness") == "stale" or age > tolerance:
            continue
        out[k] = r
    return out


def snapshot(event_id: str, commence: str, rows: list[dict], minutes: int, tolerance: int = TOLERANCE) -> dict | None:
    """One market_eval-format snapshot for an event, or None if nothing usable was observed near that time."""
    target = parse(commence) - dt.timedelta(minutes=minutes)
    state = state_at(rows, target, tolerance)
    books: dict[str, dict[str, dict[tuple, dict]]] = {}
    for (player, stat, line, side, book, _source), r in state.items():
        market = STAT_MARKET.get(stat)
        if not market:
            continue
        books.setdefault(book, {}).setdefault(market, {}).setdefault((player, line), {})[side] = r["price"]
    bookmakers = []
    for book, markets in sorted(books.items()):
        ms = []
        for mkey, props in markets.items():
            outcomes = []
            for (player, line), sides in props.items():
                for side, price in sides.items():
                    outcomes.append({"name": side.capitalize(), "description": player, "price": price, "point": line})
            ms.append({"key": mkey, "outcomes": outcomes})
        bookmakers.append({"key": book.lower(), "title": book, "markets": ms})
    if not bookmakers:
        return None
    return {"data": {"id": event_id, "commence_time": commence, "bookmakers": bookmakers},
            "_request": {"event_id": event_id, "minutes_before_tip": minutes, "requested_date": target.strftime("%Y-%m-%dT%H:%M:%SZ"), "markets": ",".join(STAT_MARKET.values()),
                         "regions": "us", "provenance": "prospective archive (odds_quotes), nearest prior observation within tolerance"}}


def export(rows: list[dict], out_dir: Path = OUT) -> dict:
    """Write snapshot files for every event that has an event start. Returns counts, including events skipped and why."""
    out_dir.mkdir(parents=True, exist_ok=True)
    by_event: dict[str, list[dict]] = {}
    for r in rows:
        by_event.setdefault(r["eventId"], []).append(r)
    written = skipped = 0
    for eid, rs in by_event.items():
        commence = next((r["eventStart"] for r in rs if r.get("eventStart")), None)
        if not commence:
            skipped += 1
            continue
        for m in TARGETS:
            snap = snapshot(eid, commence, rs, m)
            if snap is None:
                skipped += 1
                continue
            (out_dir / f"{eid}_m{m}.json").write_text(json.dumps(snap), encoding="utf-8")
            written += 1
    return {"events": len(by_event), "snapshots_written": written, "snapshots_skipped": skipped, "dir": str(out_dir)}


def read_d1(remote: bool) -> list[dict]:
    sql = ("SELECT event_id AS eventId, event_start AS eventStart, player_name AS playerName, stat, line, side, book, source, captured_at AS capturedAt, price, "
           "market_status AS marketStatus, freshness FROM odds_quotes ORDER BY captured_at")
    cmd = ["npx", "wrangler", "d1", "execute", "ubet", "--remote" if remote else "--local", "--json", "--command", sql]
    res = subprocess.run(cmd, cwd=ROOT, shell=True, capture_output=True, text=True, encoding="utf-8", check=True).stdout
    return json.loads(res[res.index("["):])[0]["results"]


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--local", action="store_true")
    g.add_argument("--remote", action="store_true")
    g.add_argument("--from-json")
    args = ap.parse_args()
    rows = json.loads(Path(args.from_json).read_text(encoding="utf-8")) if args.from_json else read_d1(args.remote)
    print(json.dumps(export(rows), indent=1))


if __name__ == "__main__":
    main()
