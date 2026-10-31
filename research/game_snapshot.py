"""Computes the model's chance for each upcoming game and writes it to D1 (migrations 0020, 0021) for the app to DISPLAY next to the market's. A rating-based view that READS THE INJURY
REPORT: players ESPN lists as Out who are in a team's rotation are treated as absent, exactly the quantity the model was validated on (research/PREREG_GAMES.md addendum, AVAIL2).
Nothing here changes a player-prop probability.

    ingest/.venv/Scripts/python research/game_snapshot.py [--remote] [--days 2] [--dry]
"""
import argparse
import json
import subprocess
import sys
import urllib.request
from datetime import datetime
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import game_features as G  # noqa: E402
from defense_snapshot import ET, inserts, upcoming_games  # noqa: E402
from features import load_raw  # noqa: E402
from game_eval import fit_predict  # noqa: E402
from project import norm_name  # noqa: E402

OUT = HERE / "out"
COLS = G.BASE + G.GROUPS["AVAIL2"]


def current_form(t: pd.DataFrame) -> dict[int, dict]:
    """Each team's recent form AS OF NOW (every game played, including the latest)."""
    form = {}
    for tid, g in t.groupby("TEAM_ID"):
        g = g.sort_values("date")
        form[tid] = {"net10": g.net.tail(10).mean() if len(g) >= 5 else None, "off20": g.off.tail(20).mean() if len(g) >= 8 else None, "def20": g["def"].tail(20).mean() if len(g) >= 8 else None}
    return form


def injury_report() -> list[dict]:
    """Every Out / Doubtful / Questionable entry ESPN lists right now: {team name, player, status, note}. Empty when the feed cannot be read (then no player is treated as absent)."""
    try:
        with urllib.request.urlopen("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries", timeout=30) as r:
            feed = json.load(r)
    except Exception as e:  # noqa: BLE001
        print(f"  injury report unavailable ({e}); no player is treated as absent")
        return []
    rows = []
    for team in feed.get("injuries", []):
        for i in team.get("injuries", []):
            rows.append({"team": team.get("displayName", ""), "player": i.get("athlete", {}).get("displayName", ""), "status": str(i.get("status", "")), "note": str(i.get("shortComment", ""))[:200]})
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--remote", action="store_true")
    ap.add_argument("--days", type=int, default=2)
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()

    pl, tm = load_raw()
    miss = pd.read_pickle(OUT / "features.pkl")[["GAME_ID", "TEAM_ID", "miss_prev"]].drop_duplicates(["GAME_ID", "TEAM_ID"])
    played = G.build_games(tm, miss, pl)
    train = played[played.regular]
    t = G._team_games(tm)
    _, rating, last_season = G._elo(t, state=True)
    season_now = int(t.season.max())
    for team in list(rating):                                   # a team whose last game was in an earlier season carries over before its first game of the new one
        if last_season[team] != season_now:
            rating[team] = G.ELO_START + G.ELO_CARRY * (rating[team] - G.ELO_START)
    abbr_to_id = dict(zip(tm.TEAM_ABBREVIATION, tm.TEAM_ID))
    form = current_form(t)
    games = [g for g in upcoming_games(a.days) if abbr_to_id.get(g["home"]) in rating and abbr_to_id.get(g["away"]) in rating]
    if not games:
        sys.exit("No upcoming games on the schedule; nothing to write.")

    # Who the report says is out, matched to our player ids by name.
    names = pl.dropna(subset=["PLAYER_NAME"]).drop_duplicates("PLAYER_ID", keep="last")
    by_name = {norm_name(n): int(i) for n, i in zip(names.PLAYER_NAME, names.PLAYER_ID)}
    label = dict(zip(names.PLAYER_ID.astype(int), names.PLAYER_NAME))
    report = injury_report()
    out_ids = {by_name[norm_name(r["player"])] for r in report if "out" in r["status"].lower() and norm_name(r["player"]) in by_name}

    prefix = str(int(tm.loc[pd.to_datetime(tm.GAME_DATE).idxmax(), "GAME_ID"]))[:3]
    up = []
    for k, g in enumerate(games):
        gid = int(f"{prefix}97{k:03d}")                          # a game id in the current season's range that no real game has
        up += [{"GAME_ID": gid, "TEAM_ID": abbr_to_id[g["home"]], "date": pd.Timestamp(g["date"]), "game": k}, {"GAME_ID": gid, "TEAM_ID": abbr_to_id[g["away"]], "date": pd.Timestamp(g["date"]), "game": k}]
    up = pd.DataFrame(up)
    ab = G.team_absences(pl, upcoming=up[["GAME_ID", "TEAM_ID", "date"]], out_ids=out_ids).set_index(["GAME_ID", "TEAM_ID"])

    rows, log = [], []
    now = datetime.now(ET).strftime("%Y-%m-%d %H:%M")
    avg_min = pl.sort_values("GAME_DATE").groupby("PLAYER_ID").tail(10).groupby("PLAYER_ID").MIN.mean()
    for k, g in enumerate(games):
        h, aw = abbr_to_id[g["home"]], abbr_to_id[g["away"]]
        gid = int(f"{prefix}97{k:03d}")
        hv, av = ab.loc[(gid, h)], ab.loc[(gid, aw)]
        test = pd.DataFrame({"elo_diff": [rating[h] - rating[aw]], "ab_min_diff": [hv.ab_min - av.ab_min], "ab_pts_diff": [hv.ab_pts - av.ab_pts], "ab_top_home": [hv.ab_top], "ab_top_away": [av.ab_top],
                             "ab_n_home": [hv.ab_n], "ab_n_away": [av.ab_n]})
        p, _ = fit_predict(train, test, COLS)
        fh, fa = form.get(h, {}), form.get(aw, {})
        names_of = lambda s: "; ".join(f"{label.get(int(i), i)} ({avg_min.get(int(i), 0):.0f} min)" for i in str(s).split(",") if i)   # noqa: E731
        rows.append((g["date"], g["home"], g["away"], float(p[0]), rating[h], rating[aw], fh.get("net10"), fa.get("net10"), fh.get("off20"), fh.get("def20"), fa.get("off20"), fa.get("def20"), now,
                     names_of(hv.ab_ids), names_of(av.ab_ids)))
        log.append((g["date"], g["home"], g["away"], now, float(p[0]), g.get("market_home_prob"), g.get("market_book")))
    team_names = {n: ab_ for ab_, n in zip(tm.TEAM_ABBREVIATION, tm.TEAM_NAME)}
    inj = [(now, next((k for k, v in team_names.items() if v == r["team"]), r["team"]), r["player"], r["status"], r["note"]) for r in report if r["player"]]
    sql = ["DELETE FROM game_lean;"]
    sql += inserts("game_lean", ["date", "home", "away", "model_home_prob", "elo_home", "elo_away", "home_net10", "away_net10", "home_off20", "home_def20", "away_off20", "away_def20", "as_of", "absent_home", "absent_away"], rows)
    sql += [x.replace("INSERT OR REPLACE", "INSERT OR IGNORE") for x in inserts("game_lean_log", ["date", "home", "away", "as_of", "model_home_prob", "market_home_prob", "market_book"], log)]
    sql += [x.replace("INSERT OR REPLACE", "INSERT OR IGNORE") for x in inserts("injury_log", ["as_of", "team", "player", "status", "note"], inj)]
    OUT.mkdir(exist_ok=True)
    f = OUT / "game_lean.sql"
    f.write_text("\n".join(sql), encoding="utf-8")
    print(f"{len(rows)} games scored ({len(out_ids)} listed-Out players matched to ids, {len(train):,} training games); market price for {sum(1 for l in log if l[5] is not None)} -> {f}")
    if a.dry:
        return
    subprocess.run(["npx", "wrangler", "d1", "execute", "ubet", "--remote" if a.remote else "--local", "--file", str(f)], cwd=ROOT, shell=True, check=True)


if __name__ == "__main__":
    main()
