"""A small, deterministic, synthetic league in the same CSV layout as research/pull_raw.py writes. For CI and tests only: NOT real data, and nothing
fitted to it means anything. It exists so the point-in-time feature code and the leakage test can run without NBA.com or any paid API.

    python research/tests/fixture_data.py <output_dir>
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

SEASONS = ["2022-23", "2023-24", "2024-25"]
TEAMS = [(1610612737 + i, abbr) for i, abbr in enumerate(["ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN"])]   # real abbreviations, so the travel table applies
PLAYERS_PER_TEAM = 9


def make(out: Path, seed: int = 7) -> None:
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(seed)
    pid_base = 1000
    skill = {}
    for t, (tid, _) in enumerate(TEAMS):
        for k in range(PLAYERS_PER_TEAM):
            skill[(tid, k)] = (pid_base + t * 20 + k, rng.uniform(4, 28), rng.uniform(14, 36))   # (player id, points rate, minutes)
    gid = 22200000
    for si, season in enumerate(SEASONS):
        start = pd.Timestamp(f"{2022 + si}-10-20")
        p_rows, t_rows = [], []
        for day in range(0, 150, 2):                       # a game day every other day
            date = start + pd.Timedelta(days=day)
            order = rng.permutation(len(TEAMS))
            for a, h in zip(order[0::2], order[1::2]):
                gid += 1
                for tid, abbr, opp_abbr, home in ((TEAMS[h][0], TEAMS[h][1], TEAMS[a][1], 1), (TEAMS[a][0], TEAMS[a][1], TEAMS[h][1], 0)):
                    matchup = f"{abbr} vs. {opp_abbr}" if home else f"{abbr} @ {opp_abbr}"
                    tot = dict(PTS=0, FGA=0, FTA=0, TOV=0, OREB=0)
                    for k in range(PLAYERS_PER_TEAM):
                        pid, rate, mins = skill[(tid, k)]
                        if rng.random() < 0.06:            # a missed game
                            continue
                        m = float(np.clip(rng.normal(mins if k < 7 else 8, 4), 2, 42))
                        pts = int(rng.poisson(rate * m / 30))
                        reb, ast, fg3m = int(rng.poisson(1 + m / 8)), int(rng.poisson(0.5 + m / 10)), int(rng.poisson(0.2 + m / 20))
                        fga, fta, tov, oreb = int(pts * 0.8) + 2, int(pts * 0.25) + 1, int(rng.poisson(1.2)), int(rng.poisson(0.8))
                        p_rows.append(dict(SEASON_ID=22022 + si, PLAYER_ID=pid, PLAYER_NAME=f"Player {pid}", TEAM_ID=tid, TEAM_ABBREVIATION=abbr, GAME_ID=gid,
                                           GAME_DATE=date.strftime("%Y-%m-%d"), MATCHUP=matchup, MIN=round(m), FGA=fga, FTA=fta, TOV=tov, OREB=oreb, PTS=pts, REB=reb, AST=ast,
                                           FG3M=fg3m, STL=int(rng.poisson(0.7)), BLK=int(rng.poisson(0.4))))
                        tot["PTS"] += pts; tot["FGA"] += fga; tot["FTA"] += fta; tot["TOV"] += tov; tot["OREB"] += oreb
                    t_rows.append(dict(SEASON_ID=22022 + si, TEAM_ID=tid, TEAM_ABBREVIATION=abbr, GAME_ID=gid, GAME_DATE=date.strftime("%Y-%m-%d"), MATCHUP=matchup, MIN=240 + (5 if rng.random() < 0.08 else 0), PLUS_MINUS=0, **tot))
        by_game = {}
        for r in t_rows:
            by_game.setdefault(r["GAME_ID"], []).append(r)
        for rs in by_game.values():                        # final margin from each team's own points
            if len(rs) == 2:
                rs[0]["PLUS_MINUS"], rs[1]["PLUS_MINUS"] = rs[0]["PTS"] - rs[1]["PTS"], rs[1]["PTS"] - rs[0]["PTS"]
        pd.DataFrame(p_rows).to_csv(out / f"player_{season}_regular.csv", index=False)
        pd.DataFrame(t_rows).to_csv(out / f"team_{season}_regular.csv", index=False)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python research/tests/fixture_data.py <output_dir>")
    make(Path(sys.argv[1]))
    print(f"wrote fixture data to {sys.argv[1]}")
