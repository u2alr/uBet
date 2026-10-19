# One Kalshi snapshot. Run every 10 minutes by the Windows task "uBet Kalshi collector".
# Output is appended to research\data\kalshi.log (git-ignored).
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$py = Join-Path $root 'ingest\.venv\Scripts\python.exe'
$log = Join-Path $root 'research\data\kalshi.log'
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
& $py research\collect_kalshi.py 2>&1 | Out-File $log -Append -Encoding utf8
