"""Human Factors features (rules and definitions: PREREG_HUMAN_FACTORS.md). Research-only: nothing in production imports this module.

`add_human_factors(df, teams)` takes the frame from features.build() and the raw team box scores (features.load_raw()) and adds columns prefixed `hf_`.
EVERY value for a game uses only games strictly before it. Locations come from shared/arenas.json (estimates: city-level coordinates, never flights);
a missing or unknown location gives NaN, not a guess. A "previous game" is always a game that was actually played, so postponed games cannot appear.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

STATS = ["pts", "reb", "ast", "fg3m"]
ARENAS = json.loads((Path(__file__).resolve().parents[1] / "shared" / "arenas.json").read_text(encoding="utf-8"))["teams"]
SAME_CITY_MILES = 25
MAX_GAP_DAYS = 10          # travel is not computed across a longer gap (offseason, long absence)
HEAVY_EXTRA_MIN = 6        # a "heavy" game: at least this many minutes above his own recent baseline

GROUPS = {
    "REST": ["rest_days", "b2b", "b2b_type", "three_in_four", "four_in_six", "g7", "g14", "ot_prev", "ot_recent5", "opp_rest_days", "rest_diff", "opp_b2b", "opp_g7"],
    "TRAVEL": ["miles", "tz_shift", "east_shift", "road_trip", "same_city", "miles_x_short", "tz_x_short", "opp_miles", "opp_road_trip", "opp_at_home"],
    "ELEVATION": ["elev", "elev_up"],
    "WORKLOAD": ["cum3", "cum5", "cum7", "cum14", "min_prev", "min_prev_z", "heavy_prev", "heavy_l10", "workload_ratio", "cum7_ratio", "ret_n"] + [f"short_rest_{s}" for s in STATS],
}
GROUPS = {g: [f"hf_{c}" for c in cols] for g, cols in GROUPS.items()}
ALL = [c for cols in GROUPS.values() for c in cols]


def haversine_miles(a: dict, b: dict) -> float:
    lat1, lon1, lat2, lon2 = map(np.radians, (a["lat"], a["lon"], b["lat"], b["lon"]))
    h = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return float(3958.8 * 2 * np.arcsin(np.sqrt(h)))


def game_city(matchup: str, team: str) -> str | None:
    """Where the game was played: the designated home team's city. 'BOS vs. PHI' is a BOS home game; 'PHI @ BOS' is played in BOS. Anything else is unknown."""
    if " vs. " in matchup:
        return team
    if " @ " in matchup:
        return matchup.split(" @ ")[1].strip()
    return None


def b2b_type(prev_home: int, home: int) -> int:
    """Back-to-back TYPE (not every back-to-back is equally taxing): 1 home-home, 2 road-road, 3 road-home, 4 home-road."""
    return {(1, 1): 1, (0, 0): 2, (0, 1): 3, (1, 0): 4}[(int(prev_home), int(home))]


def team_features(teams: pd.DataFrame) -> pd.DataFrame:
    """One row per (team, game): schedule, rest, travel and altitude estimates, plus the opponent's, from PRIOR games only."""
    t = teams.drop_duplicates(["GAME_ID", "TEAM_ID"]).copy()                  # duplicate schedule records collapse
    t["date"] = pd.to_datetime(t.GAME_DATE)
    t = t.sort_values(["TEAM_ID", "date", "GAME_ID"]).reset_index(drop=True)
    t["home"] = t.MATCHUP.str.contains(" vs. ").astype(int)
    t["city"] = [game_city(m, a) for m, a in zip(t.MATCHUP, t.TEAM_ABBREVIATION)]
    t["ot"] = (t["MIN"] > 240).astype(float)
    out = {c: np.full(len(t), np.nan) for c in ["rest_days", "b2b", "b2b_type", "three_in_four", "four_in_six", "g7", "g14", "ot_prev", "ot_recent5", "miles", "tz_shift",
                                               "east_shift", "road_trip", "same_city", "miles_x_short", "tz_x_short", "elev", "elev_up"]}
    day = t.date.values.astype("datetime64[D]").astype(int)
    for _, idx in t.groupby("TEAM_ID", sort=False).indices.items():
        idx = np.asarray(idx)
        d, h, ct, ot = day[idx], t.home.to_numpy()[idx], t.city.to_numpy(object)[idx], t.ot.to_numpy()[idx]
        for i in range(len(idx)):
            r = idx[i]
            here = ARENAS.get(ct[i])
            if here:
                out["elev"][r] = here["elevationFt"]
            if i == 0:
                continue
            gap = d[i] - d[i - 1]
            out["rest_days"][r] = min(gap, MAX_GAP_DAYS)
            out["b2b"][r] = 1.0 if gap == 1 else 0.0
            out["b2b_type"][r] = b2b_type(h[i - 1], h[i]) if gap == 1 else 0
            out["three_in_four"][r] = 1.0 if (i - np.searchsorted(d, d[i] - 3, side="left")) >= 2 else 0.0
            out["four_in_six"][r] = 1.0 if (i - np.searchsorted(d, d[i] - 5, side="left")) >= 3 else 0.0
            out["g7"][r] = i - np.searchsorted(d, d[i] - 7, side="left")
            out["g14"][r] = i - np.searchsorted(d, d[i] - 14, side="left")
            out["ot_prev"][r] = ot[i - 1]
            out["ot_recent5"][r] = ot[max(0, i - 5):i].sum()
            run, j = 0, i - 1
            while j >= 0 and h[j] == 0 and d[i] - d[j] <= 14:
                run += 1
                j -= 1
            out["road_trip"][r] = run
            prev = ARENAS.get(ct[i - 1])
            if here and prev and gap <= MAX_GAP_DAYS:
                miles = haversine_miles(prev, here)
                tz = here["tz"] - prev["tz"]
                short = 1.0 if gap <= 1 else 0.0
                out["miles"][r], out["tz_shift"][r] = miles, tz
                out["east_shift"][r] = 1.0 if tz > 0 else 0.0
                out["same_city"][r] = 1.0 if miles < SAME_CITY_MILES else 0.0
                out["miles_x_short"][r], out["tz_x_short"][r] = miles * short, abs(tz) * short
                out["elev_up"][r] = here["elevationFt"] - prev["elevationFt"]
    f = pd.DataFrame({f"hf_{k}": v for k, v in out.items()})
    f["GAME_ID"], f["TEAM_ID"], f["hf_home"] = t.GAME_ID.values, t.TEAM_ID.values, t.home.values
    # Opponent's and the difference: join the other team of the same game.
    opp = f[["GAME_ID", "TEAM_ID", "hf_rest_days", "hf_b2b", "hf_g7", "hf_miles", "hf_road_trip"]].rename(columns={
        "TEAM_ID": "OPP", "hf_rest_days": "hf_opp_rest_days", "hf_b2b": "hf_opp_b2b", "hf_g7": "hf_opp_g7", "hf_miles": "hf_opp_miles", "hf_road_trip": "hf_opp_road_trip"})
    f = f.merge(opp, on="GAME_ID")
    f = f[f.TEAM_ID != f.OPP].drop(columns="OPP")
    f["hf_rest_diff"] = f.hf_rest_days - f.hf_opp_rest_days
    f["hf_opp_at_home"] = 1 - f.hf_home
    return f.drop(columns="hf_home").drop_duplicates(["GAME_ID", "TEAM_ID"])


def add_human_factors(df: pd.DataFrame, teams: pd.DataFrame) -> pd.DataFrame:
    df = df.sort_values(["PLAYER_ID", "date", "GAME_ID"]).reset_index(drop=True)
    tf = team_features(teams)
    df = df.merge(tf, on=["GAME_ID", "TEAM_ID"], how="left")
    team_rest = df["hf_rest_days"].to_numpy(float)

    cols = {c: np.full(len(df), np.nan) for c in ["cum3", "cum5", "cum7", "cum14", "min_prev", "min_prev_z", "heavy_prev", "heavy_l10", "workload_ratio", "cum7_ratio", "ret_n"]
            + [f"short_rest_{s}" for s in STATS]}
    day = df.date.values.astype("datetime64[D]").astype(int)
    mins = df.minutes.to_numpy(float)
    base20 = df["min_l20"].to_numpy(float)
    s2d = df["min_s2d"].to_numpy(float)
    sd10 = df["min_sd10"].to_numpy(float)
    l5 = df["min_l5"].to_numpy(float)
    rate = {s: df[s].to_numpy(float) / np.maximum(mins, 1.0) for s in STATS}
    # Team game order, to count team games a player missed between two appearances.
    order = teams.drop_duplicates(["GAME_ID", "TEAM_ID"]).assign(date=lambda x: pd.to_datetime(x.GAME_DATE)).sort_values(["TEAM_ID", "date", "GAME_ID"])
    team_pos = {(tid, gid): k for _, g in order.groupby("TEAM_ID") for k, (tid, gid) in enumerate(zip(g.TEAM_ID, g.GAME_ID))}
    tids, gids = df.TEAM_ID.to_numpy(), df.GAME_ID.to_numpy()
    for _, idx in df.groupby("PLAYER_ID", sort=False).indices.items():
        idx = np.asarray(idx)
        d, m = day[idx], mins[idx]
        cum = np.concatenate([[0.0], np.cumsum(m)])
        heavy = (m - base20[idx]) >= HEAVY_EXTRA_MIN
        heavy = np.where(np.isnan(base20[idx]), False, heavy)
        ret_prev = 0
        for i in range(len(idx)):
            row = idx[i]
            if i == 0:
                continue
            for name, w in (("cum3", 3), ("cum5", 5), ("cum7", 7), ("cum14", 14)):
                lo = np.searchsorted(d, d[i] - w, side="left")
                cols[name][row] = cum[i] - cum[lo]
            cols["min_prev"][row] = m[i - 1]
            if not np.isnan(s2d[row]):
                cols["min_prev_z"][row] = (m[i - 1] - s2d[row]) / max(sd10[row] if not np.isnan(sd10[row]) else 3.0, 3.0)
                cols["workload_ratio"][row] = l5[row] / s2d[row] if s2d[row] > 0 else np.nan
            cols["heavy_prev"][row] = float(heavy[i - 1])
            cols["heavy_l10"][row] = float(heavy[max(0, i - 10):i].sum())
            g7 = i - np.searchsorted(d, d[i] - 7, side="left")
            if not np.isnan(base20[row]) and base20[row] > 0:
                cols["cum7_ratio"][row] = (cum[i] - cum[np.searchsorted(d, d[i] - 7, side="left")]) / (base20[row] * max(g7, 1))
            # return from an absence: team games missed since his last appearance (known before the game)
            a, b = team_pos.get((tids[idx[i - 1]], gids[idx[i - 1]])), team_pos.get((tids[row], gids[row]))
            missed = (b - a - 1) if (a is not None and b is not None and tids[idx[i - 1]] == tids[row]) else np.nan
            if not np.isnan(missed) and missed >= 4:
                ret_prev = 1
            elif 1 <= ret_prev < 5:
                ret_prev += 1
            else:
                ret_prev = 0
            cols["ret_n"][row] = ret_prev
            lo40 = max(0, i - 40)
            short = team_rest[idx[lo40:i]] <= 1
            valid = ~np.isnan(team_rest[idx[lo40:i]])
            n_s, n_o = int((short & valid).sum()), int((~short & valid).sum())
            for s in STATS:
                r = rate[s][idx[lo40:i]]
                cols[f"short_rest_{s}"][row] = 0.0 if (n_s < 3 or n_o < 3) else (r[short & valid].mean() - r[~short & valid].mean()) * n_s / (n_s + 5)
    for k, v in cols.items():
        df[f"hf_{k}"] = v
    return df.sort_values(["date", "GAME_ID", "PLAYER_ID"]).reset_index(drop=True)
