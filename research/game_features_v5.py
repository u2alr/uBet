"""Game-winner features v5 candidates (rules and definitions: PREREG_GAMES_V5.md). Research only: nothing in production probability code imports this module.

Every value for a game uses only games on EARLIER dates.
"""
import numpy as np
import pandas as pd

import game_features as G
import human_factors as HF

EAST = ["ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DET", "IND", "MIA", "MIL", "NYK", "ORL", "PHI", "TOR", "WAS"]
WEST = ["DAL", "DEN", "GSW", "HOU", "LAC", "LAL", "MEM", "MIN", "NOP", "OKC", "PHX", "POR", "SAC", "SAS", "UTA"]
CONFERENCE = {**{t: "E" for t in EAST}, **{t: "W" for t in WEST}}
SEASON_GAMES, MIN_PLAYED, LINE_SAFE, LINE_OUT, PAD = 82, 50, 7, 10, 5
GROUPS = {
    "DENSITY": ["three_in_four_diff", "four_in_six_diff", "g7_diff"],
    "TRAVEL": ["away_miles", "away_tz", "away_road_trip", "home_elev", "home_miles"],
    "MOTIVATION": ["cushion_diff", "outofit_diff"],
    "STYLE": list(G.GROUPS["STYLE"]),
}


def motivation(teams: pd.DataFrame) -> pd.DataFrame:
    """One row per (GAME_ID, TEAM_ID) of a regular-season game: `cushion` and `outofit` from the conference standings BEFORE that game's date."""
    t = G._team_games(teams)
    t = t[t.GAME_ID.astype(str).str[:1].eq("2")].copy()
    t["won"] = (t.PTS > t.opp_pts).astype(int)
    rows = []
    for _, s in t.groupby("season"):
        wins = {a: 0 for a in CONFERENCE}
        played = {a: 0 for a in CONFERENCE}
        for _, day in s.sort_values(["date", "GAME_ID"]).groupby("date", sort=True):
            line = {}
            for conf in ("E", "W"):
                w = sorted((wins[a] for a in CONFERENCE if CONFERENCE[a] == conf), reverse=True)
                line[conf] = (w[LINE_SAFE - 1], w[LINE_OUT - 1])
            for r in day.itertuples():
                conf = CONFERENCE.get(r.TEAM_ABBREVIATION)
                cushion = outofit = 0.0
                if conf and played[r.TEAM_ABBREVIATION] >= MIN_PLAYED:
                    left = SEASON_GAMES - played[r.TEAM_ABBREVIATION]
                    w7, w10 = line[conf]
                    own = wins[r.TEAM_ABBREVIATION]
                    cushion = float(np.clip((own - w7) / (left + PAD), 0, 1))
                    outofit = float(np.clip((w10 - own) / (left + PAD), 0, 1))
                rows.append((r.GAME_ID, r.TEAM_ID, cushion, outofit))
            for r in day.itertuples():                                  # only after every game of the day was recorded
                if r.TEAM_ABBREVIATION in wins:
                    wins[r.TEAM_ABBREVIATION] += r.won
                    played[r.TEAM_ABBREVIATION] += 1
    return pd.DataFrame(rows, columns=["GAME_ID", "TEAM_ID", "cushion", "outofit"])


def build_v5(base: pd.DataFrame, teams: pd.DataFrame) -> pd.DataFrame:
    """`base` is the v1 + v2 frame (it already holds the travel and style columns). Adds every candidate column."""
    g = base.copy()
    hf = HF.team_features(teams).set_index(["GAME_ID", "TEAM_ID"])
    mo = motivation(teams).drop_duplicates(["GAME_ID", "TEAM_ID"]).set_index(["GAME_ID", "TEAM_ID"])
    home, away = list(zip(g.GAME_ID, g.home_id)), list(zip(g.GAME_ID, g.away_id))
    for name, col in (("three_in_four_diff", "hf_three_in_four"), ("four_in_six_diff", "hf_four_in_six"), ("g7_diff", "hf_g7")):
        g[name] = hf[col].reindex(home).to_numpy() - hf[col].reindex(away).to_numpy()
    g["home_miles"] = hf["hf_miles"].reindex(home).to_numpy()
    for name, col in (("cushion_diff", "cushion"), ("outofit_diff", "outofit")):
        g[name] = mo[col].reindex(home).to_numpy() - mo[col].reindex(away).to_numpy()
    return g
