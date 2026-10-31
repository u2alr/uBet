"""Computes the live defensive context for the next games and writes it to D1 (tables from migration 0019) for the app to DISPLAY. Facts only: nothing here changes a probability
(see shared/defense.status.json and PREREG_DEFENSE.md). Uses exactly the point-in-time code the evaluation used (defense_features.add_defense with placeholder rows for games not yet played).

    ingest/.venv/Scripts/python research/defense_snapshot.py [--remote] [--days 2] [--dry]
"""
import argparse
import json
import sqlite3
import subprocess
import sys
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import defense_features as D  # noqa: E402
from features import load_raw  # noqa: E402

OUT = HERE / "out"
CODES = json.loads((ROOT / "shared" / "teamCodes.json").read_text(encoding="utf-8"))["espnToNba"]
ET = ZoneInfo("America/New_York")
METRICS = list(D.TD_METRICS)


def upcoming_games(days: int) -> list[dict]:
    games = []
    for k in range(days):
        day = (datetime.now(ET) + timedelta(days=k)).strftime("%Y%m%d")
        url = f"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates={day}"
        with urllib.request.urlopen(url, timeout=30) as r:
            feed = json.load(r)
        for e in feed.get("events", []):
            if e["status"]["type"]["state"] != "pre":
                continue
            comp = e["competitions"][0]
            side = {c["homeAway"]: CODES.get(c["team"]["abbreviation"], c["team"]["abbreviation"]) for c in comp["competitors"]}
            games.append({"date": datetime.fromisoformat(e["date"].replace("Z", "+00:00")).astimezone(ET).strftime("%Y-%m-%d"), "home": side["home"], "away": side["away"]})
    return games


def sql_value(v):
    if v is None or (isinstance(v, float) and not np.isfinite(v)):
        return "NULL"
    if isinstance(v, (int, np.integer)):
        return str(int(v))
    if isinstance(v, (float, np.floating)):
        return repr(round(float(v), 6))
    return "'" + str(v).replace("'", "''") + "'"


def inserts(table: str, cols: list[str], rows: list[tuple]) -> list[str]:
    out = []
    for i in range(0, len(rows), 100):
        chunk = rows[i:i + 100]
        out.append(f"INSERT OR REPLACE INTO {table} ({', '.join(cols)}) VALUES\n" + ",\n".join("(" + ", ".join(sql_value(v) for v in r) + ")" for r in chunk) + ";")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--remote", action="store_true")
    ap.add_argument("--days", type=int, default=2)
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()

    pl, tm = load_raw()
    pl = pl[pl.MIN > 0].copy()
    pl["date"] = pd.to_datetime(pl.GAME_DATE)
    abbr_to_id = dict(zip(tm.TEAM_ABBREVIATION, tm.TEAM_ID))
    games = upcoming_games(a.days)
    if not games:
        sys.exit("No upcoming games on the schedule; nothing to write.")
    m = D.load_matchups(sqlite3.connect(HERE / "data" / "matchups.sqlite"), tm)
    through = str(m.date.max().date())

    prefix = str(int(tm.GAME_ID.max()))[:3]
    fake = lambda k: int(f"{prefix}99{k:03d}")                           # noqa: E731 - a game id in the current season's range that no real game has
    up = []
    for k, g in enumerate(games):
        for team in (g["home"], g["away"]):
            if team in abbr_to_id:
                up.append({"GAME_ID": fake(k), "TEAM_ID": abbr_to_id[team], "GAME_DATE": g["date"], "OPP_ID": abbr_to_id.get(g["away"] if team == g["home"] else g["home"])})
    up = pd.DataFrame(up).dropna()
    up["OPP_ID"] = up.OPP_ID.astype(int)

    # Offensive players: the team's rotation over its last 10 games, with their last-10 form as of now (the same definitions as the evaluation).
    rows = []
    for _, u in up.iterrows():
        tg = pl[pl.TEAM_ID == u.TEAM_ID]
        last10 = sorted(tg.GAME_ID.unique())[-10:]
        for pid, pg in tg[tg.GAME_ID.isin(last10)].groupby("PLAYER_ID"):
            if len(pg) < 3 or pg.MIN.mean() < 12:
                continue
            hist = pl[pl.PLAYER_ID == pid].sort_values("date").tail(10)
            rows.append({"PLAYER_ID": pid, "GAME_ID": u.GAME_ID, "TEAM_ID": u.TEAM_ID, "OPP_ID": u.OPP_ID, "date": pd.Timestamp(u.GAME_DATE), "n_prior": int((pl.PLAYER_ID == pid).sum()),
                         "min_l10": hist.MIN.mean(), "pts_l10": hist.PTS.mean(), "reb_l10": hist.REB.mean(), "ast_l10": hist.AST.mean(), "fg3m_l10": hist.FG3M.mean(), "name": pg.PLAYER_NAME.iloc[0]})
    dfu = pd.DataFrame(rows)
    out, det = D.add_defense(dfu.drop(columns=["name"]), pl.rename(columns={"MIN": "MIN"}), tm, m, upcoming=up[["GAME_ID", "TEAM_ID", "GAME_DATE"]], detail=True)
    id_abbr = {v: k for k, v in abbr_to_id.items()}
    names = dict(zip(pl.PLAYER_ID, pl.PLAYER_NAME))

    # League context for team defence: a placeholder game for every team, so each team's latest window (including its latest game) is on the same footing.
    allteams = sorted(abbr_to_id.values())
    ph = pd.DataFrame([{"GAME_ID": int(f"{prefix}98{i // 2:03d}"), "TEAM_ID": t, "GAME_DATE": datetime.now(ET).strftime("%Y-%m-%d")} for i, t in enumerate(allteams)])
    td = D.team_defense(pd.concat([tm, ph], ignore_index=True))
    td = td[td.GAME_ID.isin(ph.GAME_ID)].drop_duplicates("TEAM_ID", keep="last").set_index("TEAM_ID")
    team_rows = []
    for t, r in td.iterrows():
        for mname in METRICS:
            v10, vs = r[f"df_td_{mname}_l10"], r[f"df_td_{mname}_s2d"]
            pct = float((td[f"df_td_{mname}_l10"] < v10).mean()) if np.isfinite(v10) else None   # share of teams with a LOWER value
            team_rows.append((id_abbr[t], mname, v10, vs, pct))

    # Individual defenders: league distribution of shrunk quality among defenders with a decent sample, for plain-language labels.
    st = D.state_metrics(D.defender_state(m, pl.rename(columns={"MIN": "min"})))
    cur = st.sort_values("date").groupby("def_id").tail(1)
    sample = cur[cur.expo >= 0.5].dpoe100
    meta = {"as_of": datetime.now(ET).strftime("%Y-%m-%d %H:%M"), "matchups_through": through, "dpoe_mean": float(sample.mean()), "dpoe_sd": float(sample.std()), "defenders_rated": int(len(sample)),
            "games_with_matchups": int(m.GAME_ID.nunique())}

    mu = out[["PLAYER_ID", "GAME_ID", "df_mu_conf", "df_mu_herf", "df_mu_direct"]].set_index(["PLAYER_ID", "GAME_ID"])
    mrows = []
    for (pid, gid), grp in det.groupby(["PLAYER_ID", "GAME_ID"]):
        opp = id_abbr.get(int(grp.OPP_ID.iloc[0]))
        top = grp.sort_values("wt", ascending=False).head(3)
        s = mu.loc[(pid, gid)]
        for rank, (_, d) in enumerate(top.iterrows(), 1):
            mrows.append((int(pid), names.get(pid, ""), opp, rank, int(d.def_id), names.get(int(d.def_id), ""), d.wt, d.dpoe100, d.foul100, d.expo, d.c_dir, d.role,
                          s.df_mu_conf, s.df_mu_herf, s.df_mu_direct))
    sql = ["DELETE FROM defense_team;", "DELETE FROM defense_matchup;", "DELETE FROM defense_meta;"]
    sql += inserts("defense_team", ["team", "metric", "value_l10", "value_s2d", "pct_l10"], team_rows)
    sql += inserts("defense_matchup", ["player_id", "player", "opp", "rank", "defender_id", "defender", "weight", "dpoe100", "foul100", "expo", "direct_poss", "role", "conf", "herf", "direct"], mrows)
    sql += inserts("defense_meta", ["key", "value"], [(k, str(v)) for k, v in meta.items()])
    OUT.mkdir(exist_ok=True)
    f = OUT / "defense.sql"
    f.write_text("\n".join(sql), encoding="utf-8")
    print(f"{len(games)} upcoming games, {len(team_rows)} team metrics, {len(mrows)} matchup rows, matchup data through {through} -> {f}")
    if a.dry:
        return
    subprocess.run(["npx", "wrangler", "d1", "execute", "ubet", "--remote" if a.remote else "--local", "--file", str(f)], cwd=ROOT, shell=True, check=True)


if __name__ == "__main__":
    main()
