"""Game-winner features v7 candidates: recent results read against who the OPPONENT was missing (rules and definitions: PREREG_GAMES_V7.md). Research only: nothing in production
probability code imports this module.

Every value for a game uses only games on EARLIER dates. The one same-game fact is who played in those earlier games (history), as in v3, v4 and v6.
"""
import numpy as np
import pandas as pd

import game_features as G
import game_features_v2 as V

WINDOW, MIN_GAMES = 5, 3
K_POINTS = 0.2           # points of margin per unit of absent Game Score, fixed in the pre-registration (not fitted)
CLOSE, DEPLETED = 6.0, 30.0   # a "narrow win over a depleted team": margin of at most 6 against an opponent missing at least 30 units of absent Game Score (17% of team-games, about two rotation starters)
GROUPS = {
    "SOFTSCHED": ["soft5_diff"],
    "ADJFORM": ["net5_diff", "adjnet5_diff"],
    "FRAGILE": ["fragile5_diff"],
}


def team_features(teams: pd.DataFrame, players: pd.DataFrame | None = None, ab: pd.DataFrame | None = None) -> pd.DataFrame:
    """One row per (GAME_ID, TEAM_ID), about the team's EARLIER games only, over its last 5:
    `soft5` the opponents' mean absent talent, `net5` the mean margin, `adjnet5` the mean margin with the absences of both sides taken out (margin - K x (opponent absent - own absent)),
    `fragile5` how many of them were narrow results (a win by at most 6, or any loss) against a depleted opponent."""
    t = G._team_games(teams)
    if ab is None:                                                       # `ab` (GAME_ID, TEAM_ID, ab_gs) can be passed in, which is how the tests give it known absences
        ab = G.team_absences(players.assign(GS=V.game_score(players)), cross_season=True)
    ab = ab[["GAME_ID", "TEAM_ID", "ab_gs"]].drop_duplicates(["GAME_ID", "TEAM_ID"])
    t = t.merge(ab.rename(columns={"ab_gs": "own_ab"}), on=["GAME_ID", "TEAM_ID"], how="left")
    t = t.merge(ab.rename(columns={"TEAM_ID": "OPP", "ab_gs": "opp_ab"}), on=["GAME_ID", "OPP"], how="left")
    t = t.sort_values(["TEAM_ID", "date", "GAME_ID"]).reset_index(drop=True)
    t[["own_ab", "opp_ab"]] = t[["own_ab", "opp_ab"]].fillna(0.0)
    margin = (t.PTS - t.opp_pts).astype(float)
    adj = margin - K_POINTS * (t.opp_ab - t.own_ab)
    narrow = ((margin <= CLOSE) & (t.opp_ab >= DEPLETED)).astype(float)       # a win by at most 6, or a loss, against a depleted opponent
    roll = lambda s: s.groupby(t.TEAM_ID).transform(lambda x: x.shift(1).rolling(WINDOW, min_periods=MIN_GAMES).mean())   # noqa: E731
    out = t[["GAME_ID", "TEAM_ID"]].copy()
    out["soft5"], out["net5"], out["adjnet5"] = roll(t.opp_ab), roll(margin), roll(adj)
    out["fragile5"] = roll(narrow) * WINDOW
    return out.fillna({c: 0.0 for c in ("soft5", "net5", "adjnet5", "fragile5")})


def build_v7(base: pd.DataFrame, teams: pd.DataFrame, players: pd.DataFrame) -> pd.DataFrame:
    """`base` is the v1 + v2 frame. Adds every candidate column (home minus away)."""
    g = base.copy()
    tf = team_features(teams, players).drop_duplicates(["GAME_ID", "TEAM_ID"]).set_index(["GAME_ID", "TEAM_ID"])
    home, away = list(zip(g.GAME_ID, g.home_id)), list(zip(g.GAME_ID, g.away_id))
    for c in ("soft5", "net5", "adjnet5", "fragile5"):
        g[f"{c}_diff"] = tf[c].reindex(home).to_numpy() - tf[c].reindex(away).to_numpy()
    return g
