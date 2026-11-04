"""Pre-registered live test (PREREG_MARKET_GAMES.md): does the game model carry information the sportsbook price does not?

    ingest/.venv/Scripts/python research/market_games_report.py [path to the local D1 folder]

Only games with a stored market price count. For each, the number stored before tip-off (game_lean_log, newest on or before the game date) is scored by log loss:
  market      the books' no-margin chance
  model       games-v2 alone
  blend       what the site shows: 30% model, 70% market (shared/baseline.ts MODEL_WEIGHT)
H1 = blend beats market; H2 = model alone beats market. "Beats" means the paired improvement in log loss has a 95% interval (resampled by game day) entirely above 0, with at least
NEEDED priced games. Below that the script says "too early" and states no verdict. Nothing here changes a displayed number, and nothing here says a bet makes money.
"""
import sqlite3
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import shadow_report as S  # noqa: E402

NEEDED = 300
MODEL_WEIGHT = 0.3          # shared/baseline.ts MODEL_WEIGHT: the blend the site shows
BOOT = 4000


def _ll(y: np.ndarray, p: np.ndarray) -> np.ndarray:
    p = np.clip(p, S.EPS, 1 - S.EPS)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def _interval(d: np.ndarray, days: np.ndarray, rng) -> tuple[float, float]:
    """95% interval of the mean of `d`, resampling whole game days (games on one night are not independent)."""
    wk = pd.Series(d).groupby(days).agg(["sum", "count"])
    s, c = wk["sum"].to_numpy(), wk["count"].to_numpy()
    idx = rng.integers(0, len(s), size=(BOOT, len(s)))
    st = s[idx].sum(1) / c[idx].sum(1)
    return float(np.percentile(st, 2.5)), float(np.percentile(st, 97.5))


def evaluate(log: pd.DataFrame, results: pd.DataFrame, rng=None) -> dict:
    g = S.latest_before_tipoff(log).merge(results, on=["date", "home", "away"], how="inner")
    g = g[g.market_home_prob.notna() & g.model_home_prob.notna()]
    out = {"games": int(len(g)), "needed": NEEDED, "verdict": None}
    if g.empty:
        out["note"] = "No finished game has both a stored model number and a stored market price yet."
        return out
    rng = rng or np.random.default_rng(0)
    y = g.home_won.to_numpy(float)
    m = g.market_home_prob.to_numpy(float)
    p = g.model_home_prob.to_numpy(float)
    b = MODEL_WEIGHT * p + (1 - MODEL_WEIGHT) * m
    days = g.date.to_numpy()
    lm, lp, lb = _ll(y, m), _ll(y, p), _ll(y, b)
    out["logloss"] = {"market": float(lm.mean()), "model": float(lp.mean()), "blend": float(lb.mean())}
    for name, l in (("H1_blend_vs_market", lb), ("H2_model_vs_market", lp)):
        d = lm - l                                  # positive: this beats the market
        lo, hi = _interval(d, days, rng)
        out[name] = {"improvement": float(d.mean()), "lo": lo, "hi": hi}
    if out["games"] < NEEDED:
        out["note"] = f"Too early to conclude anything: {NEEDED - out['games']} more priced games are needed."
        return out
    h1 = out["H1_blend_vs_market"]
    out["verdict"] = ("The blend beat the market on these games: the improvement is larger than chance." if h1["lo"] > 0
                      else "The blend was worse than the market alone on these games: the gap is larger than chance." if h1["hi"] < 0
                      else "No difference from the market that you could tell from luck.")
    return out


def main():
    from game_eval_v2 import load_all
    folder = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / ".wrangler" / "state" / "v3" / "d1" / "miniflare-D1DatabaseObject")
    log = None
    for f in sorted(folder.glob("*.sqlite")):
        if f.name.startswith("metadata"):
            continue
        db = sqlite3.connect(f)
        if db.execute("select 1 from sqlite_master where name = 'game_lean_log'").fetchone():
            log = pd.read_sql_query("select * from game_lean_log", db)
            break
    if log is None or log.empty:
        sys.exit("No game_lean_log rows. It fills each time research/game_snapshot.py runs.")
    _, tm = load_all()
    r = evaluate(log, S.home_results(tm))
    print(f"{r['games']} finished games have both a stored model number and a stored market price (the rule needs {NEEDED}).")
    if "logloss" in r and r["games"] >= NEEDED:         # below the minimum nothing is printed: a number on a handful of games invites a verdict the rule does not allow
        ll = r["logloss"]
        print(f"  log loss: market {ll['market']:.4f}   model {ll['model']:.4f}   blend {ll['blend']:.4f}   (lower is better)")
        for k in ("H1_blend_vs_market", "H2_model_vs_market"):
            x = r[k]
            print(f"  {k}: improvement over the market {x['improvement']:+.4f}  95% [{x['lo']:+.4f}, {x['hi']:+.4f}]")
    print(r.get("note") or r["verdict"])
    print("This says nothing about whether a bet makes money: closing prices here are the last stored price on or before game day, not a true closing line.")


if __name__ == "__main__":
    main()
