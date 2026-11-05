# Registers Windows scheduled tasks so the data behind the pages stays fresh without you running anything. Everything runs on THIS computer and writes to the LOCAL database only
# (add -Remote to also write the live one). Nothing is registered until you run this, and -Remove undoes it.
#
#   powershell -File scripts\install_tasks.ps1                # list what would be registered (a dry run)
#   powershell -File scripts\install_tasks.ps1 -Apply         # register: NBA injury report every 15 minutes, odds + model numbers every hour
#   powershell -File scripts\install_tasks.ps1 -Apply -Remote # the same, and also write the live database each time
#   powershell -File scripts\install_tasks.ps1 -Remove        # remove them again
#
# The daily box-score sync is a separate, existing task ("uBet daily sync", ingest\update.ps1).
param([switch]$Apply, [switch]$Remove, [switch]$Remote)
$root = Split-Path -Parent $PSScriptRoot
$py = Join-Path $root 'ingest\.venv\Scripts\python.exe'
$flag = if ($Remote) { ' --remote' } else { '' }
$tasks = @(
  @{ Name = 'uBet NBA injury report'; EveryMinutes = 15; Command = "`"$py`" -X utf8 `"$root\research\nba_injury_pdf.py`"$flag" },
  @{ Name = 'uBet odds and model numbers'; EveryMinutes = 60; Command = "powershell -NoProfile -File `"$root\scripts\refresh_slate.ps1`"$(if ($Remote) { ' -Remote' })" }
)

if ($Remove) {
  foreach ($t in $tasks) { Unregister-ScheduledTask -TaskName $t.Name -Confirm:$false -ErrorAction SilentlyContinue; Write-Host "removed: $($t.Name)" }
  return
}
foreach ($t in $tasks) {
  Write-Host ("{0}: every {1} min -> {2}" -f $t.Name, $t.EveryMinutes, $t.Command)
  if (-not $Apply) { continue }
  $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c cd /d `"$root`" && $($t.Command) >> `"$root\ingest\update.log`" 2>&1"
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $t.EveryMinutes)
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
  Register-ScheduledTask -TaskName $t.Name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
  Write-Host "  registered." -ForegroundColor Green
}
if (-not $Apply) { Write-Host "`nDry run: nothing was registered. Add -Apply to register." }
