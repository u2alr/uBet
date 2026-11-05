"""Game-winner features v8: what the league's own pre-game injury report adds (rules and definitions: PREREG_GAMES_V8.md). Research only: nothing in production probability code imports this module.

Every value for a game uses only (1) the latest stored report of that day printed at least 60 minutes before tip and (2) each listed player's minutes and Game Score on EARLIER dates.
"""
from pathlib import Path

import numpy as np
import pandas as pd

import game_features_v2 as V
import nba_injury_pdf as N

CSV = Path(__file__).resolve().parent / "data" / "injuries" / "injury_reports.csv"
P_PLAY = {"Out": 0.0, "Doubtful": 0.15, "Questionable": 0.5, "Probable": 0.9, "Available": 1.0}      # fixed in PREREG_GAMES_V8.md, not fitted
MIN_CAP, MIN_WINDOW, GS_WINDOW, MIN_APPEARANCES = 36.0, 10, 20, 3
LEAD_MINUTES, DEFAULT_TIP = 60, "19:00"
GROUPS = {"C1": ["rep_exp_loss"], "C2": ["rep_top"]}


def load_reports(path: Path = CSV) -> pd.DataFrame:
    """Every stored row, with the printed time as a timestamp and a `slot_time` fallback (the slot's nominal hour) for a report that printed no time."""
    d = pd.read_csv(path, dtype={"slot_date": str, "game_date": str, "tip": str, "player": str, "reason": str})
    d["player"] = d.player.fillna("")
    slot_hour = d.slot.str.extract(r"(\d+)")[0].astype(int) % 12 + np.where(d.slot.str.endswith("PM"), 12, 0)
    d["slot_time"] = pd.to_datetime(d.slot_date) + pd.to_timedelta(slot_hour, unit="h")
    d["report_ts"] = pd.to_datetime(d.report_time, errors="coerce").fillna(d.slot_time)
    return d


def choose_reports(reports: pd.DataFrame, games: pd.DataFrame) -> pd.DataFrame:
    """For each game (columns date, home, away as abbreviations): `report_ts` of the report used, or NaT. A report qualifies when it is of the game's day, printed at least LEAD_MINUTES before
    the game's tip, and neither team is marked NOT_SUBMITTED in it; the latest qualifying one is used."""
    by_day = {k: v for k, v in reports.groupby("slot_date")}
    out = []
    for r in games.itertuples():
        day = by_day.get(r.date)
        chosen = pd.NaT
        if day is not None:
            m = day[day.matchup.fillna("") == f"{r.away}@{r.home}"]
            tip = (m.tip.dropna().iloc[0] if m.tip.notna().any() else DEFAULT_TIP)
            cutoff = pd.Timestamp(f"{r.date} {tip}") - pd.Timedelta(minutes=LEAD_MINUTES)
            blocked = set(day[(day.status == "NOT_SUBMITTED") & day.team.isin([r.home, r.away])].report_ts)
            ok = sorted(t for t in day.report_ts.unique() if t <= cutoff and t not in blocked)
            chosen = ok[-1] if ok else pd.NaT
        out.append(chosen)
    return pd.DataFrame({"date": games.date.to_numpy(), "home": games.home.to_numpy(), "away": games.away.to_numpy(), "report_ts": out})


def player_weights(players: pd.DataFrame) -> pd.DataFrame:
    """Per appearance, the stats a player had AFTER it (rolling over his latest appearances, inclusive): `m` mean minutes over the last 10, `v` mean Game Score over the last 20. Joined as of an
    earlier date, the current game never enters."""
    p = players[players["MIN"] > 0].assign(GS=V.game_score(players[players["MIN"] > 0]), date=lambda d: pd.to_datetime(d.GAME_DATE))
    p = p.sort_values(["PLAYER_ID", "date"])
    g = p.groupby("PLAYER_ID")
    p["m"] = g["MIN"].transform(lambda s: s.rolling(MIN_WINDOW, min_periods=MIN_APPEARANCES).mean())
    p["v"] = g["GS"].transform(lambda s: s.rolling(GS_WINDOW, min_periods=MIN_APPEARANCES).mean())
    return p.dropna(subset=["m", "v"])[["PLAYER_ID", "date", "m", "v"]].sort_values("date")


def roster_keys(players: pd.DataFrame) -> dict[str, int]:
    names = players.dropna(subset=["PLAYER_NAME"]).drop_duplicates("PLAYER_ID", keep="last")
    return {N.letters(n): int(i) for n, i in zip(names.PLAYER_NAME, names.PLAYER_ID)}


def listed_players(reports: pd.DataFrame, chosen: pd.DataFrame, keys: dict[str, int], weights: pd.DataFrame) -> pd.DataFrame:
    """One row per (game, team, listed player) with his weight `w` as of the game's date (0 when unmatched or with too little history) and probability of playing `p`."""
    j = chosen.dropna(subset=["report_ts"]).merge(reports[reports.player != ""], left_on=["date", "report_ts"], right_on=["slot_date", "report_ts"], suffixes=("", "_r"))
    j = j[(j.team == j.home) | (j.team == j.away)]
    j = j[j.matchup == j.away + "@" + j.home]
    last, _, first = j.player.str.partition(",").T.values
    j["key"] = [N.letters(f + l) for f, l in zip(first, last)]
    j["PLAYER_ID"] = j.key.map(keys)
    j["asof"] = pd.to_datetime(j.date)
    matched = j.dropna(subset=["PLAYER_ID"]).assign(PLAYER_ID=lambda d: d.PLAYER_ID.astype(int)).sort_values("asof")
    w = pd.merge_asof(matched, weights.rename(columns={"date": "wdate"}).sort_values("wdate"), left_on="asof", right_on="wdate", by="PLAYER_ID", allow_exact_matches=False)
    w["w"] = (w.m.clip(upper=MIN_CAP) * w.v / 240.0).fillna(0.0)
    w["p"] = w.status.map(P_PLAY)
    return w[["date", "home", "away", "team", "player", "status", "PLAYER_ID", "w", "p"]]


def build_v8(base: pd.DataFrame, teams: pd.DataFrame, players: pd.DataFrame, reports: pd.DataFrame | None = None) -> pd.DataFrame:
    """`base` is the v1 + v2 frame (one row per game). Adds `has_rep`, `rep_out`, `rep_exp_loss` and `rep_top` (home minus away)."""
    reports = load_reports() if reports is None else reports
    abbr = dict(zip(teams.TEAM_ID, teams.TEAM_ABBREVIATION))
    g = base.copy()
    games = pd.DataFrame({"date": pd.to_datetime(g.date).dt.strftime("%Y-%m-%d"), "home": g.home_id.map(abbr), "away": g.away_id.map(abbr)})
    chosen = choose_reports(reports, games)
    lp = listed_players(reports, chosen, roster_keys(players), player_weights(players))
    lp["out"] = lp.w * (lp.p == 0)
    lp["loss"] = lp.w * (1 - lp.p)
    lp["top"] = lp.w * (lp.p < 0.5)
    side = lp.assign(is_home=(lp.team == lp.home)).groupby(["date", "home", "away", "is_home"]).agg(out=("out", "sum"), loss=("loss", "sum"), top=("top", "max")).reset_index()
    key = games.assign(i=np.arange(len(games)))
    feats = {}
    for name in ("out", "loss", "top"):
        h = key.merge(side[side.is_home][["date", "home", "away", name]], on=["date", "home", "away"], how="left")[name].fillna(0.0).to_numpy()
        a = key.merge(side[~side.is_home][["date", "home", "away", name]], on=["date", "home", "away"], how="left")[name].fillna(0.0).to_numpy()
        feats[name] = h - a
    g["has_rep"] = chosen.report_ts.notna().astype(float).to_numpy()
    g["rep_out"], g["rep_exp_loss"], g["rep_top"] = feats["out"], feats["loss"], feats["top"]
    return g
