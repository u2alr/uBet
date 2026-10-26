"""Research-only context features (rules: PREREG_CONTEXT.md). Every feature uses games strictly BEFORE the game it describes.

NOT used by production. `add_context(df, teams)` takes the frame from features.build() and the raw team box scores (features.load_raw()) and adds columns
prefixed `ctx_`. Nothing here infers psychology or motivation: only schedule, workload, final margins, minutes and a static table of team cities.
"""
import numpy as np
import pandas as pd

STATS = ["pts", "reb", "ast", "fg3m"]
# City centres (public geography) and standard-time UTC offsets. Used only to measure distance and time-zone change between consecutive games.
CITY = {
    "ATL": (33.757, -84.396, -5), "BKN": (40.683, -73.975, -5), "BOS": (42.366, -71.062, -5), "CHA": (35.225, -80.839, -5), "CHI": (41.881, -87.674, -6),
    "CLE": (41.496, -81.688, -5), "DAL": (32.790, -96.810, -6), "DEN": (39.749, -105.008, -7), "DET": (42.341, -83.055, -5), "GSW": (37.768, -122.388, -8),
    "HOU": (29.751, -95.362, -6), "IND": (39.764, -86.156, -5), "LAC": (33.943, -118.341, -8), "LAL": (34.043, -118.267, -8), "MEM": (35.138, -90.051, -6),
    "MIA": (25.781, -80.187, -5), "MIL": (43.045, -87.917, -6), "MIN": (44.980, -93.276, -6), "NOP": (29.949, -90.082, -6), "NYK": (40.751, -73.994, -5),
    "OKC": (35.463, -97.515, -6), "ORL": (28.539, -81.384, -5), "PHI": (39.901, -75.172, -5), "PHX": (33.446, -112.071, -7), "POR": (45.532, -122.667, -8),
    "SAC": (38.580, -121.500, -8), "SAS": (29.427, -98.437, -6), "TOR": (43.643, -79.379, -5), "UTA": (40.768, -111.901, -7), "WAS": (38.898, -77.021, -5),
}
CLOSE_MARGIN = 5
GROUPS = {
    "FATIGUE": ["ctx_g7", "ctx_g14", "ctx_min7", "ctx_three_in_four", "ctx_ot_recent"],
    "TRAVEL": ["ctx_miles_prev", "ctx_tz_shift", "ctx_road_trip"],
    "PRESSURE": ["ctx_close_share10"] + [f"ctx_close_diff_{s}" for s in STATS],
    "ROLE": ["ctx_min_delta", "ctx_min_cv10"],
    "CONTINUITY": ["ctx_overlap"],
}
ALL = [c for cols in GROUPS.values() for c in cols]


def haversine_miles(a: tuple, b: tuple) -> float:
    lat1, lon1, lat2, lon2 = map(np.radians, (a[0], a[1], b[0], b[1]))
    h = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return float(3958.8 * 2 * np.arcsin(np.sqrt(h)))


def _game_city(matchup: str, team: str) -> str | None:
    """The city the game was played in: the home team's. 'BOS vs. PHI' is a BOS home game; 'PHI @ BOS' is played in BOS."""
    if " vs. " in matchup:
        return team
    if " @ " in matchup:
        return matchup.split(" @ ")[1].strip()
    return None


def _team_level(df: pd.DataFrame, teams: pd.DataFrame) -> pd.DataFrame:
    """Per (team, game): overtime games among the team's previous 5, and the lineup overlap between its previous two games. Prior games only."""
    t = teams.copy()
    t["date"] = pd.to_datetime(t.GAME_DATE)
    t = t.sort_values(["TEAM_ID", "date", "GAME_ID"]).reset_index(drop=True)
    t["ot"] = (t["MIN"] > 240).astype(float)
    t["ctx_ot_recent"] = t.groupby("TEAM_ID")["ot"].transform(lambda x: x.shift(1).rolling(5, min_periods=1).sum())
    # Lineup overlap: players with 10+ minutes in the previous game that also had 10+ in the game before it.
    rot = df[df.minutes >= 10].groupby(["TEAM_ID", "GAME_ID"]).PLAYER_ID.apply(frozenset)
    out = []
    for team, tg in t.groupby("TEAM_ID", sort=False):
        order = tg.GAME_ID.tolist()
        sets = [rot.get((team, g), frozenset()) for g in order]
        for i, g in enumerate(order):
            ov = np.nan
            if i >= 2 and sets[i - 1]:
                ov = len(sets[i - 1] & sets[i - 2]) / len(sets[i - 1])
            out.append((team, g, ov))
    ov = pd.DataFrame(out, columns=["TEAM_ID", "GAME_ID", "ctx_overlap"])
    return t[["TEAM_ID", "GAME_ID", "ctx_ot_recent"]].merge(ov, on=["TEAM_ID", "GAME_ID"], how="left")


def add_context(df: pd.DataFrame, teams: pd.DataFrame) -> pd.DataFrame:
    df = df.sort_values(["PLAYER_ID", "date", "GAME_ID"]).reset_index(drop=True)
    margin = teams.assign(margin=teams.PLUS_MINUS.abs()).set_index(["GAME_ID", "TEAM_ID"])["margin"]
    df["ctx_close"] = [1.0 if margin.get((g, t), np.nan) <= CLOSE_MARGIN else (0.0 if not np.isnan(margin.get((g, t), np.nan)) else np.nan) for g, t in zip(df.GAME_ID, df.TEAM_ID)]
    df["ctx_city"] = [_game_city(m, a) for m, a in zip(df.MATCHUP, df.TEAM_ABBREVIATION)]

    cols = {c: np.full(len(df), np.nan) for c in ALL if c not in ("ctx_ot_recent", "ctx_overlap", "ctx_min_delta", "ctx_min_cv10")}
    day = df.date.values.astype("datetime64[D]").astype(int)
    mins = df.minutes.to_numpy(float)
    close = df.ctx_close.to_numpy(float)
    home = df.home.to_numpy(float)
    city = df.ctx_city.to_numpy(object)
    rate = {s: df[s].to_numpy(float) / np.maximum(mins, 1.0) for s in STATS}
    start = 0
    for _, idx in df.groupby("PLAYER_ID", sort=False).indices.items():
        idx = np.asarray(idx)
        d, m, c, h, ct = day[idx], mins[idx], close[idx], home[idx], city[idx]
        cum = np.concatenate([[0.0], np.cumsum(m)])
        for i in range(len(idx)):
            row = idx[i]
            if i == 0:
                continue
            lo7 = np.searchsorted(d, d[i] - 7, side="left")
            lo14 = np.searchsorted(d, d[i] - 14, side="left")
            lo3 = np.searchsorted(d, d[i] - 3, side="left")
            cols["ctx_g7"][row] = i - lo7
            cols["ctx_g14"][row] = i - lo14
            cols["ctx_min7"][row] = cum[i] - cum[lo7]
            cols["ctx_three_in_four"][row] = 1.0 if (i - lo3) >= 2 else 0.0
            # travel: previous game's city to this one, unless the gap is long (offseason, injury)
            a, b = ct[i - 1], ct[i]
            if a in CITY and b in CITY and d[i] - d[i - 1] <= 10:
                cols["ctx_miles_prev"][row] = haversine_miles(CITY[a], CITY[b])
                cols["ctx_tz_shift"][row] = CITY[b][2] - CITY[a][2]
            run = 0
            j = i - 1
            while j >= 0 and h[j] == 0 and d[i] - d[j] <= 14:
                run += 1
                j -= 1
            cols["ctx_road_trip"][row] = run
            lo10 = max(0, i - 10)
            cl = c[lo10:i]
            if len(cl) >= 3 and not np.isnan(cl).any():
                cols["ctx_close_share10"][row] = cl.mean()
            lo20 = max(0, i - 20)
            cl20 = c[lo20:i]
            for s in STATS:
                r = rate[s][idx][lo20:i]
                is_close, ok = cl20 == 1.0, ~np.isnan(cl20)
                n_close, n_other = int((is_close & ok).sum()), int((~is_close & ok).sum())
                cols[f"ctx_close_diff_{s}"][row] = 0.0 if (n_close < 3 or n_other < 3) else (r[is_close & ok].mean() - r[~is_close & ok].mean()) * n_close / (n_close + 5)
    for k, v in cols.items():
        df[k] = v
    df["ctx_min_delta"] = df["min_l5"] - df["min_l20"]
    df["ctx_min_cv10"] = df["min_sd10"] / df["min_l10"].replace(0, np.nan)
    tl = _team_level(df, teams)
    df = df.merge(tl, on=["TEAM_ID", "GAME_ID"], how="left", suffixes=("", "_t"))
    return df.drop(columns=["ctx_close", "ctx_city"]).sort_values(["date", "GAME_ID", "PLAYER_ID"]).reset_index(drop=True)
