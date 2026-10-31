"""Computes the model's chance for each upcoming game and writes it to D1 (migration 0020) for the app to DISPLAY next to the market's. Facts and a rating-based view only:
nothing here changes a player-prop probability. The model is the one research/PREREG_GAMES.md selected (shared/games.status.json says which).

    ingest/.venv/Scripts/python research/game_snapshot.py [--remote] [--days 2] [--dry]
"""
import argparse
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import game_features as G  # noqa: E402
from defense_snapshot import ET, inserts, upcoming_games  # noqa: E402
from features import load_raw  # noqa: E402
from game_eval import fit_predict  # noqa: E402

OUT = HERE / "out"


def current_form(t: pd.DataFrame) -> dict[int, dict]:
    """Each team's recent form AS OF NOW (every game played, including the latest)."""
    form = {}
    for tid, g in t.groupby("TEAM_ID"):
        g = g.sort_values("date")
        form[tid] = {"net10": g.net.tail(10).mean() if len(g) >= 5 else None, "off20": g.off.tail(20).mean() if len(g) >= 8 else None, "def20": g["def"].tail(20).mean() if len(g) >= 8 else None}
    return form


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--remote", action="store_true")
    ap.add_argument("--days", type=int, default=2)
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()

    _, tm = load_raw()
    miss = pd.read_pickle(OUT / "features.pkl")[["GAME_ID", "TEAM_ID", "miss_prev"]].drop_duplicates(["GAME_ID", "TEAM_ID"])
    played = G.build_games(tm, miss)
    train = played[played.regular]
    t = G._team_games(tm)
    _, rating, last_season = G._elo(t, state=True)
    season_now = int(t.season.max())
    for team in list(rating):                                   # a team whose last game was in an earlier season carries over before its first game of the new one
        if last_season[team] != season_now:
            rating[team] = G.ELO_START + G.ELO_CARRY * (rating[team] - G.ELO_START)
    abbr_to_id = dict(zip(tm.TEAM_ABBREVIATION, tm.TEAM_ID))
    form = current_form(t)
    games = upcoming_games(a.days)
    if not games:
        sys.exit("No upcoming games on the schedule; nothing to write.")

    rows, log = [], []
    now = datetime.now(ET).strftime("%Y-%m-%d %H:%M")
    for g in games:
        h, aw = abbr_to_id.get(g["home"]), abbr_to_id.get(g["away"])
        if h is None or aw is None or h not in rating or aw not in rating:
            continue
        test = pd.DataFrame({"elo_diff": [rating[h] - rating[aw]]})
        p, _ = fit_predict(train, test, G.BASE)
        fh, fa = form.get(h, {}), form.get(aw, {})
        rows.append((g["date"], g["home"], g["away"], float(p[0]), rating[h], rating[aw], fh.get("net10"), fa.get("net10"), fh.get("off20"), fh.get("def20"), fa.get("off20"), fa.get("def20"), now))
        log.append((g["date"], g["home"], g["away"], now, float(p[0]), g.get("market_home_prob"), g.get("market_book")))
    sql = ["DELETE FROM game_lean;"]
    sql += inserts("game_lean", ["date", "home", "away", "model_home_prob", "elo_home", "elo_away", "home_net10", "away_net10", "home_off20", "home_def20", "away_off20", "away_def20", "as_of"], rows)
    sql += [s.replace("INSERT OR REPLACE", "INSERT OR IGNORE") for s in inserts("game_lean_log", ["date", "home", "away", "as_of", "model_home_prob", "market_home_prob", "market_book"], log)]
    OUT.mkdir(exist_ok=True)
    f = OUT / "game_lean.sql"
    f.write_text("\n".join(sql), encoding="utf-8")
    print(f"{len(rows)} games scored with {len(train):,} training games; market price for {sum(1 for l in log if l[5] is not None)} -> {f}")
    if a.dry:
        return
    subprocess.run(["npx", "wrangler", "d1", "execute", "ubet", "--remote" if a.remote else "--local", "--file", str(f)], cwd=ROOT, shell=True, check=True)


if __name__ == "__main__":
    main()
