"""Game-winner features v4 candidates (rules and definitions: PREREG_GAMES_V4.md). Research and display only: nothing in production probability code imports this module.

Every value for a game uses only games on EARLIER dates; the one same-game fact is who played (history) or who is listed Out (live), as in the availability features of v1.
"""
import numpy as np
import pandas as pd

import game_features as G
import game_features_v3 as V3

STREAK_CAP, TREND_CLIP, CLOSE_MARGIN = 8, 15.0, 5
DECAY_SPLIT, DECAY_CLOSE, SHRINK_SPLIT, SHRINK_CLOSE = 0.98, 0.97, 10.0, 10.0
GROUPS = {
    "MOMENTUM": ["win5_diff", "streak_diff", "trend_diff"],
    "IMPORTANCE": ["star2_diff", "top_absent_diff"],
    "CHEMISTRY": ["stab_diff"],
    "HOMECOURT": ["hsplit_diff"],
    "CLOSE_LUCK": ["close_diff"],
    "SHOOTING_LUCK": ["shot_diff"],
}


def team_features(teams: pd.DataFrame) -> pd.DataFrame:
    """One row per (GAME_ID, TEAM_ID): momentum, home-court split, close-game luck and shooting luck, from the team's PRIOR games."""
    t = G._team_games(teams).sort_values(["TEAM_ID", "date", "GAME_ID"]).reset_index(drop=True)
    t["margin"] = t.PTS - t.opp_pts
    rows = []
    for team, g in t.groupby("TEAM_ID", sort=False):
        margin, home = g.margin.to_numpy(float), g.home.to_numpy(int)
        m3, a3 = g.FG3M.to_numpy(float), g.FG3A.to_numpy(float)
        n = len(g)
        win5 = np.full(n, 0.5)                                   # no games yet means no opinion
        streak, trend, hsplit, close, shot = (np.zeros(n) for _ in range(5))
        hm = hn = rm = rn = cw = cl = 0.0
        run = 0
        for i in range(n):
            lo5, lo20, lo10, lo40 = max(0, i - 5), max(0, i - 20), max(0, i - 10), max(0, i - 40)
            if i > 0:
                k = i - lo5
                w = float((margin[lo5:i] > 0).mean())
                win5[i] = 0.5 + (w - 0.5) * k / (k + 2)
                streak[i] = float(np.clip(run, -STREAK_CAP, STREAK_CAP))
                trend[i] = float(np.clip(margin[lo5:i].mean() - margin[lo20:i].mean(), -TREND_CLIP, TREND_CLIP)) if i >= 5 else 0.0
                m = min(hn, rn)
                hsplit[i] = ((hm / hn if hn > 0 else 0.0) - (rm / rn if rn > 0 else 0.0)) / 2 * m / (m + SHRINK_SPLIT)
                close[i] = (cw - cl) / 2 / (cw + cl + SHRINK_CLOSE)
                den10, den40 = a3[lo10:i].sum(), a3[lo40:i].sum()
                shot[i] = (m3[lo10:i].sum() / den10 - m3[lo40:i].sum() / den40) if den10 > 0 and den40 > 0 and i >= 10 else 0.0
            # update the state with this game, after its features were recorded
            won = margin[i] > 0
            run = (run + 1 if run > 0 else 1) if won else (run - 1 if run < 0 else -1)
            hm, hn, rm, rn = hm * DECAY_SPLIT, hn * DECAY_SPLIT, rm * DECAY_SPLIT, rn * DECAY_SPLIT
            if home[i]:
                hm, hn = hm + margin[i], hn + 1
            else:
                rm, rn = rm + margin[i], rn + 1
            cw, cl = cw * DECAY_CLOSE, cl * DECAY_CLOSE
            if abs(margin[i]) <= CLOSE_MARGIN:
                cw, cl = (cw + 1, cl) if won else (cw, cl + 1)
        rows.append(pd.DataFrame({"GAME_ID": g.GAME_ID.to_numpy(), "TEAM_ID": team, "win5": win5, "streak": streak, "trend": trend, "hsplit": hsplit, "close": close, "shot": shot}))
    return pd.concat(rows, ignore_index=True)


def stability(players: pd.DataFrame) -> pd.DataFrame:
    """One row per (GAME_ID, TEAM_ID): `stab`, the mean overlap of consecutive games' top-8-by-minutes players over the previous 10 games (0 before there is any)."""
    p = V3._prep(players)
    rows = []
    for team, tg in p.groupby("TEAM_ID"):
        games = tg.groupby("GAME_ID").date.first().sort_values().index.tolist()
        sets = {gid: frozenset(x.nlargest(8, "MIN").PLAYER_ID) for gid, x in tg.groupby("GAME_ID")}
        jac = [np.nan] + [len(sets[a] & sets[b]) / len(sets[a] | sets[b]) for a, b in zip(games[:-1], games[1:])]    # overlap of game k with game k-1
        prior = pd.Series(jac).shift(1).rolling(10, min_periods=1).mean().fillna(0.0).to_numpy()
        rows.append(pd.DataFrame({"GAME_ID": games, "TEAM_ID": team, "stab": prior}))
    return pd.concat(rows, ignore_index=True)


def importance(players: pd.DataFrame, upcoming: pd.DataFrame | None = None, out_ids: set[int] | None = None) -> pd.DataFrame:
    """One row per (GAME_ID, TEAM_ID): `star2`, the summed talent of the two most talented rotation players who play, and `top_absent`, the highest talent among rotation players who do not.

    Same rotation, talent and departure rules as `game_features_v3.roster_delta`; in games not yet played a candidate plays unless he is in `out_ids`.
    """
    p = V3._prep(players)
    g = p.groupby("PLAYER_ID")
    p["v_incl"] = g.GS.transform(lambda s: s.rolling(V3.TALENT_WINDOW, min_periods=V3.MIN_APPEARANCES).mean())
    p["m_incl"] = g["MIN"].transform(lambda s: s.rolling(10, min_periods=V3.MIN_APPEARANCES).mean())
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
        rate = played.shift(1).rolling(V3.PLAY_WINDOW, min_periods=V3.MIN_APPEARANCES).mean()
        cand = np.asarray(((minutes >= V3.ROTATION_MINUTES) & value.notna() & rate.notna()).to_numpy(), dtype=bool).copy()
        m = played.to_numpy(dtype=float)
        cols = list(played.columns)
        check = cand & (m == 0)
        if extra:
            check[len(order):, :] = cand[len(order):, :]
        for i, j in zip(*np.nonzero(check)):
            d_arr, t_arr = timeline[cols[j]]
            k = np.searchsorted(d_arr, np.datetime64(dates[i]), side="left") - 1
            if k < 0 or t_arr[k] != team:
                cand[i, j] = False
        v = value.fillna(0.0).to_numpy(dtype=float)
        active = np.where(cand & (m == 1), v, -np.inf)
        absent = np.where(cand & (m == 0), v, 0.0)
        top2 = -np.sort(-active, axis=1)[:, :2]
        star2 = np.where(np.isfinite(top2), top2, 0.0).sum(axis=1)
        rows.append(pd.DataFrame({"GAME_ID": games, "TEAM_ID": team, "star2": star2, "top_absent": absent.max(axis=1)}))
    return pd.concat(rows, ignore_index=True)


def build_v4(base: pd.DataFrame, teams: pd.DataFrame, players: pd.DataFrame) -> pd.DataFrame:
    """`base` is a `game_features_v2.build_v2` frame. Adds every candidate feature as home minus away."""
    g = base.copy()
    tables = {"tf": team_features(teams).set_index(["GAME_ID", "TEAM_ID"]), "st": stability(players).set_index(["GAME_ID", "TEAM_ID"]), "im": importance(players).set_index(["GAME_ID", "TEAM_ID"])}
    home, away = list(zip(g.GAME_ID, g.home_id)), list(zip(g.GAME_ID, g.away_id))
    for name, table, col in (("win5_diff", "tf", "win5"), ("streak_diff", "tf", "streak"), ("trend_diff", "tf", "trend"), ("hsplit_diff", "tf", "hsplit"), ("close_diff", "tf", "close"),
                             ("shot_diff", "tf", "shot"), ("stab_diff", "st", "stab"), ("star2_diff", "im", "star2"), ("top_absent_diff", "im", "top_absent")):
        t = tables[table][col]
        g[name] = t.reindex(home).to_numpy() - t.reindex(away).to_numpy()
    return g
