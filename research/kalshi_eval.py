"""Compare the model with Kalshi's prices on the exact same question. Rules are fixed in PREREG_KALSHI.md.

    ingest/.venv/Scripts/python research/kalshi_eval.py --peek   # counts only: how much usable data exists yet
    ingest/.venv/Scripts/python research/kalshi_eval.py          # full analysis, but only once the minimum is met

The minimum (1,500 liquid props over 30 game dates) is enforced here so nobody, including me, reads results early.
"""
import argparse
import datetime as dt
import glob
import json
import math
import sqlite3
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import collect_kalshi  # noqa: E402
import market_eval as me  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(__file__).resolve().parent / "out"
MIN_PROPS, MIN_DAYS = 1500, 30
MAX_SPREAD = 0.06
FEE_RATE = 0.07  # assumed taker fee: FEE_RATE * p * (1 - p) per contract, rounded up to the cent


def fee(p: float) -> float:
    return math.ceil(FEE_RATE * p * (1 - p) * 100 - 1e-9) / 100


def ts(s: str) -> dt.datetime:
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def iso(t: dt.datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def quote_at(conn, ticker: str, target: dt.datetime, fresh_minutes: int = 20):
    """The quote in force at `target`, or None unless the collector was running in the minutes before it."""
    ran = conn.execute("SELECT 1 FROM runs WHERE captured_at BETWEEN ? AND ? LIMIT 1",
                       (iso(target - dt.timedelta(minutes=fresh_minutes)), iso(target))).fetchone()
    if not ran:
        return None
    return conn.execute(
        "SELECT bid, ask, bid_size, ask_size, volume FROM snapshots WHERE ticker=? AND captured_at<=? ORDER BY captured_at DESC LIMIT 1",
        (ticker, iso(target))).fetchone()


def build_props(conn, model_prob, truth, open_min: int = 180, close_min: int = 5) -> pd.DataFrame:
    """One row per liquid prop with open quote, close quote, model probability and outcome.

    model_prob(player, date, stat, strike) -> float | None;  truth(player, date, stat) -> number | None.
    """
    rows = []
    for ticker, player, stat, strike, date, tip in conn.execute(
            "SELECT DISTINCT ticker, player, stat, strike, event_date, tip_est FROM snapshots WHERE kind='prop' AND tip_est IS NOT NULL"):
        tip_t = ts(tip)
        if tip_t > dt.datetime.now(dt.timezone.utc):
            continue  # not played yet
        o = quote_at(conn, ticker, tip_t - dt.timedelta(minutes=open_min))
        c = quote_at(conn, ticker, tip_t - dt.timedelta(minutes=close_min))
        if not o or not c:
            continue
        ok = all(q[0] and q[1] and q[0] > 0 and q[1] > 0 and q[1] > q[0] and q[1] - q[0] <= MAX_SPREAD + 1e-9 and q[2] >= 1 and q[3] >= 1 for q in (o, c))
        if not ok:
            continue
        p_model, actual = model_prob(player, date, stat, strike), truth(player, date, stat)
        if p_model is None or actual is None:
            continue
        ask, bid = o[1], o[0]
        rows.append(dict(
            ticker=ticker, player=player, stat=stat, line=strike, date=pd.Timestamp(date),
            p_open=(o[0] + o[1]) / 2, p_close=(c[0] + c[1]) / 2,
            open_over=1 / (ask + fee(ask)),                 # buy YES at the ask
            open_under=1 / ((1 - bid) + fee(1 - bid)),      # buy NO at 1 - bid
            p_model=p_model, y=float(actual > strike), volume=c[4]))
    df = pd.DataFrame(rows)
    if len(df):
        df["week"] = df.date.dt.to_period("W").astype(str)
    return df


# ---------- real-data providers ----------

def d1_model_prob():
    """P(over strike) from the projections stored in the local D1 file by research/project.py."""
    from models import nb_p_over

    best, size = None, -1
    for f in glob.glob(str(ROOT / ".wrangler" / "state" / "v3" / "d1" / "**" / "*.sqlite"), recursive=True):
        c = sqlite3.connect(f)
        try:
            n = c.execute("SELECT COUNT(*) FROM projections").fetchone()[0]
            if n > size:
                best, size = f, n
        except sqlite3.Error:
            pass
        c.close()
    if best is None:
        sys.exit("No local D1 database with a projections table found. Run research/project.py first.")
    c = sqlite3.connect(best)
    names = {r[0]: me.norm_name(r[1]) for r in c.execute("SELECT id, name FROM players")}
    proj = {(names.get(pid), d, s): (m, a) for pid, d, s, m, a in c.execute("SELECT player_id, game_date, stat, mean, alpha FROM projections")}

    def f(player, date, stat, strike):
        hit = proj.get((me.norm_name(player), date, stat))
        return None if hit is None else float(nb_p_over(np.array([strike]), np.array([hit[0]]), np.array([hit[1]]))[0])
    return f


def box_truth():
    from features import load_raw

    players, _ = load_raw()
    p = players[players.MIN > 0]
    stats = {"pts": "PTS", "reb": "REB", "ast": "AST", "fg3m": "FG3M"}
    table = {(me.norm_name(n), d, s): v for s, col in stats.items()
             for n, d, v in zip(p.PLAYER_NAME, p.GAME_DATE, p[col])}
    return lambda player, date, stat: table.get((me.norm_name(player), date, stat))


def enough(df: pd.DataFrame) -> bool:
    """The pre-registered minimum. Below it, no scores or coefficients may be shown."""
    return len(df) >= MIN_PROPS and df.date.nunique() >= MIN_DAYS


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--peek", action="store_true", help="print counts only")
    args = ap.parse_args()

    conn = collect_kalshi.connect()
    runs = conn.execute("SELECT COUNT(*), MIN(captured_at), MAX(captured_at) FROM runs").fetchone()
    print(f"collector runs: {runs[0]:,} ({runs[1]} to {runs[2]})")
    df = build_props(conn, d1_model_prob(), box_truth())
    n, days = len(df), df.date.nunique() if len(df) else 0
    print(f"usable liquid props with an outcome: {n:,}  | distinct game dates: {days}  "
          f"| needed: {MIN_PROPS:,} props and {MIN_DAYS} dates")
    if args.peek or not enough(df):
        print("Not enough data yet: no scores shown (pre-registered in PREREG_KALSHI.md)." if not args.peek else "peek: counts only.")
        return
    res = me.evaluate(df, model_weight=0.4, edge_threshold=0.03)
    res["kalshi_close_calibration_slope"] = float(me.LogisticRegression(C=1e6).fit(me.logit(df.p_close.to_numpy()).reshape(-1, 1), df.y).coef_[0][0])
    OUT.mkdir(exist_ok=True)
    (OUT / "kalshi_eval.json").write_text(json.dumps(res, indent=1))
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
