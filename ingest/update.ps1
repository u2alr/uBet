# Daily refresh: current teams (reflects trades), the current season's box scores, then projections.
# Scheduled by Windows Task Scheduler as "uBet daily sync"; output goes to ingest\update.log.
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$py = Join-Path $root 'ingest\.venv\Scripts\python.exe'
$log = Join-Path $root 'ingest\update.log'

"=== $(Get-Date -Format s) ===" | Out-File $log -Append -Encoding utf8
& $py ingest\sync.py --teams-only 2>&1 | Out-File $log -Append -Encoding utf8
& $py ingest\sync.py --league 2>&1 | Out-File $log -Append -Encoding utf8
if ($LASTEXITCODE -ne 0) { & $py ingest\sync.py --all-active --seasons 1 --delay 1.5 2>&1 | Out-File $log -Append -Encoding utf8 }   # the one-request sync failed: fall back to one player at a time
& $py research\project.py 2>&1 | Out-File $log -Append -Encoding utf8
& powershell -File (Join-Path $root 'scripts/refresh_slate.ps1')   # odds and the model's numbers, for the live model-vs-market record
"=== done $(Get-Date -Format s) ===" | Out-File $log -Append -Encoding utf8
