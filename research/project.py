"""Project every rotation player's next game with the boosted model and store it in D1.

    ingest/.venv/Scripts/python research/project.py            # local D1
    ingest/.venv/Scripts/python research/project.py --remote   # production D1

Steps: refresh the raw league logs, fetch the upcoming schedule (ESPN), add one placeholder row per rostered
player per upcoming game (the features use only earlier games, so the placeholder's own values never matter),
train on everything played so far, and write the projected mean plus a fitted dispersion per player/stat.
The Worker (functions/api) turns those into P(over line) with a negative binomial.

Weakness, stated in PREREG.md: who is injured is approximated from past appearances only.
"""
import argparse
import datetime as dt
import json
import re
import unicodedata
import subprocess
import sys
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
from nba_api.stats.endpoints import commonallplayers
from nba_api.stats.static import teams as nba_teams
from sklearn.ensemble import HistGradientBoostingRegressor

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pull_raw  # noqa: E402
from features import FEATURES, STATS, build, load_raw  # noqa: E402
from models import HGB, Dispersion  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(__file__).resolve().parent / "out"
MODEL = "gbm-v1"
DUMMY_BASE = 900_000_000  # placeholder GAME_IDs; real ones are 8 digits
ET = ZoneInfo("America/New_York")
ESPN_TO_NBA = {"GS": "GSW", "SA": "SAS", "NY": "NYK", "NO": "NOP", "WSH": "WAS", "UTAH": "UTA"}
TEAM_ID = {t["abbreviation"]: t["id"] for t in nba_teams.get_teams()}


def upcoming_games(days: int = 3) -> list[dict]:
    """Next game per team within `days`, from ESPN's public scoreboard."""
    games, seen = [], set()
    for i in range(days):
        day = dt.date.today() + dt.timedelta(days=i)
        url = f"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates={day:%Y%m%d}"
        with urllib.request.urlopen(url, timeout=30) as r:
            events = json.load(r).get("events", [])
        for e in events:
            if e["status"]["type"]["state"] != "pre":
                continue
            comp = {c["homeAway"]: c["team"]["abbreviation"] for c in e["competitions"][0]["competitors"]}
            home, away = (ESPN_TO_NBA.get(comp[k], comp[k]) for k in ("home", "away"))
            if home not in TEAM_ID or away not in TEAM_ID:
                print(f"  skipping {away} @ {home}: unknown team code")
                continue
            if home in seen or away in seen:
                continue  # one game per team, so a placeholder never becomes another's "previous game"
            seen.update([home, away])
            tip = dt.datetime.fromisoformat(e["date"].replace("Z", "+00:00"))
            games.append({"home": home, "away": away, "date": tip.astimezone(ET).strftime("%Y-%m-%d"), "espn": e["id"]})
    return games


def current_rosters() -> dict[int, str]:
    df = commonallplayers.CommonAllPlayers(is_only_current_season=1, timeout=60).get_data_frames()[0]
    return {int(r.PERSON_ID): r.TEAM_ABBREVIATION for r in df.itertuples() if r.TEAM_ABBREVIATION}


def add_placeholders(players: pd.DataFrame, teams: pd.DataFrame, games: list[dict], roster: dict[int, str]):
    """Placeholder rows for the games being projected. Returns extended frames and the placeholder ids."""
    season_id = pull_raw.current_season()
    season_code = int("2" + season_id[:4])  # regular-season SEASON_ID, e.g. 22026
    recent = players[players.MIN > 0].copy()
    recent["date"] = pd.to_datetime(recent.GAME_DATE)
    recent = recent.sort_values("date")

    team_rows, player_rows = [], []
    for n, g in enumerate(games):
        gid = DUMMY_BASE + n
        for abbr, opp, matchup in [(g["home"], g["away"], f"{g['home']} vs. {g['away']}"),
                                   (g["away"], g["home"], f"{g['away']} @ {g['home']}")]:
            tid = TEAM_ID[abbr]
            team_rows.append(dict(SEASON_ID=season_code, TEAM_ID=tid, TEAM_ABBREVIATION=abbr, GAME_ID=gid,
                                  GAME_DATE=g["date"], MATCHUP=matchup, gtype="regular"))
            # Players currently on this team who have actually been playing.
            for pid, team in roster.items():
                if team != abbr:
                    continue
                hist = recent[recent.PLAYER_ID == pid].tail(10)
                if len(hist) < 3 or hist.MIN.mean() < 8:
                    continue
                player_rows.append(dict(SEASON_ID=season_code, PLAYER_ID=pid, TEAM_ID=tid, TEAM_ABBREVIATION=abbr,
                                        GAME_ID=gid, GAME_DATE=g["date"], MATCHUP=matchup, MIN=1.0, gtype="regular"))
    return (pd.concat([players, pd.DataFrame(player_rows)], ignore_index=True),
            pd.concat([teams, pd.DataFrame(team_rows)], ignore_index=True))


def norm_name(s: str) -> str:
    """Same normalisation as shared/picks.ts normName, so ESPN names and box-score names meet."""
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"[^a-z ]", "", s)
    s = re.sub(r"\b(jr|sr|ii|iii|iv)\b", "", s)
    return re.sub(r"\s+", " ", s).strip()


def espn_out_players() -> set[str]:
    """Normalised names of players ESPN lists as Out (including out for the season). None if the feed cannot be read."""
    try:
        with urllib.request.urlopen("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries", timeout=30) as r:
            feed = json.load(r)
    except Exception as e:  # noqa: BLE001
        print(f"  injuries unavailable ({e}); projections use past appearances only")
        return set()
    out = set()
    for team in feed.get("injuries", []):
        for i in team.get("injuries", []):
            if "out" in str(i.get("status", "")).lower():
                out.add(norm_name(i.get("athlete", {}).get("displayName", "")))
    return out


def apply_injury_news(df: pd.DataFrame, out_names: set[str]) -> pd.DataFrame:
    """Use the real injury report for who is missing tonight.

    The model's `miss_prev` / `miss_prev2` features are the typical minutes of rotation teammates who skipped the previous games, measured from past
    appearances. For a game being projected, the injury report is a better statement of who is out, so for each team's placeholder rows both features
    become the summed last-10 minutes of its rotation players (>= 15 min) listed Out. Players listed Out are removed from the projection set.
    NOT validated: no historical injury reports exist to backtest it, so it is stated here and shown in the app as an adjustment.
    """
    if not out_names:
        return df
    names = df.dropna(subset=["PLAYER_NAME"]).drop_duplicates("PLAYER_ID", keep="last").set_index("PLAYER_ID")["PLAYER_NAME"].map(norm_name)
    dummy = df.GAME_ID >= DUMMY_BASE
    is_out = df.PLAYER_ID.map(names).isin(out_names)
    rotation_out = df[dummy & is_out & (df.min_l10 >= 15)]
    mins = rotation_out.groupby(["GAME_ID", "TEAM_ID"]).min_l10.sum()
    report = []
    for (gid, tid), m in mins.items():
        mask = dummy & (df.GAME_ID == gid) & (df.TEAM_ID == tid)
        df.loc[mask, ["miss_prev", "miss_prev2"]] = float(m)
        who = [f"{names.get(pid, pid)} ({mm:.0f} min)" for pid, mm in rotation_out[(rotation_out.GAME_ID == gid) & (rotation_out.TEAM_ID == tid)][["PLAYER_ID", "min_l10"]].itertuples(index=False)]
        report.append({"team_id": int(tid), "added_missing_minutes": round(float(m), 1), "players": who})
    OUT.mkdir(exist_ok=True)
    (OUT / "injury_adjustments.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(f"  injury news applied to {len(report)} teams; {int((dummy & is_out).sum())} players listed Out removed from projections")
    return df[~(dummy & is_out)].reset_index(drop=True)


def fit_and_project(df: pd.DataFrame) -> pd.DataFrame:
    is_dummy = df.GAME_ID >= DUMMY_BASE
    ok = (df.n_prior >= 5) & df["pts_l10"].notna()
    train = df[ok & ~is_dummy].sort_values("date")
    target = df[ok & is_dummy]
    print(f"training on {len(train):,} player-games through {train.date.max():%Y-%m-%d}; projecting {len(target)} rows")

    cut = int(len(train) * 0.8)
    fit_part, alpha_part = train.iloc[:cut], train.iloc[cut:]
    out = []
    df = df.assign(pra=df.pts + df.reb + df.ast)   # PRA is projected directly (its own mean and dispersion), not as a sum of three
    train, fit_part, alpha_part, target = (x.assign(pra=x.pts + x.reb + x.ast) for x in (train, fit_part, alpha_part, target))
    for stat in [*STATS, "pra"]:
        # Dispersion from a model that never saw the slice it is scored on (same recipe as evaluate.py).
        probe = HistGradientBoostingRegressor(loss="poisson", **HGB).fit(fit_part[FEATURES], fit_part[stat])
        disp = Dispersion().fit(probe.predict(alpha_part[FEATURES]), alpha_part[stat].to_numpy(float))
        final = HistGradientBoostingRegressor(loss="poisson", **HGB).fit(train[FEATURES], train[stat])
        mu = final.predict(target[FEATURES])
        out.append(pd.DataFrame({"player_id": target.PLAYER_ID.values, "game_date": target.GAME_DATE.values,
                                 "stat": stat, "mean": mu, "alpha": disp.alpha(mu)}))
    return pd.concat(out, ignore_index=True)


def write_sql(proj: pd.DataFrame, remote: bool):
    OUT.mkdir(exist_ok=True)
    first = proj.game_date.min()
    lines = [f"DELETE FROM projections WHERE game_date >= '{first}';"]
    for r in proj.itertuples():
        lines.append("INSERT OR REPLACE INTO projections (player_id, game_date, stat, mean, alpha, model) "
                     f"VALUES ({int(r.player_id)}, '{r.game_date}', '{r.stat}', {r.mean:.5f}, {r.alpha:.5f}, '{MODEL}');")
    (OUT / "projections.sql").write_text("\n".join(lines), encoding="utf-8")
    subprocess.run(["npx", "wrangler", "d1", "execute", "ubet", "--remote" if remote else "--local",
                    "--file", str(OUT / "projections.sql")], cwd=ROOT, shell=True, check=True)


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--remote", action="store_true")
    ap.add_argument("--days", type=int, default=3)
    ap.add_argument("--no-injuries", action="store_true", help="do not use the ESPN injury report for who is out")
    ap.add_argument("--no-pull", action="store_true", help="skip refreshing the raw logs")
    args = ap.parse_args()

    if not args.no_pull:
        pull_raw.main()
    games = upcoming_games(args.days)
    if not games:
        sys.exit("No upcoming games found.")
    print(f"{len(games)} games: " + ", ".join(f"{g['away']}@{g['home']} {g['date']}" for g in games))

    players, teams = load_raw()
    players, teams = add_placeholders(players, teams, games, current_rosters())
    df = build(players, teams)
    if not args.no_injuries:
        df = apply_injury_news(df, espn_out_players())
    proj = fit_and_project(df)
    print(proj.groupby("stat")[["mean", "alpha"]].mean().round(3))
    write_sql(proj, args.remote)
    print(f"wrote {len(proj)} projections ({proj.player_id.nunique()} players)")


if __name__ == "__main__":
    main()
