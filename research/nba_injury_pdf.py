"""The NBA's official injury report (a PDF the league posts every 15 minutes to https://official.nba.com/nba-injury-report-2026-27-season/).

    ingest/.venv/Scripts/python research/nba_injury_pdf.py [--remote] [--dry]

Finds the newest report (files are named Injury-Report_YYYY-MM-DD_HH_MMAM.pdf in Eastern time, every 15 minutes), reads it, and stores every listed player in `nba_injury_report`
(migration 0029; one row per report, team and player, never edited). research/game_snapshot.py uses the same reader with the official report as the base: a team that has filed is taken from it alone, and ESPN's list fills in only for teams that have not filed yet.

The PDF prints names without spaces ("Gueye,Mouhamed", "Niederhauser,YanicKonan"), so players are matched to the roster by their letters only. A name that matches nobody is counted and
reported, never guessed. Teams that have not filed ("NOT YET SUBMITTED") contribute nothing: the report says nothing about them yet.

Needs `pip install pdfplumber`. Any failure to fetch or read the PDF returns no rows, so a bad day for the league's site can never stop a snapshot.
"""
import argparse
import io
import re
import subprocess
import sys
import unicodedata
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
ROOT = Path(__file__).resolve().parents[1]
BASE = "https://ak-static.cms.nba.com/referee/injury/Injury-Report_{d}_{h}_{m}{ap}.pdf"
STATUSES = ("Out", "Doubtful", "Questionable", "Probable", "Available")
STEP_MIN = 15
LOOKBACK_HOURS = 30


def letters(s: str) -> str:
    """Only the letters, lower case, accents and generational suffixes removed: the form two spellings of one name share."""
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    s = re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", "", s)
    s = re.sub(r"[^a-z]", "", s)
    return re.sub(r"(jr|sr|iii|ii|iv)$", "", s)       # the PDF glues a suffix to the surname ("CenacJr.")


def report_urls(now: datetime, hours: int = LOOKBACK_HOURS) -> list[tuple[datetime, str]]:
    """Candidate report times (ET, on the quarter hour) from `now` back `hours`, newest first, with their addresses."""
    t = now.astimezone(ET).replace(second=0, microsecond=0)
    t -= timedelta(minutes=t.minute % STEP_MIN)
    out = []
    for _ in range(hours * 60 // STEP_MIN):
        h12 = t.hour % 12 or 12
        out.append((t, BASE.format(d=t.strftime("%Y-%m-%d"), h=f"{h12:02d}", m=f"{t.minute:02d}", ap="AM" if t.hour < 12 else "PM")))
        t -= timedelta(minutes=STEP_MIN)
    return out


def team_keys(teams: list[tuple[str, str]]) -> dict[str, tuple[str, str]]:
    """{ 'atlantahawks': ('ATL', 'Atlanta Hawks') } from (abbreviation, full name) pairs, the PDF's no-space spelling as the key."""
    return {letters(name): (abbr, name) for abbr, name in teams}


def parse_text(text: str, teams: dict[str, tuple[str, str]]) -> dict:
    """Rows from the PDF's text: {'report_time': 'YYYY-MM-DD HH:MM' or None, 'rows': [...]}. A row: game_date, matchup, team (abbr), team_name, player (as printed), status, reason.
    The layout puts the date, time, matchup and team on the first line of a block only, so they carry forward; a wrapped reason on its own line is ignored (only the status matters)."""
    m = re.search(r"Injury Report:\s*(\d\d)/(\d\d)/(\d\d)\s+(\d\d):(\d\d)\s*([AP]M)", text)
    report_time = None
    if m:
        mo, d, y, hh, mm, ap = m.groups()
        hh = int(hh) % 12 + (12 if ap == "PM" else 0)
        report_time = f"20{y}-{mo}-{d} {hh:02d}:{mm}"
    rows, date, matchup, team = [], None, None, None
    status_pat = "|".join(STATUSES)
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("Injury Report:") or line.startswith("GameDate") or re.match(r"Page\d+of\d+", line):
            continue
        d = re.match(r"(\d\d)/(\d\d)/(\d{4})\s+", line)
        if d:
            date = f"{d.group(3)}-{d.group(1)}-{d.group(2)}"
            line = line[d.end():]
        t = re.match(r"\d\d:\d\d\(ET\)\s+", line)
        if t:
            line = line[t.end():]
        mt = re.match(r"([A-Z]{2,4})@([A-Z]{2,4})\s+", line)
        if mt:
            matchup = f"{mt.group(1)}@{mt.group(2)}"
            line = line[mt.end():]
        # a team name (printed without spaces) starts the block of that team's players
        for key, val in teams.items():
            nm = val[1].replace(" ", "")
            if line.startswith(nm):
                team = val
                line = line[len(nm):].strip()
                break
        if line.replace(" ", "").upper() == "NOTYETSUBMITTED" or not line:
            continue
        p = re.match(rf"([^\s,]+,[^\s]+)\s+({status_pat})\b\s*(.*)$", line)
        if p and team and date:
            rows.append({"game_date": date, "matchup": matchup, "team": team[0], "team_name": team[1], "player": p.group(1), "status": p.group(2), "reason": p.group(3).strip()})
    return {"report_time": report_time, "rows": rows}


def read_pdf(data: bytes) -> str:
    import pdfplumber
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        return "\n".join((pg.extract_text() or "") for pg in pdf.pages)


def fetch_latest(now: datetime | None = None, fetch=None) -> tuple[str, bytes] | None:
    """(address, bytes) of the newest report that exists, or None. `fetch(url)` returns bytes or None (injectable for tests)."""
    def get(url: str):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (uBet research; contact via repo)"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except Exception:  # noqa: BLE001  (a 404 just means that quarter hour has no file)
            return None
    fetch = fetch or get
    for _, url in report_urls(now or datetime.now(ET)):
        data = fetch(url)
        if data and data[:4] == b"%PDF":
            return url, data
    return None


def official_report(teams: list[tuple[str, str]], now: datetime | None = None, fetch=None) -> dict | None:
    """The newest official report parsed, or None when it cannot be fetched or read (callers then carry on with ESPN alone)."""
    try:
        got = fetch_latest(now, fetch)
        if not got:
            return None
        parsed = parse_text(read_pdf(got[1]), team_keys(teams))
        parsed["url"] = got[0]
        return parsed
    except Exception as e:  # noqa: BLE001
        print(f"  NBA official injury report unavailable ({e}); ESPN's list is used alone")
        return None


def to_espn_shape(rows: list[dict], roster_names: dict[str, str]) -> tuple[list[dict], list[str]]:
    """Rows in the shape game_snapshot reads ({team (full name), player (roster spelling), status, note}), and the printed names that matched nobody on the roster.
    `roster_names` is {letters(full name): full name}. Only Out / Doubtful / Questionable / Probable entries are kept as listings; the player's team is the report's."""
    out, unmatched = [], []
    for r in rows:
        last, _, first = r["player"].partition(",")
        full = roster_names.get(letters(first + last)) or roster_names.get(letters(last + first))
        if not full:
            unmatched.append(r["player"])
            continue
        out.append({"team": r["team_name"], "player": full, "status": r["status"], "note": r["reason"][:200]})
    return out, unmatched


def merge(espn: list[dict], official: list[dict], covered: set[str] | None = None) -> list[dict]:
    """The official report is the base. A team that has filed (`covered`: full team names with at least one row on the report) is taken from the official list alone, so an ESPN entry the
    league no longer lists drops out. ESPN fills in only for teams that have not filed yet. With `covered` left out, the teams of the official rows are used."""
    covered = {r["team"] for r in official} if covered is None else covered
    return [r for r in espn if r["team"] not in covered] + official


def store_sql(report_time: str, rows: list[dict]) -> list[str]:
    q = lambda v: "NULL" if v is None else "'" + str(v).replace("'", "''") + "'"  # noqa: E731
    return [f"INSERT OR IGNORE INTO nba_injury_report (report_time, team, player, status, reason, game_date, matchup) VALUES ({', '.join(q(v) for v in (report_time, r['team'], r['player'], r['status'], r['reason'], r['game_date'], r['matchup']))});" for r in rows]


def main():
    from nba_api.stats.static import teams as nba_teams
    ap = argparse.ArgumentParser()
    ap.add_argument("--remote", action="store_true")
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    rep = official_report([(t["abbreviation"], t["full_name"]) for t in nba_teams.get_teams()])
    if not rep or not rep["rows"]:
        sys.exit("No official injury report could be read.")
    by = {}
    for r in rep["rows"]:
        by[r["status"]] = by.get(r["status"], 0) + 1
    print(f"{rep['report_time']} ET  {len(rep['rows'])} players listed  {by}\n  {rep['url']}")
    if a.dry:
        return
    out = ROOT / "research" / "out"
    out.mkdir(exist_ok=True)
    f = out / "nba_injuries.sql"
    f.write_text("\n".join(store_sql(rep["report_time"], rep["rows"])), encoding="utf-8")
    subprocess.run(["npx", "wrangler", "d1", "execute", "ubet", "--remote" if a.remote else "--local", "--file", str(f)], cwd=ROOT, shell=True, check=True)


if __name__ == "__main__":
    main()
