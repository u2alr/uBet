"""Download historical sportsbook prop lines (The Odds API) for a sample of games, as raw JSON.

Needs a PAID Odds API plan: historical odds return HTTP 401 on the free plan. Listing historical
events works on the free plan, so --dry-run can price a run before any money is spent.

    ingest/.venv/Scripts/python research/backfill_odds.py --dry-run --games 300
    ingest/.venv/Scripts/python research/backfill_odds.py --games 300 --budget 18000

Cost: each historical event-odds request costs 10 credits x markets x regions, and we take two snapshots per
game (default 180 and 20 minutes before tip: "bet time" and "close"). 3 markets, 1 region, 2 snapshots =
60 credits per game, so a 20,000-credit month covers roughly 300 games.

Files land in research/data/odds_hist/<season>/<event>_m<minutes>.json and are never re-downloaded.
The API key is read from the environment or .dev.vars and is never written to disk or printed.
"""
import argparse
import datetime as dt
import json
import os
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = Path(__file__).resolve().parent / "data"
BASE = "https://api.the-odds-api.com/v4/historical/sports/basketball_nba"


def api_key() -> str:
    key = os.environ.get("ODDS_API_KEY")
    if not key and (ROOT / ".dev.vars").exists():
        for line in (ROOT / ".dev.vars").read_text().splitlines():
            if line.startswith("ODDS_API_KEY="):
                key = line.split("=", 1)[1].strip()
    if not key:
        sys.exit("Set ODDS_API_KEY (env var or .dev.vars).")
    return key


def get(url: str) -> tuple[int, dict, dict]:
    """Returns (status, json body, credit headers). Never raises on HTTP errors."""
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            return r.status, json.load(r), {k.lower(): v for k, v in r.headers.items()}
    except urllib.error.HTTPError as e:
        body = {}
        try:
            body = json.load(e)
        except Exception:
            pass
        return e.code, body, {k.lower(): v for k, v in e.headers.items()}


def game_days(season: str) -> list[dt.date]:
    """Days with games, taken from the team logs already downloaded by pull_raw.py."""
    import pandas as pd

    days = set()
    for f in DATA.glob(f"team_{season}_*.csv"):
        d = pd.read_csv(f)
        days.update(pd.to_datetime(d.GAME_DATE).dt.date)
    return sorted(days)


def events_on(day: dt.date, key: str) -> list[dict]:
    """Games listed the afternoon (ET) of `day`. One cheap call; free plan allowed."""
    at = dt.datetime.combine(day, dt.time(17, 0), tzinfo=dt.timezone.utc)  # noon Eastern
    status, body, _ = get(f"{BASE}/events?{urllib.parse.urlencode({'apiKey': key, 'date': at.strftime('%Y-%m-%dT%H:%M:%SZ')})}")
    if status != 200:
        print(f"  events {day}: HTTP {status} {body.get('message', '')}")
        return []
    lo, hi = at, at + dt.timedelta(hours=15)
    return [e for e in body.get("data", [])
            if lo <= dt.datetime.fromisoformat(e["commence_time"].replace("Z", "+00:00")) < hi]


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", default="2025-26")
    ap.add_argument("--games", type=int, default=300, help="approximate number of games to sample")
    ap.add_argument("--snapshots", default="180,20", help="minutes before tip, comma separated")
    ap.add_argument("--markets", default="player_points,player_rebounds,player_assists")
    ap.add_argument("--regions", default="us")
    ap.add_argument("--budget", type=int, default=18000, help="stop after spending this many credits")
    ap.add_argument("--reserve", type=int, default=300, help="never let remaining credits fall below this")
    ap.add_argument("--seed", type=int, default=11)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    key = api_key()
    snaps = [int(x) for x in args.snapshots.split(",")]
    per_request = 10 * len(args.markets.split(",")) * len(args.regions.split(","))
    out_dir = DATA / "odds_hist" / args.season
    out_dir.mkdir(parents=True, exist_ok=True)

    days = game_days(args.season)
    if not days:
        sys.exit(f"No game days for {args.season}; run research/pull_raw.py first.")
    # Sample whole days so every sampled game has all its siblings, spread evenly over the season.
    rng = random.Random(args.seed)
    n_days = max(1, round(args.games / 7.5))
    chosen = sorted(rng.sample(days, min(n_days, len(days))))
    events = []
    for d in chosen:
        events += events_on(d, key)
        time.sleep(0.2)
    print(f"{len(chosen)} game days sampled -> {len(events)} games")

    todo = [(e, m) for e in events for m in snaps if not (out_dir / f"{e['id']}_m{m}.json").exists()]
    est = len(todo) * per_request
    print(f"{len(todo)} snapshot requests x {per_request} credits = about {est:,} credits "
          f"(budget {args.budget:,}; plan sizes: 20,000 / 100,000 per month)")
    if args.dry_run:
        print("dry run: nothing downloaded.")
        return

    spent = 0
    for e, m in todo:
        if spent + per_request > args.budget:
            print("budget reached; stopping (rerun later to continue)")
            break
        tip = dt.datetime.fromisoformat(e["commence_time"].replace("Z", "+00:00"))
        when = (tip - dt.timedelta(minutes=m)).strftime("%Y-%m-%dT%H:%M:%SZ")
        q = urllib.parse.urlencode({"apiKey": key, "regions": args.regions, "markets": args.markets,
                                    "oddsFormat": "decimal", "date": when})
        status, body, hdr = get(f"{BASE}/events/{e['id']}/odds?{q}")
        if status == 401:
            sys.exit(f"HTTP 401: {body.get('message', '')}\nHistorical odds need a paid Odds API plan.")
        if status != 200:
            print(f"  {e['id']} m{m}: HTTP {status} {body.get('message', '')}; skipping")
            continue
        body["_request"] = {"event_id": e["id"], "minutes_before_tip": m, "requested_date": when,
                            "markets": args.markets, "regions": args.regions}
        (out_dir / f"{e['id']}_m{m}.json").write_text(json.dumps(body))
        spent += int(hdr.get("x-requests-last", per_request))
        remaining = int(hdr.get("x-requests-remaining", 10**9))
        if remaining < args.reserve:
            print(f"only {remaining} credits left (reserve {args.reserve}); stopping")
            break
        time.sleep(0.2)
    print(f"done: spent about {spent:,} credits")


if __name__ == "__main__":
    main()
