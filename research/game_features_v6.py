"""Game-winner features v6 candidates (rules and definitions: PREREG_GAMES_V6.md). Research only: nothing in production probability code imports this module.

Every value for a game uses only games on EARLIER dates; the one same-game fact is who played (history), as in v3 and v4.
"""
import numpy as np
import pandas as pd

import game_features as G
import game_features_v3 as V3

HALF_LIFE, EARLY_GAMES, SD_WINDOW, MIN_CAP, MIN_WINDOW = 20, 20, 20, 36.0, 10
GROUPS = {
    "FOURFACTORS": ["ff_efg", "ff_tov", "ff_orb", "ff_ftr"],
    "UNCERTAINTY": ["early", "early_x_elo", "early_x_srs60"],
    "PLAYERRATING": ["tal_diff"],
    "CONCENTRATION": ["conc_diff", "conc_x_abgs"],
    "PACEVAR": ["pace_l20", "sd_sum", "sd_x_srs60"],
}
FACTORS = ("efg", "tov", "orb", "ftr")


def _prior_ewm(x: pd.Series, team: pd.Series) -> pd.Series:
    """Decayed average of the team's EARLIER values (the current game never enters)."""
    return x.groupby(team).transform(lambda s: s.shift(1).ewm(halflife=HALF_LIFE, min_periods=1).mean())


def team_features(teams: pd.DataFrame) -> pd.DataFrame:
    """One row per (GAME_ID, TEAM_ID): the opponent-adjusted four factors (`efg`, `tov`, `orb`, `ftr`, higher is better), games played this season, and the margin's spread over the last 20 games."""
    t = G._team_games(teams).sort_values(["TEAM_ID", "date", "GAME_ID"]).reset_index(drop=True)
    t["poss"] = t.FGA + 0.44 * t.FTA + t.TOV - t.OREB
    own = pd.DataFrame({"efg": (t.FGM + 0.5 * t.FG3M) / t.FGA, "tov": t.TOV / t.poss, "orb": t.OREB / (t.OREB + t.opp_dreb), "ftr": t.FTA / t.FGA})
    key = t[["GAME_ID", "TEAM_ID", "OPP"]].copy()
    for f in FACTORS:                                       # what the opponent did in the same game = what this team allowed
        key[f"o_{f}"] = own[f]
    opp = key.rename(columns={"TEAM_ID": "OPP", "OPP": "TEAM_ID", **{f"o_{f}": f"alw_{f}" for f in FACTORS}})
    t = t.merge(opp[["GAME_ID", "TEAM_ID"] + [f"alw_{f}" for f in FACTORS]], on=["GAME_ID", "TEAM_ID"], how="left")
    for f in FACTORS:
        t[f"prod_{f}"] = own[f].to_numpy()
    out = t[["GAME_ID", "TEAM_ID", "OPP", "date", "season"]].copy()
    for f in FACTORS:
        out[f"pp_{f}"] = _prior_ewm(t[f"prod_{f}"], t.TEAM_ID)          # prior produced average of this team
        out[f"pa_{f}"] = _prior_ewm(t[f"alw_{f}"], t.TEAM_ID)           # prior allowed average of this team
    opp_prior = out[["GAME_ID", "TEAM_ID"] + [f"{k}_{f}" for k in ("pp", "pa") for f in FACTORS]].rename(columns={"TEAM_ID": "OPP", **{f"{k}_{f}": f"opp_{k}_{f}" for k in ("pp", "pa") for f in FACTORS}})
    out = out.merge(opp_prior, on=["GAME_ID", "OPP"], how="left")
    adj_off, adj_alw = pd.DataFrame(index=out.index), pd.DataFrame(index=out.index)
    for f in FACTORS:
        adj_off[f] = t[f"prod_{f}"].to_numpy() - out[f"opp_pa_{f}"].to_numpy()       # produced against what this opponent usually allows
        adj_alw[f] = t[f"alw_{f}"].to_numpy() - out[f"opp_pp_{f}"].to_numpy()        # allowed against what this opponent usually produces
    res = t[["GAME_ID", "TEAM_ID"]].copy()
    for f in FACTORS:
        a, b = _prior_ewm(adj_off[f], t.TEAM_ID), _prior_ewm(adj_alw[f], t.TEAM_ID)
        res[f] = (b - a) if f == "tov" else (a - b)                                 # forcing turnovers is the good side
    res = res.fillna({f: 0.0 for f in FACTORS})
    res["played"] = t.groupby(["TEAM_ID", "season"]).cumcount().to_numpy()          # games played earlier this season
    margin = pd.Series((t.PTS - t.opp_pts).to_numpy(float))
    res["sd"] = margin.groupby(t.TEAM_ID.to_numpy()).transform(lambda s: s.shift(1).rolling(SD_WINDOW, min_periods=5).std()).to_numpy()
    return res


def roster_strength(players: pd.DataFrame) -> pd.DataFrame:
    """One row per (GAME_ID, TEAM_ID): `tal` = sum over the players who play of (prior mean minutes, capped) x (prior mean Game Score) / 240, and `conc`, the share of the
    positive talent held by the two best of them."""
    p = V3._prep(players)
    g = p.groupby("PLAYER_ID")
    p["v_prior"] = g.GS.transform(lambda s: s.shift(1).rolling(V3.TALENT_WINDOW, min_periods=V3.MIN_APPEARANCES).mean())
    p["m_prior"] = g["MIN"].transform(lambda s: s.shift(1).rolling(MIN_WINDOW, min_periods=V3.MIN_APPEARANCES).mean())
    p = p.dropna(subset=["v_prior", "m_prior"])
    p["w"] = p.m_prior.clip(upper=MIN_CAP) * p.v_prior / 240.0
    p["v_pos"] = p.v_prior.clip(lower=0.0)

    def agg(x):
        top2 = x.v_pos.nlargest(2).sum()
        tot = x.v_pos.sum()
        return pd.Series({"tal": x.w.sum(), "conc": top2 / tot if tot > 0 else np.nan})

    return p.groupby(["GAME_ID", "TEAM_ID"]).apply(agg).reset_index()


def build_v6(base: pd.DataFrame, teams: pd.DataFrame, players: pd.DataFrame) -> pd.DataFrame:
    """`base` is the v1 + v2 frame. Adds every candidate column."""
    g = base.copy()
    tf = team_features(teams).set_index(["GAME_ID", "TEAM_ID"])
    rs = roster_strength(players).drop_duplicates(["GAME_ID", "TEAM_ID"]).set_index(["GAME_ID", "TEAM_ID"])
    home, away = list(zip(g.GAME_ID, g.home_id)), list(zip(g.GAME_ID, g.away_id))
    for f in FACTORS:
        g[f"ff_{f}"] = tf[f].reindex(home).to_numpy() - tf[f].reindex(away).to_numpy()
    played = (tf.played.reindex(home).to_numpy() + tf.played.reindex(away).to_numpy()) / 2
    g["early"] = 1.0 - np.minimum(played, EARLY_GAMES) / EARLY_GAMES
    g["early_x_elo"], g["early_x_srs60"] = g.early * g.elo_diff, g.early * g.srs60
    g["tal_diff"] = rs.tal.reindex(home).to_numpy() - rs.tal.reindex(away).to_numpy()
    g["conc_diff"] = rs.conc.reindex(home).to_numpy() - rs.conc.reindex(away).to_numpy()
    g["conc_x_abgs"] = (rs.conc.reindex(home).to_numpy() + rs.conc.reindex(away).to_numpy()) / 2 * g.ab_gs
    g["sd_sum"] = tf.sd.reindex(home).to_numpy() + tf.sd.reindex(away).to_numpy()
    g["sd_x_srs60"] = g.sd_sum / 2 * g.srs60
    return g
