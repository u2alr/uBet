"""Defensive matchup features: definitions, shrinkage, edge cases and the leakage guarantee. Runs on generated data only (no NBA.com, no network).

    python research/tests/test_defense.py
"""
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import fixture_data  # noqa: E402

tmp = Path(tempfile.mkdtemp(prefix="ubet_def_"))
fixture_data.make(tmp)
os.environ.setdefault("UBET_RESEARCH_DATA", str(tmp))

import defense_features as D  # noqa: E402
import features  # noqa: E402


def augment(players: pd.DataFrame, teams: pd.DataFrame):
    """The fixture has no DREB/FG3A/AST at team level; derive them from the generated player rows so the team table has every column the real feed has."""
    players = players.copy()
    players["DREB"] = (players.REB - players.OREB).clip(lower=0)
    players["FG3A"] = players.FG3M * 2 + 1
    agg = players.groupby(["GAME_ID", "TEAM_ID"], as_index=False)[["FG3M", "FG3A", "DREB", "AST", "REB"]].sum()
    teams = teams.drop(columns=[c for c in ("FG3M", "FG3A", "DREB", "AST", "REB") if c in teams.columns]).merge(agg, on=["GAME_ID", "TEAM_ID"])
    return players, teams


def matchups(players: pd.DataFrame, seed: int = 3) -> pd.DataFrame:
    """Synthetic per-game assignments: each offensive player is guarded by up to 3 opposing players, weighted by their minutes."""
    rng = np.random.default_rng(seed)
    rows = []
    for gid, g in players.groupby("GAME_ID"):
        for tid, off in g.groupby("TEAM_ID"):
            de = g[g.TEAM_ID != tid]
            if de.empty:
                continue
            for _, o in off.iterrows():
                w = de["MIN"].to_numpy(float).clip(min=1)
                pick = de.iloc[rng.choice(len(de), size=min(3, len(de)), replace=False, p=w / w.sum())]
                for _, d in pick.iterrows():
                    poss = float(rng.uniform(2, 30))
                    rows.append(dict(game_id=f"00{gid}", date=o.GAME_DATE, mins=poss / 3, off_team=tid, off_id=o.PLAYER_ID, off_pos=("G", "F", "C", "")[int(o.PLAYER_ID) % 4],
                                     def_id=d.PLAYER_ID, poss=poss, switches=0.0, pts=float(rng.poisson(poss * 0.4)), team_pts=0.0, ast=0.0, pot_ast=0.0, tov=0.0, blk=0.0,
                                     fgm=0.0, fga=float(rng.poisson(poss * 0.35)), fg3m=0.0, fg3a=float(rng.poisson(poss * 0.12)), help_fgm=0.0, help_fga=0.0,
                                     fta=0.0, sfoul=float(rng.poisson(poss * 0.02))))
    return pd.DataFrame(rows)


def store(frame: pd.DataFrame) -> sqlite3.Connection:
    con = sqlite3.connect(":memory:")
    frame.to_sql("matchups", con, index=False)
    return con


def build_all(players, teams, mt):
    pl, tm = augment(players, teams)
    df = features.build(pl, tm)
    return D.add_defense(df, pl, tm, D.load_matchups(store(mt), tm))


def compare(full: pd.DataFrame, other: pd.DataFrame, upto: pd.Timestamp, label: str) -> int:
    a = full[full.date <= upto].set_index(["PLAYER_ID", "GAME_ID"])[D.ALL].sort_index()
    b = other[other.date <= upto].set_index(["PLAYER_ID", "GAME_ID"])[D.ALL].sort_index()
    both = a.index.intersection(b.index)
    bad = int((~np.isclose(a.loc[both].to_numpy(float), b.loc[both].to_numpy(float), rtol=1e-9, atol=1e-9, equal_nan=True)).any(axis=1).sum())
    print(f"  {label}: {len(both):,} rows compared, {bad} differ")
    return bad


def test_shrinkage_a_thin_sample_is_not_rated_extreme():
    s = pd.DataFrame({"c_dpoe": [5.0, 5.0 * 300], "c_poss": [10.0, 3000.0], "c_sfoul": [1.0, 300.0], "c_fg3a": [3.0, 900.0], "lg_foul": [0.1, 0.1], "lg_fg3a": [0.3, 0.3],
                      "c_pos_G": [5.0, 1500.0], "c_pos_F": [5.0, 750.0], "c_pos_C": [0.0, 750.0], "c_pos_U": [0.0, 0.0], "c_BLK": [0, 30], "c_STL": [0, 30], "c_min": [20, 2000]})
    r = D.state_metrics(s)
    assert abs(r.dpoe100[0]) < 0.4, "10 possessions at +0.5 per possession must stay near the league mean"
    assert r.dpoe100[1] > 5 * abs(r.dpoe100[0]), "the same rate over 3000 possessions is allowed to move further"
    assert r.expo[0] < 0.01 and r.expo[1] == 1.0
    assert 0 <= r.versatility.min() and r.versatility.max() <= 1


def test_versatility_is_higher_when_a_defender_guards_every_position():
    s = pd.DataFrame({"c_dpoe": [0.0, 0.0], "c_poss": [4000.0, 4000.0], "c_sfoul": [0.0, 0.0], "c_fg3a": [0.0, 0.0], "lg_foul": [0.1, 0.1], "lg_fg3a": [0.3, 0.3],
                      "c_pos_G": [4000.0, 1000.0], "c_pos_F": [0.0, 1000.0], "c_pos_C": [0.0, 1000.0], "c_pos_U": [0.0, 1000.0], "c_BLK": [0, 0], "c_STL": [0, 0], "c_min": [100, 100]})
    r = D.state_metrics(s)
    assert r.versatility[1] > r.versatility[0] + 0.5


def test_team_defense_first_games_have_no_window():
    _, tm = augment(*features.load_raw())
    td = D.team_defense(tm)
    assert {"df_td_ppp_adj_l10", "df_td_p3_pct_s2d"} <= set(td.columns)
    first = td.sort_values("GAME_ID").groupby("TEAM_ID").head(2)
    assert first[[c for c in td.columns if c.startswith("df_td_")]].isna().all().all(), "the first games of a team have no prior window"


def test_team_defense_is_adjusted_for_the_offences_faced():
    """Two defences allow the same points per possession; the one that faced the stronger offences must rate better after adjustment."""
    rows = []
    gid = 1
    for day in range(12):
        for defence, offence, pts in ((1, 3, 100), (2, 4, 100)):   # team 3 is a strong offence (usually 120), team 4 a weak one (usually 100)
            for team, scored in ((offence, 120 if offence == 3 else 100), (defence, 110)):
                rows.append(dict(GAME_ID=gid, TEAM_ID=team, GAME_DATE=f"2026-11-{day + 1:02d}", PTS=scored if team == offence else 110, FGA=90, FTA=20, TOV=12, OREB=10, DREB=30, FG3A=30, FG3M=11, AST=24, MATCHUP=""))
            rows[-2]["PTS"] = pts   # the offence scores `pts` this game (100 vs both defences), below team 3's normal 120
            gid += 1
    # team 3's earlier games (so its normal level is known): 120 points against a third team
    for day in range(12):
        for team, scored in ((3, 120), (9, 100)):
            rows.append(dict(GAME_ID=gid, TEAM_ID=team, GAME_DATE=f"2026-10-{day + 1:02d}", PTS=scored, FGA=90, FTA=20, TOV=12, OREB=10, DREB=30, FG3A=30, FG3M=11, AST=24, MATCHUP=""))
        gid += 1
    td = D.team_defense(pd.DataFrame(rows))
    last = td.sort_values("GAME_ID").groupby("TEAM_ID").tail(1).set_index("TEAM_ID")
    assert last.loc[1, "df_td_ppp_adj_l10"] < last.loc[2, "df_td_ppp_adj_l10"], "holding a strong offence to 100 is better than holding a weak one to 100"


def test_no_matchup_history_degrades_to_missing_not_a_guess():
    pl, tm = augment(*features.load_raw())
    df = features.build(pl, tm)
    empty = pd.DataFrame(columns=list(matchups(pl).columns))
    out = D.add_defense(df, pl, tm, D.load_matchups(store(empty), tm))
    assert out[D.PD + D.MU].isna().all().all()
    assert out["df_td_p3a_rate_l10"].notna().any(), "team defence still works without matchup data"


def test_leakage_future_deletion_and_same_day_corruption():
    players, teams = features.load_raw()
    pl, tm = augment(players, teams)
    mt = matchups(pl)
    full = build_all(players, teams, mt)
    assert full[D.MU].notna().any().any() and full[D.PD].notna().any().any(), "the test needs the features to exist"
    dates = np.sort(pl.GAME_DATE.unique())
    bad = 0
    for frac in (0.45, 0.8):
        cut = pd.Timestamp(dates[int(len(dates) * frac)])
        part = build_all(players[pd.to_datetime(players.GAME_DATE) <= cut], teams[pd.to_datetime(teams.GAME_DATE) <= cut], mt[pd.to_datetime(mt.date) <= cut])
        bad += compare(full, part, cut, f"future deleted after {cut.date()}")
    for frac in (0.25, 0.55, 0.85):
        day = pd.Timestamp(dates[int(len(dates) * frac)])
        rng = np.random.default_rng(1)
        mt2 = mt.copy()
        mask = pd.to_datetime(mt2.date) == day
        for col in ("pts", "poss", "fga", "fg3a", "sfoul"):
            mt2.loc[mask, col] = rng.integers(40, 90, size=mask.sum())
        pl2, tm2 = players.copy(), teams.copy()
        pm = pd.to_datetime(pl2.GAME_DATE) == day
        for col in ("PTS", "REB", "AST", "FG3M", "BLK", "STL"):
            pl2.loc[pm, col] = rng.integers(40, 90, size=pm.sum())
        tmask = pd.to_datetime(tm2.GAME_DATE) == day
        for col in ("PTS", "FGA", "FTA", "TOV", "OREB"):
            tm2.loc[tmask, col] = rng.integers(40, 130, size=tmask.sum())
        bad += compare(full, build_all(pl2, tm2, mt2), day, f"results of {day.date()} corrupted (rows up to and including that day)")
    # Control: the test can fail. Rows AFTER a corrupted day must move.
    day = pd.Timestamp(dates[int(len(dates) * 0.3)])
    mt3 = mt.copy()
    mt3.loc[pd.to_datetime(mt3.date) == day, "pts"] = 300.0
    other = build_all(players, teams, mt3)
    later = (full.date > day).to_numpy()
    moved = int((~np.isclose(full.loc[later, D.PD].to_numpy(float), other.loc[later, D.PD].to_numpy(float), equal_nan=True)).any(axis=1).sum())
    print(f"  control: corrupting one day moves {moved:,} later rows (must be > 0)")
    assert moved > 0
    assert bad == 0, f"{bad} rows changed when only the future or the same day was altered"


if __name__ == "__main__":
    fails = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print("PASS", name)
            except Exception as e:  # noqa: BLE001
                fails += 1
                import traceback
                traceback.print_exc()
                print("FAIL", name, e)
    sys.exit(1 if fails else 0)
