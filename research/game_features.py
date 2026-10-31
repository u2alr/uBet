"""Game-winner features (rules and definitions: PREREG_GAMES.md). Research / display only: nothing in production probability code imports this module.

`build_games(teams, miss)` returns one row per regular-season game with the label `y` (home team won) and prior-only features:
every value for a game uses only games on EARLIER DATES (Elo ratings are read before the game's own update; rolling windows are shifted; league means come from earlier dates).
"""
import numpy as np
import pandas as pd

import defense_features as D
import human_factors as H

ELO_START, ELO_K, ELO_HOME, ELO_CARRY = 1500.0, 20.0, 100.0, 0.75
SHRINK = 8.0
STYLE = {  # trait: (own offence column, defence column from defense_features.team_defense)
    "p3a": ("own_p3a", "df_td_p3a_rate_l10"), "oreb": ("own_oreb", "df_td_oreb_share_l10"),
    "ftr": ("own_ftr", "df_td_ftr_l10"), "tov": ("own_tov", "df_td_tov_rate_l10"),
}
GROUPS = {
    "RATINGS": ["net_l10", "net_l20", "net_s2d", "off_l20", "def_l20", "pace_l20"],
    "SCHEDULE": ["rest_diff", "b2b_home", "b2b_away", "away_miles", "away_tz", "away_road_trip", "home_elev"],
    "STYLE": [f"mm_{k}" for k in STYLE],
    "AVAIL": ["miss_home", "miss_away"],
    "AVAIL2": ["ab_min_diff", "ab_pts_diff", "ab_top_home", "ab_top_away", "ab_n_home", "ab_n_away"],
}
BASE = ["elo_diff"]
ALL = [c for cols in GROUPS.values() for c in cols]


def _team_games(teams: pd.DataFrame) -> pd.DataFrame:
    t = teams.drop_duplicates(["GAME_ID", "TEAM_ID"]).copy()
    t["date"] = pd.to_datetime(t.GAME_DATE)
    t["season"] = t.SEASON_ID.astype(str).str[-4:].astype(int)
    t["poss"] = t.FGA + 0.44 * t.FTA + t.TOV - t.OREB
    t["home"] = t.MATCHUP.str.contains(" vs. ").astype(int)
    o = t[["GAME_ID", "TEAM_ID", "PTS", "DREB"]].rename(columns={"TEAM_ID": "OPP", "PTS": "opp_pts", "DREB": "opp_dreb"})
    t = t.merge(o, on="GAME_ID")
    t = t[t.TEAM_ID != t.OPP].sort_values(["TEAM_ID", "date", "GAME_ID"]).reset_index(drop=True)
    t["net"] = (t.PTS - t.opp_pts) / t.poss * 100
    t["off"], t["def"] = t.PTS / t.poss * 100, t.opp_pts / t.poss * 100
    t["own_p3a"], t["own_oreb"] = t.FG3A / t.poss, t.OREB / (t.OREB + t.opp_dreb)
    t["own_ftr"], t["own_tov"] = t.FTA / t.FGA, t.TOV / t.poss
    return t


def _rolling(t: pd.DataFrame) -> pd.DataFrame:
    g = t.groupby("TEAM_ID")
    for name, col, win in (("net_l10", "net", 10), ("net_l20", "net", 20), ("off_l20", "off", 20), ("def_l20", "def", 20), ("pace_l20", "poss", 20),
                           ("own_p3a_l10", "own_p3a", 10), ("own_oreb_l10", "own_oreb", 10), ("own_ftr_l10", "own_ftr", 10), ("own_tov_l10", "own_tov", 10)):
        t[name] = g[col].transform(lambda s: s.shift(1).rolling(win, min_periods=3).mean())
        n = g[col].transform(lambda s: s.shift(1).rolling(win, min_periods=3).count())
        if name.startswith("net"):
            t[name] = t[name] * n / (n + SHRINK)      # a short window is pulled toward zero (an average team)
    gs = t.groupby(["TEAM_ID", "season"])
    n = gs.cumcount()
    t["net_s2d"] = ((gs.net.cumsum() - t.net) / n.replace(0, np.nan)) * n / (n + SHRINK)
    t.loc[n < 3, "net_s2d"] = np.nan
    return t


def _elo(t: pd.DataFrame, state: bool = False):
    """Pre-game Elo for both teams of every game, margin-aware, updated after the game only."""
    games = t[t.home == 1][["GAME_ID", "date", "season", "TEAM_ID", "OPP", "PTS", "opp_pts"]].sort_values(["date", "GAME_ID"])
    rating: dict[int, float] = {}
    last_season: dict[int, int] = {}
    out = {}
    for gid, season, h, a, hp, ap in zip(games.GAME_ID, games.season, games.TEAM_ID, games.OPP, games.PTS, games.opp_pts):
        for tm in (h, a):
            if tm in last_season and last_season[tm] != season:
                rating[tm] = ELO_START + ELO_CARRY * (rating[tm] - ELO_START)
            rating.setdefault(tm, ELO_START)
            last_season[tm] = season
        rh, ra = rating[h], rating[a]
        out[gid] = (rh, ra)
        exp_h = 1 / (1 + 10 ** (-(rh - ra + ELO_HOME) / 400))
        res = 1.0 if hp > ap else 0.0
        margin = abs(hp - ap)
        gap = (rh + ELO_HOME - ra) if hp > ap else (ra - rh - ELO_HOME)
        mult = ((margin + 3) ** 0.8) / (7.5 + 0.006 * gap)
        delta = ELO_K * mult * (res - exp_h)
        rating[h], rating[a] = rh + delta, ra - delta
    e = pd.DataFrame.from_dict(out, orient="index", columns=["elo_home", "elo_away"]).rename_axis("GAME_ID").reset_index()
    return (e, rating, last_season) if state else e


def team_absences(players: pd.DataFrame, upcoming: pd.DataFrame | None = None, out_ids: set[int] | None = None) -> pd.DataFrame:
    """Rotation players absent from each team-game (PREREG_GAMES.md addendum). One row per (GAME_ID, TEAM_ID): ab_min, ab_pts, ab_n, ab_top.

    The rotation, and every statistic of an absentee, come from the team's PREVIOUS 10 games only; whether he is absent is the one same-game fact: no minutes in this game (history), or
    listed Out (`out_ids`) for the rows in `upcoming` (GAME_ID, TEAM_ID, date), which are games not yet played.
    """
    p = players[players["MIN"] > 0] if "MIN" in players.columns else players
    p = p.assign(date=pd.to_datetime(p.GAME_DATE))
    rows = []
    fake = {} if upcoming is None else {t: g for t, g in upcoming.groupby("TEAM_ID")}
    for team, tg in p.groupby("TEAM_ID"):
        order = tg.groupby("GAME_ID").date.first().sort_values().index.tolist()
        extra = [] if team not in fake else fake[team].sort_values("date").GAME_ID.tolist()
        games = order + extra
        mins = tg.pivot_table(index="GAME_ID", columns="PLAYER_ID", values="MIN", aggfunc="sum").reindex(games)
        pts = tg.pivot_table(index="GAME_ID", columns="PLAYER_ID", values="PTS", aggfunc="sum").reindex(games)
        played = mins.notna() & (mins > 0)
        mins, pts = mins.fillna(0.0), pts.fillna(0.0)
        season_key = np.array([str(g)[:3] for g in games])      # the rotation never reaches back across a season boundary: players who left over the summer are not "absent"
        roll = lambda df: df.groupby(season_key).transform(lambda x: x.shift(1).rolling(10, min_periods=1).sum())   # noqa: E731
        c = roll(played.astype(float))
        avgm = roll(mins) / c.where(c > 0)
        avgp = roll(pts) / c.where(c > 0)
        rot = (c >= 3) & (avgm >= 15)
        absent = ~played
        if extra:
            absent.loc[extra, :] = False
            if out_ids:
                cols = [pid for pid in absent.columns if pid in out_ids]
                absent.loc[extra, cols] = True
        miss = rot & absent
        score = avgm.where(rot).fillna(-1.0).to_numpy()
        has_rot = rot.any(axis=1).to_numpy()
        top_idx = score.argmax(axis=1)
        miss_np = miss.to_numpy()
        top_abs = pd.Series([bool(miss_np[i, j]) if has_rot[i] else False for i, j in enumerate(top_idx)], index=games)
        rows.append(pd.DataFrame({"GAME_ID": games, "TEAM_ID": team, "ab_min": avgm.where(miss).sum(axis=1).values, "ab_pts": avgp.where(miss).sum(axis=1).values,
                                  "ab_n": miss.sum(axis=1).values, "ab_top": top_abs.astype(float).values}))
    return pd.concat(rows, ignore_index=True)


def _league_prior(t: pd.DataFrame, col: str) -> pd.Series:
    daily = t.groupby("date")[col].agg(["sum", "count"])
    c = daily.cumsum().shift(1)
    return (c["sum"] / c["count"]).rename(f"lg_{col}")


def build_games(teams: pd.DataFrame, miss: pd.DataFrame, players: pd.DataFrame | None = None) -> pd.DataFrame:
    """`miss`: one row per (GAME_ID, TEAM_ID) with `miss_prev` (rotation minutes missing from the previous game; features.build's proxy)."""
    t = _rolling(_team_games(teams))
    td = D.team_defense(teams)
    t = t.merge(td, left_on=["GAME_ID", "OPP"], right_on=["GAME_ID", "TEAM_ID"], how="left", suffixes=("", "_d")).drop(columns=["TEAM_ID_d"])   # the OPPONENT's defence profile
    hf = H.team_features(teams)
    t = t.merge(hf, on=["GAME_ID", "TEAM_ID"], how="left")
    t = t.merge(miss[["GAME_ID", "TEAM_ID", "miss_prev"]].drop_duplicates(["GAME_ID", "TEAM_ID"]), on=["GAME_ID", "TEAM_ID"], how="left")
    for k, (own, _) in STYLE.items():
        t = t.merge(_league_prior(t, own), left_on="date", right_index=True, how="left")
    home = t[t.home == 1].set_index("GAME_ID")
    away = t[t.home == 0].set_index("GAME_ID")
    both = home.index.intersection(away.index)
    h, a = home.loc[both], away.loc[both]
    g = pd.DataFrame({"GAME_ID": both, "date": h.date.values, "season": h.season.values, "home_id": h.TEAM_ID.values, "away_id": a.TEAM_ID.values,
                      "y": (h.PTS.values > a.PTS.values).astype(float)})
    g = g.merge(_elo(t), on="GAME_ID", how="left")
    g["elo_diff"] = g.elo_home - g.elo_away
    for c in ("net_l10", "net_l20", "net_s2d", "off_l20"):
        g[c] = h[c].values - a[c].values
    g["def_l20"] = h["def_l20"].values - a["def_l20"].values
    g["pace_l20"] = h["pace_l20"].values + a["pace_l20"].values
    g["rest_diff"] = h.hf_rest_days.values - a.hf_rest_days.values
    g["b2b_home"], g["b2b_away"] = h.hf_b2b.values, a.hf_b2b.values
    g["away_miles"], g["away_tz"], g["away_road_trip"] = a.hf_miles.values, a.hf_tz_shift.values, a.hf_road_trip.values
    g["home_elev"] = h.hf_elev.values
    for k, (own, dcol) in STYLE.items():
        mu = h[f"lg_{own}"].values    # league average of the trait before this date; a defence is judged against the same average
        # Each row's defence columns describe that row's OPPONENT: the home row carries the away team's defence, and the away row carries the home team's.
        g[f"mm_{k}"] = (h[f"{own}_l10"].values - mu) * (h[dcol].values - mu) - (a[f"{own}_l10"].values - mu) * (a[dcol].values - mu)
    g["miss_home"], g["miss_away"] = h.miss_prev.values, a.miss_prev.values
    if players is not None:
        ab = team_absences(players).set_index(["GAME_ID", "TEAM_ID"])
        hv = ab.reindex(list(zip(g.GAME_ID, g.home_id)))
        av = ab.reindex(list(zip(g.GAME_ID, g.away_id)))
        g["ab_min_diff"], g["ab_pts_diff"] = hv.ab_min.values - av.ab_min.values, hv.ab_pts.values - av.ab_pts.values
        g["ab_top_home"], g["ab_top_away"], g["ab_n_home"], g["ab_n_away"] = hv.ab_top.values, av.ab_top.values, hv.ab_n.values, av.ab_n.values
    else:
        for c in GROUPS["AVAIL2"]:
            g[c] = np.nan
    g["week"] = pd.to_datetime(g.date).dt.to_period("W").astype(str)
    g["regular"] = g.GAME_ID.astype(str).str[:1].eq("2")
    return g.sort_values(["date", "GAME_ID"]).reset_index(drop=True)
