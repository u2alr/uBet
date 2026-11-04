# Cheap slate refresh: today's odds and the model's numbers, stored side by side (game_lean_log). Run it several times a day, and once more shortly before the
# first tip-off, so the last stored price before a game is close to tip. Costs one odds request; no box scores.
#   powershell -File scripts\refresh_slate.ps1          # local database
#   powershell -File scripts\refresh_slate.ps1 -Remote  # the deployed database
param([switch]$Remote)
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$py = Join-Path $root 'ingest\.venv\Scripts\python.exe'
$log = Join-Path $root 'ingest\update.log'
$flag = @(); if ($Remote) { $flag = @('--remote') }
"=== slate $(Get-Date -Format s) ===" | Out-File $log -Append -Encoding utf8
node --no-warnings scripts\sync_odds.mjs @flag 2>&1 | Out-File $log -Append -Encoding utf8
& $py -X utf8 research\game_snapshot.py @flag 2>&1 | Out-File $log -Append -Encoding utf8
"=== slate done $(Get-Date -Format s) ===" | Out-File $log -Append -Encoding utf8
