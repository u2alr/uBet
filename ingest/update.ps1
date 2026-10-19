# Daily refresh: current teams (reflects trades), the current season's box scores, then projections.
# Scheduled by Windows Task Scheduler as "uBet daily sync"; output goes to ingest\update.log.
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$py = Join-Path $root 'ingest\.venv\Scripts\python.exe'
$log = Join-Path $root 'ingest\update.log'

"=== $(Get-Date -Format s) ===" | Out-File $log -Append -Encoding utf8
& $py ingest\sync.py --teams-only 2>&1 | Out-File $log -Append -Encoding utf8
& $py ingest\sync.py --all-active --seasons 1 --delay 1.5 2>&1 | Out-File $log -Append -Encoding utf8
& $py research\project.py 2>&1 | Out-File $log -Append -Encoding utf8
"=== done $(Get-Date -Format s) ===" | Out-File $log -Append -Encoding utf8
