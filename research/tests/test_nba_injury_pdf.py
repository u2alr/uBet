"""The NBA official injury report: file addresses, the PDF's no-space layout, name matching, and the rule that the official status beats ESPN's without ever blocking a snapshot."""
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import nba_injury_pdf as N  # noqa: E402

ET = ZoneInfo("America/New_York")
TEAMS = N.team_keys([("ATL", "Atlanta Hawks"), ("WAS", "Washington Wizards"), ("PHI", "Philadelphia 76ers"), ("DET", "Detroit Pistons"), ("ORL", "Orlando Magic"), ("PHX", "Phoenix Suns"), ("LAC", "LA Clippers")])
SAMPLE = """Injury Report: 11/04/26 05:30 AM
GameDate GameTime Matchup Team PlayerName CurrentStatus Reason
11/04/2026 07:00(ET) ATL@WAS AtlantaHawks Dennis,RayJ Questionable GLeague-Two-Way
Gueye,Mouhamed Out Injury/Illness-LeftFootFracture
Johnson,Jalen Questionable Injury/Illness-LeftAnkleSprain
WashingtonWizards Beekman,Reece Out Injury/Illness-RightACJointInjury
Injury/Illness-LeftACLRepair/
Watkins,Jamir Out
Surgery
Injury/Illness-LowBackStress
PHI@DET Philadelphia76ers Barlow,Dominick Out
Reaction
DetroitPistons Duren,Jalen Out Injury/Illness-RightHamstringStrain
Page1of2
Injury Report: 11/04/26 05:30 AM
Niederhauser,YanicKonan Out Injury/Illness-RightLisfrancSurgery
11/05/2026 09:00(ET) ORL@PHX OrlandoMagic NOTYETSUBMITTED
PhoenixSuns NOTYETSUBMITTED
Page2of2
"""


def test_addresses_are_on_the_quarter_hour_in_eastern_time_newest_first_with_a_twelve_hour_clock():
    urls = N.report_urls(datetime(2026, 11, 4, 17, 37, tzinfo=ET), hours=1)
    assert urls[0][1].endswith("Injury-Report_2026-11-04_05_30PM.pdf")
    assert urls[1][1].endswith("Injury-Report_2026-11-04_05_15PM.pdf")
    mid = N.report_urls(datetime(2026, 11, 4, 0, 5, tzinfo=ET), hours=1)
    assert mid[0][1].endswith("Injury-Report_2026-11-04_12_00AM.pdf"), "midnight is 12 AM, not 00"
    noon = N.report_urls(datetime(2026, 11, 4, 12, 0, tzinfo=ET), hours=1)
    assert noon[0][1].endswith("Injury-Report_2026-11-04_12_00PM.pdf")
    utc = N.report_urls(datetime(2026, 11, 4, 22, 40, tzinfo=ZoneInfo("UTC")), hours=1)
    assert utc[0][1].endswith("Injury-Report_2026-11-04_05_30PM.pdf"), "a UTC clock is converted to Eastern first"


def test_the_layout_is_read_players_keep_their_team_and_game_and_wrapped_reasons_are_ignored():
    r = N.parse_text(SAMPLE, TEAMS)
    assert r["report_time"] == "2026-11-04 05:30"
    by = {x["player"]: x for x in r["rows"]}
    assert by["Dennis,RayJ"]["team"] == "ATL" and by["Dennis,RayJ"]["matchup"] == "ATL@WAS" and by["Dennis,RayJ"]["status"] == "Questionable"
    assert by["Gueye,Mouhamed"]["team"] == "ATL" and by["Gueye,Mouhamed"]["reason"] == "Injury/Illness-LeftFootFracture"
    assert by["Beekman,Reece"]["team"] == "WAS"
    assert by["Watkins,Jamir"]["team"] == "WAS" and by["Watkins,Jamir"]["status"] == "Out"
    assert by["Barlow,Dominick"]["team"] == "PHI" and by["Barlow,Dominick"]["matchup"] == "PHI@DET"
    assert by["Duren,Jalen"]["team"] == "DET"
    assert by["Niederhauser,YanicKonan"]["team"] == "DET", "a team's block carries onto the next page"
    assert len(r["rows"]) == 8, "teams that have not filed add no rows"


def test_a_team_that_has_not_filed_is_recorded_as_not_filed_and_a_listed_team_as_filed_with_its_tip_time():
    r = N.parse_text(SAMPLE, TEAMS)
    f = {(x["matchup"], x["team"]): x for x in r["filings"]}
    assert f[("ORL@PHX", "ORL")]["filed"] is False and f[("ORL@PHX", "PHX")]["filed"] is False
    assert f[("ATL@WAS", "ATL")]["filed"] is True and f[("ATL@WAS", "ATL")]["tip"] == "19:00"
    assert f[("ORL@PHX", "ORL")]["game_date"] == "2026-11-05"


def test_the_older_layout_with_spaces_in_names_reads_like_the_newer_one():
    old = """Injury Report: 01/15/22 05:30 PM
Game Date Game Time Matchup Team Player Name Current Status Reason
01/15/2022 06:30 (ET) TOR@MIL Milwaukee Bucks Dowtin, Jeff Out G League - On Assignment
Holiday, Jrue Out Injury/Illness - Left Ankle; Soreness
Toronto Raptors Trent Jr., Gary Doubtful Injury/Illness - Left Ankle; Swelling
"""
    teams = N.team_keys([("MIL", "Milwaukee Bucks"), ("TOR", "Toronto Raptors")])
    r = N.parse_text(old, teams)
    by = {x["player"]: x for x in r["rows"]}
    assert set(by) == {"Dowtin,Jeff", "Holiday,Jrue", "TrentJr.,Gary"}
    assert by["TrentJr.,Gary"]["team"] == "TOR" and by["TrentJr.,Gary"]["status"] == "Doubtful"
    assert by["Holiday,Jrue"]["team"] == "MIL" and by["Holiday,Jrue"]["tip"] == "18:30"


def test_nothing_filed_yet_means_no_rows_not_a_healthy_roster():
    r = N.parse_text("Injury Report: 11/05/26 12:00 AM\n11/05/2026 09:00(ET) ORL@PHX OrlandoMagic NOTYETSUBMITTED\nPhoenixSuns NOTYETSUBMITTED\n", TEAMS)
    assert r["rows"] == []


def test_names_printed_without_spaces_are_matched_by_their_letters_and_unknown_names_are_reported_not_guessed():
    roster = {N.letters(n): n for n in ["Ray Jr. Dennis", "Mouhamed Gueye", "Yanic Konan Niederhauser", "Jalen Duren"]}
    rows = N.parse_text(SAMPLE, TEAMS)["rows"]
    listed, unmatched = N.to_espn_shape(rows, roster)
    names = {x["player"] for x in listed}
    assert {"Mouhamed Gueye", "Yanic Konan Niederhauser", "Jalen Duren"} <= names
    assert "Reece Beekman" not in names and "Beekman,Reece" in unmatched
    assert next(x for x in listed if x["player"] == "Jalen Duren")["team"] == "Detroit Pistons"


def test_a_suffix_glued_to_the_surname_still_matches():
    roster = {N.letters("Christopher Cenac Jr."): "Christopher Cenac Jr."}
    rows = [{"player": "CenacJr.,Christopher", "team_name": "Houston Rockets", "status": "Out", "reason": ""}]
    listed, unmatched = N.to_espn_shape(rows, roster)
    assert [x["player"] for x in listed] == ["Christopher Cenac Jr."] and unmatched == []


def test_the_official_report_is_the_base_a_filed_team_is_taken_from_it_alone_and_espn_fills_in_the_rest():
    espn = [{"team": "Detroit Pistons", "player": "Jalen Duren", "status": "Questionable", "note": "x"},
            {"team": "Detroit Pistons", "player": "Cade Cunningham", "status": "Out", "note": "stale: the league no longer lists him"},
            {"team": "Boston Celtics", "player": "Jayson Tatum", "status": "Out", "note": "y"}]
    official = [{"team": "Detroit Pistons", "player": "Jalen Duren", "status": "Out", "note": "z"}]
    m = N.merge(espn, official)
    assert {r["player"]: r["status"] for r in m} == {"Jalen Duren": "Out", "Jayson Tatum": "Out"}, "Cunningham drops out, Boston (not filed) stays"
    # a team whose only listed players are not on our roster still counts as filed
    m2 = N.merge(espn, [], {"Detroit Pistons"})
    assert {r["player"] for r in m2} == {"Jayson Tatum"}


def test_the_newest_existing_report_is_used_and_a_dead_site_gives_none_instead_of_an_error():
    now = datetime(2026, 11, 4, 5, 40, tzinfo=ET)
    have = {"Injury-Report_2026-11-04_05_15AM.pdf": b"%PDF-1.4 fake"}
    got = N.fetch_latest(now, fetch=lambda u: next((v for k, v in have.items() if u.endswith(k)), None))
    assert got is not None and got[0].endswith("05_15AM.pdf"), "05:30 does not exist yet, so the quarter hour before it"
    assert N.fetch_latest(now, fetch=lambda u: None) is None
    assert N.official_report([("ATL", "Atlanta Hawks")], now, fetch=lambda u: (_ for _ in ()).throw(RuntimeError("down"))) is None


def test_stored_rows_are_quoted_and_never_replace_an_earlier_report():
    sql = N.store_sql("2026-11-04 05:30", [{"team": "ATL", "player": "O'Neale,Royce", "status": "Out", "reason": "x", "game_date": "2026-11-04", "matchup": "ATL@WAS"}])
    assert sql[0].startswith("INSERT OR IGNORE") and "O''Neale,Royce" in sql[0]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
