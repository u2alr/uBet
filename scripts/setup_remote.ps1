# One command to bring the LIVE (Cloudflare D1) database up to date, in the right order, and to say what it found. It WRITES to production, so it asks first.
#
#   powershell -File scripts\setup_remote.ps1            # asks, then: migrations, box scores, odds, NBA injury report, model numbers
#   powershell -File scripts\setup_remote.ps1 -Quick     # only what changes through the day: odds, NBA injury report, model numbers (no migrations, no box-score sync)
#   powershell -File scripts\setup_remote.ps1 -Check     # writes nothing: only reads the live site's health and says what is stale or missing
#
# Run it from the repository root. Needs `npx wrangler login` once and ingest\.venv (see README).
param([switch]$Quick, [switch]$Check, [string]$Site = 'https://ubet-app.pages.dev')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$py = Join-Path $root 'ingest\.venv\Scripts\python.exe'

function Show-Health {
  try {
    $h = Invoke-RestMethod "$Site/api/health" -ErrorAction Stop
    Write-Host "Live site health: $($h.status)" -ForegroundColor Cyan
    foreach ($c in $h.checks) { $mark = if ($c.ok) { 'ok  ' } else { 'FIX ' }; Write-Host ("  [{0}] {1}: {2}" -f $mark, $c.name, $c.detail) }
  } catch { Write-Host "Could not read $Site/api/health: $($_.Exception.Message)" -ForegroundColor Yellow }
}

Show-Health
if ($Check) { return }

Write-Host ''
Write-Host 'This will WRITE to the live database (Cloudflare D1 "ubet").' -ForegroundColor Yellow
if ((Read-Host 'Continue? (y/N)') -notmatch '^[yY]') { Write-Host 'Nothing was changed.'; return }

function Step($label, [scriptblock]$run) {
  Write-Host "`n== $label" -ForegroundColor Cyan
  & $run
  if ($LASTEXITCODE -ne 0) { throw "Step failed: $label (exit $LASTEXITCODE). Nothing after it was run." }
}

if (-not $Quick) {
  Step 'Apply any new migrations' { 'y' | npx wrangler d1 migrations apply ubet --remote }
  Step 'Box scores (the whole league, only what is new)' { & $py -X utf8 ingest\sync.py --remote --league }
}
Step 'Game odds' { node --no-warnings scripts\sync_odds.mjs --remote }
Step 'NBA injury report (the newest PDF)' { & $py -X utf8 research\nba_injury_pdf.py --remote }
Step 'Model numbers for the next games' { & $py -X utf8 research\game_snapshot.py --remote }

Write-Host ''
Show-Health
Write-Host "`nDone. The site only changes when you run this (or schedule it): see README, 'Keeping the live site current'." -ForegroundColor Green
