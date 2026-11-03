"""Game-winner features v2 (rules and definitions: PREREG_GAMES_V2.md). Research and display only: nothing in production probability code imports this module.

Every value for a game uses only games on EARLIER DATES: the ridge ratings are solved from state that excludes the day's own games, the talent of an absentee is read
from the team's previous ten games, and the common-opponent tally looks only backwards.
"""
import bisect

import numpy as np
import pandas as pd

import game_features as G

HALF_LIVES = (30, 60, 120)
RIDGE = 10.0
MARGIN_CLIP = 25.0
OFFSEASON_CAP_DAYS = 45


def game_score(p: pd.DataFrame) -> pd.Series:
    """Hollinger Game Score of one player-game: a single-number summary of a box score (points, efficiency, rebounds, assists, steals, blocks, minus misses, fouls, turnovers)."""
    return (p.PTS + 0.4 * p.FGM - 0.7 * p.FGA - 0.4 * (p.FTA - p.FTM) + 0.7 * p.OREB + 0.3 * p.DREB + p.STL + 0.7 * p.AST + 0.7 * p.BLK - 0.4 * p.PF - p.TOV)


class Srs:
    """Decayed ridge margin ratings, updated one date at a time. `ratings()` is the state BEFORE the games added next: that is what makes it prior-only."""

    def __init__(self, team_ids, half_life: float, ridge: float = RIDGE):
        self.ix = {t: i for i, t in enumerate(sorted(team_ids))}
        self.m = len(self.ix) + 1                       # the last column is the home-court term
        self.A = np.zeros((self.m, self.m))
        self.b = np.zeros(self.m)
        self.gamma = 0.5 ** (1.0 / half_life)
        self.ridge = ridge
        self.last = None

    def advance(self, date: pd.Timestamp):
        if self.last is not None:
            days = min((date - self.last).days, OFFSEASON_CAP_DAYS)
            f = self.gamma ** max(days, 0)
            self.A *= f
            self.b *= f
        self.last = date

    def solve(self) -> np.ndarray:
        reg = np.eye(self.m) * self.ridge
        reg[-1, -1] = 1e-6                              # the home-court term is not shrunk
        return np.linalg.solve(self.A + reg, self.b)

    def add(self, home, away, margin: float):
        x = np.zeros(self.m)
        x[self.ix[home]], x[self.ix[away]], x[-1] = 1.0, -1.0, 1.0
        self.A += np.outer(x, x)
        self.b += x * float(np.clip(margin, -MARGIN_CLIP, MARGIN_CLIP))


def srs_table(t: pd.DataFrame, half_lives=HALF_LIVES) -> tuple[pd.DataFrame, dict[int, Srs]]:
    """One row per game: each half-life's home rating, away rating and home-court term, read BEFORE the game. `t` is `game_features._team_games(teams)`.

    Also returns the fitted state (after every game in `t`) for scoring games that have not been played yet.
    """
    games = t[t.home == 1][["GAME_ID", "date", "TEAM_ID", "OPP", "PTS", "opp_pts"]].sort_values(["date", "GAME_ID"])
    teams = sorted(set(games.TEAM_ID) | set(games.OPP))
    models = {h: Srs(teams, h) for h in half_lives}
    rows = []
    for date, day in games.groupby("date", sort=True):
        beta = {}
        for h, m in models.items():
            m.advance(date)
            beta[h] = m.solve()
        for gid, hm, aw in zip(day.GAME_ID, day.TEAM_ID, day.OPP):
            r = {"GAME_ID": gid}
            for h, m in models.items():
                b = beta[h]
                r[f"srs{h}_home"], r[f"srs{h}_away"], r[f"srs{h}_hca"] = b[m.ix[hm]], b[m.ix[aw]], b[-1]
            rows.append(r)
        for hm, aw, hp, ap in zip(day.TEAM_ID, day.OPP, day.PTS, day.opp_pts):
            for m in models.values():
                m.add(hm, aw, hp - ap)
    return pd.DataFrame(rows), models


def current_ratings(models: dict[int, Srs], as_of: pd.Timestamp) -> dict[int, tuple[dict[int, float], float]]:
    """Ratings to use for a game on `as_of`, after every played game: {half-life: ({team id: rating}, home-court term)}."""
    out = {}
    for h, m in models.items():
        c = Srs.__new__(Srs)
        c.__dict__.update({**m.__dict__, "A": m.A.copy(), "b": m.b.copy()})
        c.advance(as_of)
        beta = c.solve()
        out[h] = ({t: beta[i] for t, i in m.ix.items()}, beta[-1])
    return out


def _verdict(ra: dict, rb: dict) -> int:
    """+1 when team A did better than B against the same opponent in their latest games, -1 the other way, 0 when equal."""
    return (ra > rb) - (ra < rb)


def common_opponent(results: pd.DataFrame, pairs: pd.DataFrame, window_days: int = 400) -> pd.DataFrame:
    """For each (GAME_ID, date, home_id, away_id): the common-opponent tally from games strictly before `date` (shared/teamForm.ts logic).

    `results`: one row per team-game (team, opp, date, won). Returns `co_diff` = (home better - away better) / (opponents with a difference), and `co_n`.
    """
    res = results.sort_values("date")
    by_team: dict[int, tuple[list, list, list]] = {}
    for team, g in res.groupby("team"):
        by_team[team] = (g.date.values.astype("datetime64[D]").astype(np.int64).tolist(), g.opp.tolist(), g.won.astype(int).tolist())

    def latest(team: int, day: int, skip: set) -> dict:
        dates, opps, won = by_team.get(team, ([], [], []))
        hi = bisect.bisect_left(dates, day)
        lo = bisect.bisect_left(dates, day - window_days)
        seen = {}
        for k in range(hi - 1, lo - 1, -1):
            if opps[k] in skip or opps[k] in seen:
                continue
            seen[opps[k]] = won[k]
        return seen

    out = []
    for gid, date, h, a in zip(pairs.GAME_ID, pairs.date, pairs.home_id, pairs.away_id):
        day = int(np.datetime64(pd.Timestamp(date), "D").astype(np.int64))
        la, lb = latest(h, day, {a}), latest(a, day, {h})
        v = [_verdict(la[o], lb[o]) for o in la.keys() & lb.keys()]
        diff = sum(v)
        informative = sum(1 for x in v if x != 0)
        out.append((gid, diff / informative if informative else 0.0, informative))
    return pd.DataFrame(out, columns=["GAME_ID", "co_diff", "co_n"])


def build_v2(base: pd.DataFrame, teams: pd.DataFrame, players: pd.DataFrame) -> pd.DataFrame:
    """`base` is `game_features.build_games` output (one row per game). Returns it with the v2 columns added."""
    t = G._team_games(teams)
    srs, _ = srs_table(t)
    g = base.merge(srs, on="GAME_ID", how="left")
    for h in HALF_LIVES:
        g[f"srs{h}"] = g[f"srs{h}_home"] - g[f"srs{h}_away"]
        g[f"srs{h}_pred"] = g[f"srs{h}"] + g[f"srs{h}_hca"]
    p = players.assign(GS=game_score(players))
    ab = G.team_absences(p, cross_season=True).set_index(["GAME_ID", "TEAM_ID"])
    hv = ab.reindex(list(zip(g.GAME_ID, g.home_id)))
    av = ab.reindex(list(zip(g.GAME_ID, g.away_id)))
    g["ab_gs"] = hv.ab_gs.values - av.ab_gs.values
    results = pd.DataFrame({"team": t.TEAM_ID, "opp": t.OPP, "date": t.date, "won": (t.PTS > t.opp_pts)})
    g = g.merge(common_opponent(results, g[["GAME_ID", "date", "home_id", "away_id"]]), on="GAME_ID", how="left")
    return g


V2_NEW = ["srs30", "srs60", "srs120", "ab_gs", "co_diff"]
SCHEDULE = ["rest_diff", "b2b_home", "b2b_away"]
LIN_V2 = G.BASE + ["srs30", "srs60", "srs120"] + G.GROUPS["AVAIL3"] + ["ab_gs", "co_diff"] + SCHEDULE
GBM_V2 = LIN_V2 + ["net_l10", "net_l20", "off_l20", "def_l20", "pace_l20"]
