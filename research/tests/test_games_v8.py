"""game-winner model v8 features (PREREG_GAMES_V8.md): the report used must be the latest one printed at least an hour before tip, a team that has not filed must block a report, a listed
player's weight must come only from EARLIER games, and the status weights must be the fixed ones."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import game_features_v8 as V8  # noqa: E402

COLS = ["report_time", "slot_date", "slot", "game_date", "tip", "matchup", "team", "player", "status", "reason"]


def rep(time, slot, rows, day="2026-01-10", matchup="AWY@HOM", tip="19:00") -> list[dict]:
    out = [dict(report_time=f"{day} {time}", slot_date=day, slot=slot, game_date=day, tip=tip, matchup=matchup, team=t, player=p, status=s, reason="") for t, p, s in rows]
    return out or [dict(report_time=f"{day} {time}", slot_date=day, slot=slot, game_date=None, tip=None, matchup=None, team=None, player="", status=None, reason="")]


def frame(*groups) -> pd.DataFrame:
    rows = [r for g in groups for r in g]
    d = pd.DataFrame(rows, columns=COLS)
    d["player"] = d.player.fillna("")
    d["slot_time"] = pd.to_datetime(d.slot_date)
    d["report_ts"] = pd.to_datetime(d.report_time, errors="coerce").fillna(d.slot_time)
    return d


GAMES = pd.DataFrame({"date": ["2026-01-10"], "home": ["HOM"], "away": ["AWY"]})


def test_the_latest_report_at_least_an_hour_before_tip_is_used_and_a_later_one_never_is():
    r = frame(rep("11:30", "11AM", [("HOM", "Star,Home", "Out")]), rep("17:30", "5PM", [("HOM", "Star,Home", "Out")]), rep("18:30", "7PM", [("HOM", "Star,Home", "Out")]))
    got = V8.choose_reports(r, GAMES).report_ts.iloc[0]
    assert got == pd.Timestamp("2026-01-10 17:30"), "tip 19:00, cutoff 18:00: the 18:30 report is too late"


def test_a_report_where_either_team_has_not_filed_is_skipped_for_an_earlier_one():
    nys = rep("17:30", "5PM", [("HOM", "Star,Home", "Out"), ("AWY", "", "NOT_SUBMITTED")])
    r = frame(rep("11:30", "11AM", [("HOM", "Star,Home", "Out")]), nys)
    assert V8.choose_reports(r, GAMES).report_ts.iloc[0] == pd.Timestamp("2026-01-10 11:30")


def test_a_game_with_no_qualifying_report_has_none_and_a_default_tip_is_used_when_none_is_printed():
    only_late = frame(rep("18:30", "7PM", [("HOM", "Star,Home", "Out")]))
    assert pd.isna(V8.choose_reports(only_late, GAMES).report_ts.iloc[0])
    healthy = frame(rep("17:30", "5PM", []))            # a report with nobody listed for this game: the game is covered, tip assumed 19:00
    assert V8.choose_reports(healthy, GAMES).report_ts.iloc[0] == pd.Timestamp("2026-01-10 17:30")


def players(star_late_minutes=40.0) -> pd.DataFrame:
    """One star (id 1) for the home team with ten earlier games, and an unrelated player; the star's later games are rewritable."""
    rows = []
    for i in range(12):
        day = (pd.Timestamp("2025-12-20") + pd.Timedelta(days=i)).strftime("%Y-%m-%d")
        late = i >= 11
        for pid, name in ((1, "Home Star"), (2, "Other Guy")):
            rows.append({"PLAYER_ID": pid, "PLAYER_NAME": name, "GAME_DATE": day, "MIN": (star_late_minutes if late and pid == 1 else 32.0), "PTS": (60 if late and pid == 1 else 24), "FGM": 9, "FGA": 18, "FTA": 6, "FTM": 5,
                         "OREB": 1, "DREB": 5, "STL": 1, "AST": 5, "BLK": 1, "PF": 2, "TOV": 3})
    return pd.DataFrame(rows)


def test_a_listed_players_weight_comes_only_from_earlier_games_and_the_status_weights_are_the_fixed_ones():
    pl = players()
    keys = V8.roster_keys(pl)
    w = V8.player_weights(pl)
    reports = frame(rep("17:30", "5PM", [("HOM", "Star,Home", "Out"), ("HOM", "Guy,Other", "Questionable")], day="2025-12-31"))
    chosen = V8.choose_reports(reports, pd.DataFrame({"date": ["2025-12-31"], "home": ["HOM"], "away": ["AWY"]}))
    lp = V8.listed_players(reports, chosen, keys, w).set_index("player")
    assert lp.loc["Star,Home", "p"] == 0.0 and lp.loc["Guy,Other", "p"] == 0.5
    assert lp.loc["Star,Home", "w"] > 0 and lp.loc["Guy,Other", "w"] > 0
    # rewrite the star's game on 2025-12-31 (the same day: not earlier) and the weight must not move
    pl2 = players(star_late_minutes=10.0)
    lp2 = V8.listed_players(reports, chosen, V8.roster_keys(pl2), V8.player_weights(pl2)).set_index("player")
    assert abs(lp.loc["Star,Home", "w"] - lp2.loc["Star,Home", "w"]) < 1e-9, "a game on or after the report's day changed an earlier weight"


def test_features_are_home_minus_away_and_an_unmatched_name_contributes_nothing():
    pl = players()
    teams = pd.DataFrame({"TEAM_ID": [10, 20], "TEAM_ABBREVIATION": ["HOM", "AWY"]})
    base = pd.DataFrame({"date": [pd.Timestamp("2025-12-31")], "home_id": [10], "away_id": [20]})
    reports = frame(rep("17:30", "5PM", [("HOM", "Star,Home", "Out"), ("HOM", "Guy,Other", "Questionable"), ("AWY", "Nobody,Unknown", "Out")], day="2025-12-31"))
    g = V8.build_v8(base, teams, pl, reports)
    wstar = float(V8.player_weights(pl).query("PLAYER_ID == 1 and date < '2025-12-31'").iloc[-1][["m", "v"]].pipe(lambda s: min(s.m, 36) * s.v / 240))
    wother = float(V8.player_weights(pl).query("PLAYER_ID == 2 and date < '2025-12-31'").iloc[-1][["m", "v"]].pipe(lambda s: min(s.m, 36) * s.v / 240))
    assert g.has_rep.iloc[0] == 1.0
    assert abs(g.rep_out.iloc[0] - wstar) < 1e-9, "home Out contributes, the unmatched away player does not"
    assert abs(g.rep_exp_loss.iloc[0] - (wstar * 1.0 + wother * 0.5)) < 1e-9
    assert abs(g.rep_top.iloc[0] - wstar) < 1e-9


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
