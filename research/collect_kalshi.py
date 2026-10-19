"""Collect Kalshi's public NBA prices into a database you own. Free, no API key, read-only market data.

    ingest/.venv/Scripts/python research/collect_kalshi.py              # one snapshot
    ingest/.venv/Scripts/python research/collect_kalshi.py --loop 10    # repeat every 10 minutes

Kalshi is a regulated prediction market. A contract "Victor Wembanyama: 25+ points" pays $1 if he scores 25+,
so its price is a probability, directly comparable with the model's P(points > 24.5).

Storage: research/data/kalshi.sqlite (git-ignored)
- runs       one row per collector run, so analysis knows prices were being watched at that time
- snapshots  one row per market whenever its quote CHANGES (unchanged quotes are not re-stored)

Only the public market-data endpoints are used. Check Kalshi's terms before redistributing the data.
"""
import argparse
import datetime as dt
import json
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = "https://api.elections.kalshi.com/trade-api/v2"
DB_PATH = Path(__file__).resolve().parent / "data" / "kalshi.sqlite"
PROP_STAT = {"KXNBAPTS": "pts", "KXNBAREB": "reb", "KXNBAAST": "ast", "KXNBA3PT": "fg3m"}
SERIES = {**{s: "prop" for s in PROP_STAT}, "KXNBAGAME": "game", "KXNBASPREAD": "spread", "KXNBATOTAL": "total"}
MONTHS = {m: i + 1 for i, m in enumerate("JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split())}

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (captured_at TEXT PRIMARY KEY, markets INTEGER, stored INTEGER);
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  captured_at TEXT NOT NULL,
  ticker TEXT NOT NULL, event_ticker TEXT NOT NULL, series TEXT NOT NULL, kind TEXT NOT NULL,
  event_date TEXT, tip_est TEXT,
  player TEXT, stat TEXT, title TEXT, strike REAL,
  bid REAL, ask REAL, bid_size REAL, ask_size REAL, last REAL, volume REAL, volume_24h REAL, open_interest REAL
);
CREATE INDEX IF NOT EXISTS idx_snap_ticker ON snapshots(ticker, captured_at);
CREATE TABLE IF NOT EXISTS latest (ticker TEXT PRIMARY KEY, quote TEXT NOT NULL);
"""


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def event_date(event_ticker: str) -> str | None:
    """'KXNBAPTS-26OCT20OKCSAS' -> '2026-10-20' (the Eastern-time date the game was scheduled)."""
    m = re.search(r"-(\d{2})([A-Z]{3})(\d{2})", event_ticker)
    if not m or m.group(2) not in MONTHS:
        return None
    return f"{2000 + int(m.group(1))}-{MONTHS[m.group(2)]:02d}-{int(m.group(3)):02d}"


def parse_market(m: dict, series: str, captured_at: str) -> dict:
    kind = SERIES[series]
    # occurrence_datetime is the expected end of the game; tip-off is about three hours earlier.
    tip = None
    if m.get("occurrence_datetime"):
        end = dt.datetime.fromisoformat(m["occurrence_datetime"].replace("Z", "+00:00"))
        tip = (end - dt.timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M:%SZ")
    sub = m.get("yes_sub_title") or ""
    return {
        "captured_at": captured_at, "ticker": m["ticker"], "event_ticker": m["event_ticker"], "series": series, "kind": kind,
        "event_date": event_date(m["event_ticker"]), "tip_est": tip,
        "player": sub.split(":")[0].strip() if kind == "prop" and ":" in sub else None,
        "stat": PROP_STAT.get(series), "title": m.get("title"), "strike": num(m.get("floor_strike")),
        "bid": num(m.get("yes_bid_dollars")), "ask": num(m.get("yes_ask_dollars")),
        "bid_size": num(m.get("yes_bid_size_fp")), "ask_size": num(m.get("yes_ask_size_fp")),
        "last": num(m.get("last_price_dollars")), "volume": num(m.get("volume_fp")),
        "volume_24h": num(m.get("volume_24h_fp")), "open_interest": num(m.get("open_interest_fp")),
    }


def get_json(url: str) -> dict:
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"Accept": "application/json"}), timeout=45) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(5 * (attempt + 1))
                continue
            raise
        except urllib.error.URLError:
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"gave up on {url}")


def fetch_series(series: str) -> list[dict]:
    markets, cursor = [], ""
    while True:
        url = f"{BASE}/markets?series_ticker={series}&status=open&limit=1000" + (f"&cursor={cursor}" if cursor else "")
        body = get_json(url)
        markets += body.get("markets", [])
        cursor = body.get("cursor") or ""
        if not cursor:
            return markets


def quote_key(r: dict) -> str:
    return json.dumps([r["bid"], r["ask"], r["bid_size"], r["ask_size"], r["last"], r["volume"]])


COLS = ["captured_at", "ticker", "event_ticker", "series", "kind", "event_date", "tip_est", "player", "stat", "title",
        "strike", "bid", "ask", "bid_size", "ask_size", "last", "volume", "volume_24h", "open_interest"]


def store(conn: sqlite3.Connection, rows: list[dict]) -> int:
    """Insert only markets whose quote changed since last stored. Returns how many were inserted."""
    prev = dict(conn.execute("SELECT ticker, quote FROM latest"))
    new = [r for r in rows if prev.get(r["ticker"]) != quote_key(r)]
    conn.executemany(f"INSERT INTO snapshots ({','.join(COLS)}) VALUES ({','.join('?' * len(COLS))})",
                     [[r[c] for c in COLS] for r in new])
    conn.executemany("INSERT OR REPLACE INTO latest (ticker, quote) VALUES (?, ?)", [(r["ticker"], quote_key(r)) for r in new])
    return len(new)


def connect(path: Path = DB_PATH) -> sqlite3.Connection:
    path.parent.mkdir(exist_ok=True)
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA)
    return conn


def snapshot(conn: sqlite3.Connection) -> tuple[int, int]:
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    rows = []
    for series in SERIES:
        try:
            rows += [parse_market(m, series, now) for m in fetch_series(series)]
        except Exception as e:  # one failing series must not lose the others
            print(f"  {series}: {e}", flush=True)
        time.sleep(0.3)
    stored = store(conn, rows)
    conn.execute("INSERT OR REPLACE INTO runs (captured_at, markets, stored) VALUES (?,?,?)", (now, len(rows), stored))
    conn.commit()
    return len(rows), stored


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--loop", type=int, default=0, help="repeat every N minutes (0 = once)")
    args = ap.parse_args()
    conn = connect()
    while True:
        seen, stored = snapshot(conn)
        total = conn.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0]
        print(f"{dt.datetime.now():%Y-%m-%d %H:%M:%S}  {seen} open markets, {stored} changed, {total:,} stored in total", flush=True)
        if not args.loop:
            break
        time.sleep(args.loop * 60)


if __name__ == "__main__":
    main()
