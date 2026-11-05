"""Backfill the NBA's official injury reports for past seasons into research/data/injuries/injury_reports.csv (local files only; nothing is written to any database).

    ingest/.venv/Scripts/python research/backfill_injuries.py [--from 2020-12-22] [--workers 8]

For every regular-season game date in the box scores it fetches four reports of that day (about 11 AM, 2 PM, 5 PM and 7 PM Eastern) from the league's static file server, reads each PDF in
memory (the PDFs themselves are not kept) and appends one row per listed player. An interrupted run resumes: a (date, slot) already in the file is skipped, and a slot the league has
no file for is remembered in `missing.txt` so it is not asked for again. Older seasons (to 2024-25) name files by the hour (`Injury-Report_2024-01-15_05PM.pdf`), the current one by the
quarter hour (`..._05_30PM.pdf`); both are tried. Each file's own printed time ("Injury Report: 01/15/24 05:30 PM") is what is stored, not the file name's.

The league only started publishing the report in this form in 2020-21, so nothing earlier exists.
"""
import argparse
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date as Date
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import nba_injury_pdf as N  # noqa: E402

DATA = Path(__file__).resolve().parent / "data" / "injuries"
CSV = DATA / "injury_reports.csv"
MISSING = DATA / "missing.txt"
def slots_for(d: str) -> list[tuple[int, str]]:
    """The report files asked for on a day: the ones named for these hours (Eastern). Every hour exists from 2021-22 on; the 2020-21 season only has 1, 5 and 8 PM."""
    return [(1, "PM"), (5, "PM"), (8, "PM")] if d < "2021-10-01" else [(11, "AM"), (2, "PM"), (5, "PM"), (7, "PM")]


CONTROL = "Injury-Report_2024-01-15_05PM.pdf"                        # a file known to exist: while it answers 200 the server is serving us
_control_ok_at = [0.0]
COLS = ["report_time", "slot_date", "slot", "game_date", "tip", "matchup", "team", "player", "status", "reason"]
UA = {"User-Agent": "Mozilla/5.0 (uBet research backfill)"}


def candidate_names(d: str, hour: int, ap: str) -> list[str]:
    """Both naming schemes for one slot: by the hour, and by the quarter hour on the hour."""
    return [f"Injury-Report_{d}_{hour:02d}{ap}.pdf", f"Injury-Report_{d}_{hour:02d}_00{ap}.pdf"]


def fetch(name: str) -> tuple[str, bytes | None]:
    """('ok', bytes), ('missing', None) when the league answers 404 (it has no such file), or ('error', None) for anything else (a refused or timed-out request, which says nothing about the file)."""
    import urllib.error
    import urllib.request
    url = N.BASE.rsplit("/", 1)[0] + "/" + name
    def serving() -> bool:
        if time.time() - _control_ok_at[0] < 30:
            return True
        try:
            with urllib.request.urlopen(urllib.request.Request(N.BASE.rsplit("/", 1)[0] + "/" + CONTROL, headers=UA), timeout=40) as r:
                ok = r.status == 200
        except Exception:  # noqa: BLE001
            ok = False
        if ok:
            _control_ok_at[0] = time.time()
        return ok

    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                data = r.read()
                return ("ok", data) if data[:4] == b"%PDF" else ("missing", None)
        except urllib.error.HTTPError as e:
            # This server answers 403 (not 404) for a file that does not exist. It is only a refusal if a file we know exists is refused too.
            if e.code == 404 or (e.code == 403 and serving()):
                return "missing", None
            time.sleep(30 if e.code == 403 else 2 * (attempt + 1))    # refused or rate-limited: wait it out
        except Exception:  # noqa: BLE001
            time.sleep(2 * (attempt + 1))
    return "error", None


PAUSE = 0.0                                                # seconds each worker waits after a request, set from --pause


def one(job: tuple[str, int, str], teams: dict) -> tuple[str, str, str, list[dict] | None]:
    """(date, slot, 'ok' | 'missing' | 'error', rows). 'missing' only when every name for the slot answered 404."""
    d, hour, ap = job
    verdicts = []
    for name in candidate_names(d, hour, ap):
        v, data = fetch(name)
        time.sleep(PAUSE)
        verdicts.append(v)
        if v == "ok":
            try:
                parsed = N.parse_text(N.read_pdf(data), teams)
            except Exception as e:  # noqa: BLE001
                print(f"  could not read {name}: {e}")
                return d, f"{hour}{ap}", "error", None
            rows = [{"report_time": parsed["report_time"], **r} for r in parsed["rows"]]
            # a team that had not filed is stored as a row with no player, so "not filed" can be told from "filed with nobody listed"
            rows += [{"report_time": parsed["report_time"], "game_date": f["game_date"], "tip": f["tip"], "matchup": f["matchup"], "team": f["team"], "player": "", "status": "NOT_SUBMITTED", "reason": ""} for f in parsed["filings"] if not f["filed"]]
            return d, f"{hour}{ap}", "ok", rows
    return d, f"{hour}{ap}", ("missing" if all(v == "missing" for v in verdicts) else "error"), None


def game_dates(start: str) -> list[str]:
    from game_eval_v2 import load_all
    _, tm = load_all()
    t = tm.drop_duplicates(["GAME_ID", "TEAM_ID"])
    t = t[t.GAME_ID.astype(str).str[:1] == "2"]                        # regular season only
    days = sorted({str(x)[:10] for x in t.GAME_DATE if str(x)[:10] >= start})
    return [d for d in days if d <= Date.today().isoformat()]


def main():
    from nba_api.stats.static import teams as nba_teams
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="start", default="2020-12-22")
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--pause", type=float, default=0.3, help="seconds each worker waits between requests (the league's server refuses bursts)")
    a = ap.parse_args()
    global PAUSE
    PAUSE = a.pause
    DATA.mkdir(parents=True, exist_ok=True)
    teams = N.team_keys([(t["abbreviation"], t["full_name"]) for t in nba_teams.get_teams()])
    teams[N.letters("Los Angeles Clippers")] = ("LAC", "LA Clippers")      # the league's older reports use the old name
    done = set()
    if CSV.exists():
        old = pd.read_csv(CSV, usecols=["slot_date", "slot"])
        done = set(zip(old.slot_date.astype(str), old.slot.astype(str)))
    missing = set(MISSING.read_text().split()) if MISSING.exists() else set()
    jobs = [(d, h, ap_) for d in game_dates(a.start) for h, ap_ in slots_for(d) if (d, f"{h}{ap_}") not in done and f"{d}_{h}{ap_}" not in missing]
    print(f"{len(jobs)} reports to fetch ({len(done)} already stored, {len(missing)} known not to exist)", flush=True)
    t0, got, none, errors = time.time(), 0, 0, 0
    rows_all: list[dict] = []
    with ThreadPoolExecutor(a.workers) as ex:
        for i, (d, slot, verdict, rows) in enumerate(ex.map(lambda j: one(j, teams), jobs), 1):
            if verdict == "error":
                errors += 1                                  # not remembered: the next run asks again
            elif rows is None:
                none += 1
                missing.add(f"{d}_{slot}")
            else:
                got += 1
                rows_all += [{**r, "slot_date": d, "slot": slot} for r in rows] or [{"report_time": None, "slot_date": d, "slot": slot, "game_date": None, "tip": None, "matchup": None, "team": None, "player": None, "status": None, "reason": None}]
            if i % 200 == 0:
                print(f"  {i}/{len(jobs)}  stored {got}  no file {none}  errors {errors}  {time.time() - t0:.0f}s", flush=True)
                _flush(rows_all, missing)
                rows_all = []
    _flush(rows_all, missing)
    print(f"done: {got} reports read, {none} slots with no file, {errors} failed requests (run again to retry them), {time.time() - t0:.0f}s")


def _flush(rows: list[dict], missing: set[str]) -> None:
    if rows:
        pd.DataFrame(rows, columns=COLS).to_csv(CSV, mode="a", header=not CSV.exists(), index=False)
    MISSING.write_text("\n".join(sorted(missing)))


if __name__ == "__main__":
    main()
