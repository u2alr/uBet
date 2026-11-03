"""Computes the model's chance for each upcoming game and writes it to D1 (migrations 0020, 0021, 0023) for the app to DISPLAY next to the market's.
The model is games-v2 (research/PREREG_GAMES_V2.md): a logistic model on a margin-aware Elo, opponent-adjusted ratings, talent-weighted availability, a common-opponent tally and rest.
It READS THE INJURY REPORT: players ESPN lists as Out who are in a team's rotation are treated as absent, the quantity it was validated on (PREREG_GAMES.md addendums, AVAIL3).
The v1 number is computed too and stored beside it, so the two can be compared on the live stream. Nothing here changes a player-prop probability.

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
import game_eval_v2 as E2  # noqa: E402
import game_features as G  # noqa: E402
import game_features_v2 as V  # noqa: E402
import game_features_v3 as V3  # noqa: E402
import game_features_v4 as V4  # noqa: E402
import human_factors as H  # noqa: E402
from defense_snapshot import ET, inserts, upcoming_games  # noqa: E402
from project import norm_name  # noqa: E402

OUT = HERE / "out"
MODEL_VERSION = "games-v2"


def current_form(t: pd.DataFrame) -> dict[int, dict]:
    """Each team's recent form AS OF NOW (every game played, including the latest)."""
    form = {}
    for tid, g in t.groupby("TEAM_ID"):
        g = g.sort_values("date")
        form[tid] = {"net10": g.net.tail(10).mean() if len(g) >= 5 else None, "off20": g.off.tail(20).mean() if len(g) >= 8 else None, "def20": g["def"].tail(20).mean() if len(g) >= 8 else None}
    return form


def season_review_rows(played: pd.DataFrame, abbr_to_id: dict) -> list[tuple]:
    """What the model would have said before each game already played THIS season: games-v2 fitted on earlier seasons only, features prior-only (the walk-forward the evaluation uses)."""
    to_abbr = {v: k for k, v in abbr_to_id.items()}
    reg = played[played.regular]
    now = int(reg.season.max())
    cur = reg[reg.season == now].sort_values(["date", "GAME_ID"])
    hist = reg[reg.season < now]
    if cur.empty or hist.empty:
        return []
    p, _ = E2.fit_logistic(hist, cur, V.LIN_V2, E2.C_LIN)
    num = lambda v: None if pd.isna(v) else float(v)   # noqa: E731
    return [(pd.Timestamp(r.date).strftime("%Y-%m-%d"), to_abbr.get(r.home_id), to_abbr.get(r.away_id), float(pi), int(r.y), num(r.srs60), num(r.ab_gs), num(r.rest_diff),
             None if pd.isna(r.b2b_home) else int(r.b2b_home), None if pd.isna(r.b2b_away) else int(r.b2b_away))
            for r, pi in zip(cur.itertuples(), p) if to_abbr.get(r.home_id) and to_abbr.get(r.away_id)]


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

    pl, tm = E2.load_all()                                       # 2018-19 onward: the extended history the model was validated with
    miss = pd.DataFrame({"GAME_ID": [], "TEAM_ID": [], "miss_prev": []})
    played = V.build_v2(G.build_games(tm, miss, pl), tm, pl)
    train = played[played.regular]
    train3 = V3.build_v3(played, pl)                             # the SHADOW model's training rows (returning players, PREREG_GAMES_V3.md): stored, never displayed
    train3 = train3[train3.regular]
    train4 = V4.build_v4(played, tm, pl)                         # the SECOND shadow (player importance, PREREG_GAMES_V4.md): stored, never displayed
    train4 = train4[train4.regular]
    t = G._team_games(tm)
    _, rating, last_season = G._elo(t, state=True)
    _, srs_models = V.srs_table(t)
    results = pd.DataFrame({"team": t.TEAM_ID, "opp": t.OPP, "date": t.date, "won": (t.PTS > t.opp_pts)})
    # What the page shows as "common opponents": this season's regular-season games only (not a model input).
    now_season = t[t.GAME_ID.astype(str).str[:1] == "2"]
    now_season = now_season[now_season.season == now_season.season.max()]
    results_now = pd.DataFrame({"team": now_season.TEAM_ID, "opp": now_season.OPP, "date": now_season.date, "won": (now_season.PTS > now_season.opp_pts)})
    last_game = t.groupby("TEAM_ID").date.max()
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

    # For the shadow feature only: anyone on the report, whatever the status, is not assumed to play (a Day-To-Day star back from a long absence must not earn "returning" credit by default).
    listed_ids = {by_name[norm_name(r["player"])] for r in report if norm_name(r["player"]) in by_name}
    prefix = str(int(tm.loc[pd.to_datetime(tm.GAME_DATE).idxmax(), "GAME_ID"]))[:3]
    up = []
    for k, g in enumerate(games):
        gid = int(f"{prefix}97{k:03d}")                          # a game id in the current season's range that no real game has
        up += [{"GAME_ID": gid, "TEAM_ID": abbr_to_id[g["home"]], "date": pd.Timestamp(g["date"]), "game": k}, {"GAME_ID": gid, "TEAM_ID": abbr_to_id[g["away"]], "date": pd.Timestamp(g["date"]), "game": k}]
    up = pd.DataFrame(up)
    ab = G.team_absences(pl.assign(GS=V.game_score(pl)), upcoming=up[["GAME_ID", "TEAM_ID", "date"]], out_ids=out_ids, cross_season=True).set_index(["GAME_ID", "TEAM_ID"])
    rd = V3.roster_delta(pl, upcoming=up[["GAME_ID", "TEAM_ID", "date"]], out_ids=listed_ids).set_index(["GAME_ID", "TEAM_ID"]).rd
    imp = V4.importance(pl, upcoming=up[["GAME_ID", "TEAM_ID", "date"]], out_ids=listed_ids).set_index(["GAME_ID", "TEAM_ID"])
    pairs = pd.DataFrame([{"GAME_ID": int(f"{prefix}97{k:03d}"), "date": pd.Timestamp(g["date"]), "home_id": abbr_to_id[g["home"]], "away_id": abbr_to_id[g["away"]]} for k, g in enumerate(games)])
    co = V.common_opponent(results_now, pairs).set_index("GAME_ID")
    rest = lambda team, day: float(min((day - last_game[team]).days, H.MAX_GAP_DAYS))   # noqa: E731 (rest days as human_factors defines them: the gap since the previous game, capped)

    rows, log = [], []
    now = datetime.now(ET).strftime("%Y-%m-%d %H:%M")
    avg_min = pl.sort_values("GAME_DATE").groupby("PLAYER_ID").tail(10).groupby("PLAYER_ID").MIN.mean()
    for k, g in enumerate(games):
        h, aw = abbr_to_id[g["home"]], abbr_to_id[g["away"]]
        gid = int(f"{prefix}97{k:03d}")
        hv, av = ab.loc[(gid, h)], ab.loc[(gid, aw)]
        day = pd.Timestamp(g["date"])
        cur = V.current_ratings(srs_models, day)
        srs = {k: cur[k][0][h] - cur[k][0][aw] for k in V.HALF_LIVES}
        gap_h, gap_a = (day - last_game[h]).days, (day - last_game[aw]).days
        test = pd.DataFrame({"elo_diff": [rating[h] - rating[aw]], "ab3_min_diff": [hv.ab_min - av.ab_min], "ab3_pts_diff": [hv.ab_pts - av.ab_pts], "ab3_top_home": [hv.ab_top], "ab3_top_away": [av.ab_top],
                             "ab3_n_home": [hv.ab_n], "ab3_n_away": [av.ab_n], "ab_gs": [hv.ab_gs - av.ab_gs], "co_diff": [co.loc[gid, "co_diff"]],
                             "srs30": [srs[30]], "srs60": [srs[60]], "srs120": [srs[120]], "rest_diff": [rest(h, day) - rest(aw, day)],
                             "b2b_home": [1.0 if gap_h == 1 else 0.0], "b2b_away": [1.0 if gap_a == 1 else 0.0]})
        p, _ = E2.fit_logistic(train, test, V.LIN_V2, E2.C_LIN)            # games-v2
        p1, _ = E2.fit_logistic(train, test, E2.V1)                         # games-v1, kept beside it
        psh, _ = E2.fit_logistic(train3, test.assign(rd_diff=[float(rd.loc[(gid, h)] - rd.loc[(gid, aw)])]), V.LIN_V2 + ["rd_diff"], E2.C_LIN)   # shadow: stored, never displayed
        imp_cols = {"star2_diff": [float(imp.star2.loc[(gid, h)] - imp.star2.loc[(gid, aw)])], "top_absent_diff": [float(imp.top_absent.loc[(gid, h)] - imp.top_absent.loc[(gid, aw)])]}
        psh2, _ = E2.fit_logistic(train4, test.assign(**imp_cols), V.LIN_V2 + ["star2_diff", "top_absent_diff"], E2.C_LIN)   # second shadow
        fh, fa = form.get(h, {}), form.get(aw, {})
        names_of = lambda s: "; ".join(f"{label.get(int(i), i)} ({avg_min.get(int(i), 0):.0f} min)" for i in str(s).split(",") if i)   # noqa: E731
        rows.append((g["date"], g["home"], g["away"], float(p[0]), rating[h], rating[aw], fh.get("net10"), fa.get("net10"), fh.get("off20"), fh.get("def20"), fa.get("off20"), fa.get("def20"), now,
                     names_of(hv.ab_ids), names_of(av.ab_ids), MODEL_VERSION, float(p1[0]), float(cur[60][0][h]), float(cur[60][0][aw]), float(srs[60] + cur[60][1]), float(co.loc[gid, "co_diff"]) if co.loc[gid, "co_n"] >= 3 else None))   # a tally off one or two games says nothing
        log.append((g["date"], g["home"], g["away"], now, float(p[0]), g.get("market_home_prob"), g.get("market_book"), MODEL_VERSION, float(p1[0]), float(psh[0]), "lin_v2+returns", float(psh2[0]), "lin_v2+importance"))
    team_names = {n: ab_ for ab_, n in zip(tm.TEAM_ABBREVIATION, tm.TEAM_NAME)}
    inj = [(now, next((k for k, v in team_names.items() if v == r["team"]), r["team"]), r["player"], r["status"], r["note"]) for r in report if r["player"]]
    review = season_review_rows(played, abbr_to_id)
    sql = ["DELETE FROM game_lean;"]
    sql += ["DELETE FROM season_review;"] + inserts("season_review", ["date", "home", "away", "p_home", "home_won", "srs_gap", "talent_diff", "rest_diff", "b2b_home", "b2b_away"], review)
    sql += inserts("game_lean", ["date", "home", "away", "model_home_prob", "elo_home", "elo_away", "home_net10", "away_net10", "home_off20", "home_def20", "away_off20", "away_def20", "as_of", "absent_home", "absent_away", "model_version", "model_v1_prob", "srs_home", "srs_away", "pred_margin", "co_diff"], rows)
    sql += [x.replace("INSERT OR REPLACE", "INSERT OR IGNORE") for x in inserts("game_lean_log", ["date", "home", "away", "as_of", "model_home_prob", "market_home_prob", "market_book", "model_version", "model_v1_prob", "shadow_prob", "shadow_name", "shadow2_prob", "shadow2_name"], log)]
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
