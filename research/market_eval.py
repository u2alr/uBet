"""Does the model know anything the sportsbooks don't?  Run on historical lines from backfill_odds.py.

    ingest/.venv/Scripts/python research/market_eval.py --season 2025-26

Inputs: raw snapshot JSON (research/data/odds_hist/<season>/*.json) + box-score truth (out/features.pkl).
For each prop (player, stat, line) we have two snapshots, "open" (about 3h before tip) and "close"
(about 20 min before). Everything is scored out of sample: the model for season S is trained on seasons < S.

Outputs
- log loss / Brier of the closing market, the model, and a fitted blend of the two
- the blend regression: y ~ a + b*logit(market) + c*logit(model), with 95% CIs from resampling calendar weeks.
  c > 0 with a CI above 0 would mean the model carries information the closing line lacks.
- closing line value (CLV) and realised ROI of a fixed-rule betting policy at the early prices
"""
import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression

sys.path.insert(0, str(Path(__file__).resolve().parent))
from devig import METHODS  # noqa: E402

DATA = Path(__file__).resolve().parent / "data"
OUT = Path(__file__).resolve().parent / "out"
MARKET_STAT = {"player_points": "pts", "player_rebounds": "reb", "player_assists": "ast", "player_threes": "fg3m"}
OPEN_MIN, CLOSE_MIN = 180, 20
N_BOOT = 1000


def norm_name(s: str) -> str:
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    s = re.sub(r"[^a-z ]", "", s)
    s = re.sub(r"\b(jr|sr|ii|iii|iv)\b", "", s)
    return re.sub(r"\s+", " ", s).strip()


def logit(p):
    p = np.clip(p, 1e-4, 1 - 1e-4)
    return np.log(p / (1 - p))


# ---------- parsing ----------

def parse_snapshot(path: Path) -> list[dict]:
    """One raw snapshot file -> one row per (book, player, stat, line) with both sides' prices."""
    j = json.loads(path.read_text())
    ev, meta = j["data"], j["_request"]
    rows = []
    for b in ev.get("bookmakers", []):
        for m in b["markets"]:
            stat = MARKET_STAT.get(m["key"])
            if not stat:
                continue
            sides: dict[tuple, dict] = {}
            for o in m["outcomes"]:
                sides.setdefault((o["description"], o["point"]), {})[o["name"]] = o["price"]
            for (player, point), s in sides.items():
                if "Over" in s and "Under" in s:
                    rows.append(dict(event_id=ev["id"], commence=ev["commence_time"], minutes=meta["minutes_before_tip"],
                                     book=b["key"], player=player, stat=stat, line=point, over=s["Over"], under=s["Under"]))
    return rows


def consensus(rows: pd.DataFrame, method: str = "power") -> pd.DataFrame:
    """Per (event, minutes, player, stat, line): de-vigged P(over) averaged over books, plus the best prices."""
    devig = METHODS[method]
    rows = rows.copy()
    rows["p_over"] = [devig([o, u])[0] for o, u in zip(rows.over, rows.under)]
    g = rows.groupby(["event_id", "commence", "minutes", "player", "stat", "line"])
    return g.agg(p_over=("p_over", "mean"), best_over=("over", "max"), best_under=("under", "max"), books=("book", "nunique")).reset_index()


def to_props(cons: pd.DataFrame) -> pd.DataFrame:
    """Pair each prop's open and close snapshot (same player/stat/line) into one row."""
    key = ["event_id", "commence", "player", "stat", "line"]
    o = cons[cons.minutes == OPEN_MIN].drop(columns="minutes").rename(
        columns={"p_over": "p_open", "best_over": "open_over", "best_under": "open_under", "books": "books_open"})
    c = cons[cons.minutes == CLOSE_MIN].drop(columns="minutes").rename(
        columns={"p_over": "p_close", "best_over": "close_over", "best_under": "close_under", "books": "books_close"})
    return o.merge(c, on=key, how="inner")


# ---------- evaluation (pure functions on a props frame) ----------
# Required columns: week, y (1 if over), p_close, p_model, and for betting: p_open, open_over, open_under.

def scores(y, p) -> dict:
    p = np.clip(p, 1e-4, 1 - 1e-4)
    return {"logloss": float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))), "brier": float(np.mean((p - y) ** 2))}


def fit_blend(df: pd.DataFrame):
    X = np.column_stack([logit(df.p_close.to_numpy()), logit(df.p_model.to_numpy())])
    m = LogisticRegression(C=1e6, max_iter=1000).fit(X, df.y.to_numpy())
    return m.intercept_[0], m.coef_[0][0], m.coef_[0][1]


def week_boot(df: pd.DataFrame, stat_fn, seed: int = 0) -> np.ndarray:
    """Resample whole calendar weeks (props within a week are dependent) and recompute a statistic."""
    rng = np.random.default_rng(seed)
    parts = [g for _, g in df.groupby("week")]
    out = []
    for _ in range(N_BOOT):
        pick = rng.integers(0, len(parts), len(parts))
        out.append(stat_fn(pd.concat([parts[i] for i in pick], ignore_index=True)))
    return np.array(out)


def evaluate(df: pd.DataFrame, model_weight: float = 0.4, edge_threshold: float = 0.03) -> dict:
    res = {"n": len(df), "market_close": scores(df.y, df.p_close), "model": scores(df.y, df.p_model)}
    a, b, c = fit_blend(df)
    blend_p = 1 / (1 + np.exp(-(a + b * logit(df.p_close.to_numpy()) + c * logit(df.p_model.to_numpy()))))
    res["blend_in_sample"] = scores(df.y, blend_p)
    wb = week_boot(df, lambda g: fit_blend(g)[2])
    res["blend"] = {"intercept": a, "market_coef": b, "model_coef": c,
                    "model_coef_ci": [float(np.percentile(wb, 2.5)), float(np.percentile(wb, 97.5))]}
    # Closing-line value of a fixed policy at the EARLY prices: weights are fixed, not fitted, so no leakage.
    p_mix = (1 - model_weight) * df.p_open.to_numpy() + model_weight * df.p_model.to_numpy()
    ev_over, ev_under = p_mix * df.open_over.to_numpy() - 1, (1 - p_mix) * df.open_under.to_numpy() - 1
    take_over = (ev_over >= edge_threshold) & (ev_over >= ev_under)
    take_under = (ev_under >= edge_threshold) & (ev_under > ev_over)
    bet = take_over | take_under
    if bet.sum():
        price = np.where(take_over, df.open_over, df.open_under)[bet]
        q_close = np.where(take_over, df.p_close, 1 - df.p_close)[bet]
        won = np.where(take_over, df.y, 1 - df.y)[bet]
        clv = q_close * price - 1  # expected return at the fair closing probability
        roi = won * price - 1
        sub = df[bet].assign(_clv=clv, _roi=roi).reset_index(drop=True)
        cb = week_boot(sub, lambda g: g._clv.mean())
        rb = week_boot(sub, lambda g: g._roi.mean())
        res["policy"] = {"bets": int(bet.sum()), "clv_mean": float(clv.mean()),
                         "clv_ci": [float(np.percentile(cb, 2.5)), float(np.percentile(cb, 97.5))],
                         "roi_mean": float(roi.mean()), "roi_ci": [float(np.percentile(rb, 2.5)), float(np.percentile(rb, 97.5))]}
    else:
        res["policy"] = {"bets": 0}
    return res


# ---------- joining to truth and the model (needs real data) ----------

def build_props(season: str) -> pd.DataFrame:
    folder = DATA / "odds_hist" / season
    files = sorted(folder.glob("*.json"))
    if not files:
        sys.exit(f"No snapshots in {folder}. Run research/backfill_odds.py on a paid plan first.")
    rows = pd.DataFrame([r for f in files for r in parse_snapshot(f)])
    props = to_props(consensus(rows))
    props["date"] = pd.to_datetime(props.commence).dt.tz_convert("America/New_York").dt.tz_localize(None).dt.normalize()
    props["key"] = props.player.map(norm_name)
    return props


def attach_truth_and_model(props: pd.DataFrame, season: str) -> pd.DataFrame:
    from features import FEATURES
    from models import HGB, Dispersion, nb_p_over
    from sklearn.ensemble import HistGradientBoostingRegressor

    start = int(season[:4])
    df = pd.read_pickle(OUT / "features.pkl")
    df["key"] = df.PLAYER_NAME.map(norm_name)
    ok = (df.n_prior >= 5) & df["pts_l10"].notna()
    train = df[ok & (df.season < start)].sort_values("date")
    cut = int(len(train) * 0.8)
    pieces = []
    for stat, sub in props.groupby("stat"):
        rows = df[ok & (df.season == start)][["key", "date", stat] + FEATURES]
        m = sub.merge(rows, on=["key", "date"], how="inner")
        if m.empty:
            continue
        probe = HistGradientBoostingRegressor(loss="poisson", **HGB).fit(train.iloc[:cut][FEATURES], train.iloc[:cut][stat])
        disp = Dispersion().fit(probe.predict(train.iloc[cut:][FEATURES]), train.iloc[cut:][stat].to_numpy(float))
        final = HistGradientBoostingRegressor(loss="poisson", **HGB).fit(train[FEATURES], train[stat])
        mu = final.predict(m[FEATURES])
        m["p_model"] = nb_p_over(m.line.to_numpy(float), mu, disp.alpha(mu))
        m["actual"] = m[stat]
        pieces.append(m[list(sub.columns) + ["p_model", "actual"]])
    out = pd.concat(pieces, ignore_index=True)
    out = out[out.actual != out.line]  # pushes carry no information
    out["y"] = (out.actual > out.line).astype(float)
    out["week"] = out.date.dt.to_period("W").astype(str)
    return out


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", default="2025-26")
    args = ap.parse_args()
    df = attach_truth_and_model(build_props(args.season), args.season)
    print(f"{len(df):,} props with closing line, early line, model and outcome")
    res = evaluate(df)
    (OUT / "market_eval.json").write_text(json.dumps(res, indent=1))
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
