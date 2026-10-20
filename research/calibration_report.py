"""How good are the numbers the app actually showed? Grades the app's own frozen picks (the `predictions` table).

    ingest/.venv/Scripts/python research/calibration_report.py            # local database
    ingest/.venv/Scripts/python research/calibration_report.py --peek     # counts only

Each pick was logged BEFORE its game with the price and probability the user saw (INSERT OR IGNORE keeps the first
version), and graded afterwards from the box score. That makes this the honest test: nothing is fitted afterwards.

What it can and cannot say
- It measures the quality of the SHOWN numbers on SELECTED picks (the ones with positive expected value or high chance).
  Selecting on a model's disagreement with the market favours the model's mistakes (winner's curse), so a poor result here
  is expected to look worse than the model's average quality, and a good one is meaningful.
- Pushes (refunds) are excluded from calibration; they are included in profit as 0.
- Only picks logged after migration 0009 carry the model and market components and the refund-aware probabilities.
  Earlier rows are 'legacy' and are excluded unless --include-legacy.
- Below MIN_PICKS graded picks over MIN_DATES game dates it prints counts only, so small samples cannot be mistaken for evidence.
"""
import argparse
import glob
import sqlite3
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
MIN_PICKS, MIN_DATES = 300, 15
N_BOOT = 1000


def load(include_legacy: bool = False) -> pd.DataFrame:
    best, size = None, -1
    for f in glob.glob(str(ROOT / ".wrangler" / "state" / "v3" / "d1" / "**" / "*.sqlite"), recursive=True):
        c = sqlite3.connect(f)
        try:
            n = c.execute("SELECT COUNT(*) FROM predictions").fetchone()[0]
            if n > size:
                best, size = f, n
        except sqlite3.Error:
            pass
        c.close()
    if best is None:
        sys.exit("No local database with a predictions table found.")
    c = sqlite3.connect(best)
    df = pd.read_sql_query(
        "SELECT id, player_id, stat, line, side, price, game_date, p_over, model, model_prob, market_prob, push, actual, hit "
        "FROM predictions WHERE side IS NOT NULL", c)
    c.close()
    df["legacy"] = df.model_prob.isna()
    return df if include_legacy else df[~df.legacy].copy()


def prepare(df: pd.DataFrame) -> pd.DataFrame:
    """Probability that the chosen side won (given no refund), the outcome, and the profit of a 1-unit bet."""
    g = df[df.hit.notna()].copy()
    g["p_side"] = np.where(g.side == "over", g.p_over, 1 - g.p_over)
    g["win"] = (g.hit == 1).astype(float)
    g["profit"] = np.select([g.hit == 1, g.hit == 0], [g.price - 1, -1.0], default=0.0)
    g["week"] = pd.to_datetime(g.game_date).dt.to_period("W").astype(str)
    return g


def enough(g: pd.DataFrame) -> bool:
    decided = g[g.hit.isin([0, 1])]
    return len(decided) >= MIN_PICKS and decided.game_date.nunique() >= MIN_DATES


def scores(p: np.ndarray, y: np.ndarray) -> dict:
    p = np.clip(p, 1e-4, 1 - 1e-4)
    return {"brier": float(np.mean((p - y) ** 2)), "logloss": float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))}


def calibration_bins(p: np.ndarray, y: np.ndarray, bins: int = 8) -> list[dict]:
    edges = np.quantile(p, np.linspace(0, 1, bins + 1))
    edges[-1] += 1e-9
    idx = np.clip(np.searchsorted(edges, p, side="right") - 1, 0, bins - 1)
    return [{"n": int((idx == b).sum()), "predicted": float(p[idx == b].mean()), "observed": float(y[idx == b].mean())}
            for b in range(bins) if (idx == b).sum() >= 10]


def week_ci(g: pd.DataFrame, fn, seed: int = 0) -> tuple[float, float, float]:
    """Point estimate and 95% interval, resampling whole calendar weeks (picks in a week are dependent)."""
    rng = np.random.default_rng(seed)
    parts = [x for _, x in g.groupby("week")]
    out = [fn(pd.concat([parts[i] for i in rng.integers(0, len(parts), len(parts))])) for _ in range(N_BOOT)]
    return float(fn(g)), float(np.percentile(out, 2.5)), float(np.percentile(out, 97.5))


def report(g: pd.DataFrame) -> dict:
    d = g[g.hit.isin([0, 1])]
    y, p = d.win.to_numpy(), d.p_side.to_numpy()
    res = {"n_graded": int(len(g)), "n_decided": int(len(d)), "pushes": int((g.hit == 2).sum()), "dates": int(d.game_date.nunique()),
           "shown": scores(p, y), "win_rate": float(y.mean()), "mean_predicted": float(p.mean())}
    # How well did each ingredient do on the same picks?
    both = d[d.market_prob.notna()]
    if len(both) >= 50:
        side_market = both.market_prob.to_numpy()
        res["on_picks_with_a_market"] = {
            "n": int(len(both)),
            "model_alone": scores(both.model_prob.to_numpy(), both.win.to_numpy()),
            "market_alone": scores(side_market, both.win.to_numpy()),
            "blend_shown": scores(both.p_side.to_numpy(), both.win.to_numpy()),
        }
    # Do the expected values the app displayed show up as profit?
    expected = (1 - d.push.fillna(0)) * (d.p_side * d.price - 1)
    res["expected_profit_per_bet"] = float(expected.mean())
    res["realised_profit_per_bet"] = week_ci(d.assign(profit=d.profit), lambda x: x.profit.mean())
    res["calibration"] = calibration_bins(p, y)
    res["by_model"] = {m: {"n": int(len(x)), "win_rate": float(x.win.mean()), "mean_predicted": float(x.p_side.mean())} for m, x in d.groupby("model")}
    return res


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--peek", action="store_true")
    ap.add_argument("--include-legacy", action="store_true")
    args = ap.parse_args()
    everything = load(include_legacy=True)
    raw = everything if args.include_legacy else everything[~everything.legacy]
    g = prepare(raw)
    decided = g[g.hit.isin([0, 1])]
    legacy = int(everything.legacy.sum())
    if legacy and not args.include_legacy:
        print(f"{legacy:,} older picks are excluded: they were logged before the refund-aware probabilities and the model/market components existed")
    print(f"logged picks: {len(raw):,}  | graded: {len(g):,}  | decided (not refunded): {len(decided):,}  | game dates: {decided.game_date.nunique()}")
    print(f"needed before any score is shown: {MIN_PICKS} decided picks over {MIN_DATES} game dates")
    if args.peek or not enough(g):
        print("Not enough graded picks yet: no scores shown." if not args.peek else "peek: counts only.")
        return
    res = report(g)
    import json
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
