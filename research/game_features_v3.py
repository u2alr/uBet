"""Game-winner features v3 candidates (rules and definitions: PREREG_GAMES_V3.md). Research and display only: nothing in production probability code imports this module.

Every value for a game uses only games on EARLIER dates. The one same-game fact is who played today (history) or who is listed Out (the games not yet played), exactly as in the availability
features of v1: a player's talent, his minutes and his play rate all come from the games before.
"""
import numpy as np
import pandas as pd

import game_features_v2 as V

TALENT_WINDOW, ROTATION_MINUTES, MIN_APPEARANCES, PLAY_WINDOW = 20, 18.0, 3, 20
CONTINUITY_MINUTES, ROTATION_GAMES, DEFAULT_CONTINUITY, EARLY_GAMES, EARLY_FLAG = 200.0, 10, 0.6, 25, 15


def _prep(players: pd.DataFrame) -> pd.DataFrame:
    p = players[players["MIN"] > 0].copy()
    p["date"] = pd.to_datetime(p.GAME_DATE)
    if "GS" not in p.columns:
        p["GS"] = V.game_score(p)
    p["season"] = p.SEASON_ID.astype(str).str[-4:].astype(int)
    return p.sort_values(["PLAYER_ID", "date", "GAME_ID"])


def roster_delta(players: pd.DataFrame, upcoming: pd.DataFrame | None = None, out_ids: set[int] | None = None) -> pd.DataFrame:
    """One row per (GAME_ID, TEAM_ID): the talent of today's roster compared with the roster the recent results came from.

    `upcoming` (GAME_ID, TEAM_ID, date) are games not yet played; there, a rotation candidate counts as playing unless he is in `out_ids`.
    """
    p = _prep(players)
    g = p.groupby("PLAYER_ID")
    p["v_incl"] = g.GS.transform(lambda s: s.rolling(TALENT_WINDOW, min_periods=MIN_APPEARANCES).mean())
    p["m_incl"] = g["MIN"].transform(lambda s: s.rolling(10, min_periods=MIN_APPEARANCES).mean())
    timeline = {pid: (grp.date.values.astype("datetime64[ns]"), grp.TEAM_ID.values) for pid, grp in p.groupby("PLAYER_ID")}
    fake = {} if upcoming is None else {t: x for t, x in upcoming.groupby("TEAM_ID")}
    rows = []
    for team, tg in p.groupby("TEAM_ID"):
        first = tg.groupby("GAME_ID").date.first().sort_values()
        order = first.index.tolist()
        extra = [] if team not in fake else fake[team].sort_values("date").GAME_ID.tolist()
        games = order + extra
        dates = [pd.Timestamp(d) for d in first.values] + [pd.Timestamp(fake[team].set_index("GAME_ID").date.loc[x]) for x in extra]
        played = tg.assign(one=1.0).pivot_table(index="GAME_ID", columns="PLAYER_ID", values="one", aggfunc="max").reindex(games).fillna(0.0)
        value = tg.pivot_table(index="GAME_ID", columns="PLAYER_ID", values="v_incl", aggfunc="last").reindex(index=games, columns=played.columns).ffill().shift(1)
        minutes = tg.pivot_table(index="GAME_ID", columns="PLAYER_ID", values="m_incl", aggfunc="last").reindex(index=games, columns=played.columns).ffill().shift(1)
        if extra:
            played.loc[extra, :] = 1.0
            if out_ids:
                played.loc[extra, [c for c in played.columns if c in out_ids]] = 0.0
        rate = played.shift(1).rolling(PLAY_WINDOW, min_periods=MIN_APPEARANCES).mean()
        cand = np.asarray(((minutes >= ROTATION_MINUTES) & value.notna() & rate.notna()).to_numpy(), dtype=bool).copy()
        m = played.to_numpy(dtype=float)
        cols = list(played.columns)
        # A player who has since played for another team is not part of this roster (he left; he is not "absent").
        # In a game not yet played every candidate is ASSUMED to play, so the check must cover all of them; in a played game, a player who appeared plainly belongs to the team.
        check = cand & (m == 0)
        if extra:
            check[len(order):, :] = cand[len(order):, :]
        for i, j in zip(*np.nonzero(check)):
            d_arr, t_arr = timeline[cols[j]]
            k = np.searchsorted(d_arr, np.datetime64(dates[i]), side="left") - 1
            if k < 0 or t_arr[k] != team:
                cand[i, j] = False
        delta = (value.fillna(0.0).to_numpy(dtype=float) * (m - rate.fillna(0.0).to_numpy(dtype=float)) * cand).sum(axis=1)
        rows.append(pd.DataFrame({"GAME_ID": games, "TEAM_ID": team, "rd": delta}))
    return pd.concat(rows, ignore_index=True)


def continuity(players: pd.DataFrame, upcoming: pd.DataFrame | None = None) -> pd.DataFrame:
    """One row per (GAME_ID, TEAM_ID): `cont`, the share of the rotation minutes over the previous 10 games THIS SEASON played by players with at least 200 minutes for the team last
    season (NaN before the first game), and `n_prior`, the team's games played so far this season."""
    p = _prep(players)
    fake = {} if upcoming is None else {t: x for t, x in upcoming.groupby("TEAM_ID")}
    rows = []
    for team, tg in p.groupby("TEAM_ID"):
        info = tg.groupby("GAME_ID").agg(season=("season", "first"), date=("date", "first")).sort_values("date")
        order = info.index.tolist()
        extra = [] if team not in fake else fake[team].sort_values("date").GAME_ID.tolist()
        games = order + extra
        seasons = info.season.tolist()
        for x in extra:
            gap = (fake[team].set_index("GAME_ID").date.loc[x] - info.date.iloc[-1]).days
            seasons.append(seasons[-1] + (1 if gap >= 120 else 0))
        seasons = np.array(seasons)
        mins = tg.pivot_table(index="GAME_ID", columns="PLAYER_ID", values="MIN", aggfunc="sum").reindex(games).fillna(0.0)
        recent = mins.groupby(seasons).transform(lambda x: x.shift(1).rolling(ROTATION_GAMES, min_periods=1).sum())
        last_season = tg.groupby(["season", "PLAYER_ID"]).MIN.sum()
        mask = np.zeros(mins.shape)
        cols = list(mins.columns)
        for s in np.unique(seasons):
            keep = np.array([last_season.get((s - 1, c), 0.0) >= CONTINUITY_MINUTES for c in cols])
            mask[seasons == s] = keep
        num = (recent.to_numpy() * mask).sum(axis=1)
        den = recent.to_numpy().sum(axis=1)
        cont = np.where(den > 0, num / np.where(den > 0, den, 1), np.nan)
        n_prior = pd.Series(seasons).groupby(seasons).cumcount().to_numpy()
        rows.append(pd.DataFrame({"GAME_ID": games, "TEAM_ID": team, "cont": cont, "n_prior": n_prior, "season": seasons}))
    return pd.concat(rows, ignore_index=True)


def last_final_rating(base: pd.DataFrame) -> dict[tuple[int, int], float]:
    """{(team id, season): the team's 120-day opponent-adjusted rating going into its LAST game of that season}, from `game_features_v2.build_v2` rows."""
    home = base[["date", "season", "home_id", "srs120_home"]].rename(columns={"home_id": "team", "srs120_home": "r"})
    away = base[["date", "season", "away_id", "srs120_away"]].rename(columns={"away_id": "team", "srs120_away": "r"})
    both = pd.concat([home, away]).sort_values("date")
    last = both.groupby(["team", "season"]).r.last()
    return {(int(t), int(s)): float(v) for (t, s), v in last.items()}


def early_weight(n_prior) -> np.ndarray:
    return np.maximum(0.0, 1.0 - np.asarray(n_prior, dtype=float) / EARLY_GAMES)


def build_v3(base: pd.DataFrame, players: pd.DataFrame) -> pd.DataFrame:
    """`base` is `game_features_v2.build_v2` output. Adds `rd_diff`, `prior_early`, `prior_early_raw`, `n_home`, `n_away` and `early` (either team under 15 games this season)."""
    g = base.copy()
    rd = roster_delta(players).set_index(["GAME_ID", "TEAM_ID"]).rd
    g["rd_diff"] = rd.reindex(list(zip(g.GAME_ID, g.home_id))).to_numpy() - rd.reindex(list(zip(g.GAME_ID, g.away_id))).to_numpy()
    c = continuity(players).set_index(["GAME_ID", "TEAM_ID"])
    prior = last_final_rating(base)
    out = {}
    for side in ("home", "away"):
        idx = list(zip(g.GAME_ID, g[f"{side}_id"]))
        cc = c.reindex(idx)
        n = cc.n_prior.to_numpy()
        pr = np.array([prior.get((int(t), int(s) - 1), np.nan) for t, s in zip(g[f"{side}_id"], g.season)])
        w = early_weight(n)
        cont = np.where(np.isnan(cc.cont.to_numpy()), DEFAULT_CONTINUITY, cc.cont.to_numpy())
        out[side] = (n, np.nan_to_num(w * cont * pr), np.nan_to_num(w * pr))
    g["n_home"], g["n_away"] = out["home"][0], out["away"][0]
    g["prior_early"] = out["home"][1] - out["away"][1]
    g["prior_early_raw"] = out["home"][2] - out["away"][2]
    g["early"] = np.minimum(g.n_home, g.n_away) < EARLY_FLAG
    return g
