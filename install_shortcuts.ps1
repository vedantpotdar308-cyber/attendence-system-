$WshShell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$appDir = $PSScriptRoot
$icoPath = Join-Path $appDir 'icon.ico'

# 1. Branch App Shortcut
$link1 = $WshShell.CreateShortcut((Join-Path $desktop 'Vedant Branch App.lnk'))
$link1.TargetPath = Join-Path $appDir 'Start_Branch_App.bat'
$link1.WorkingDirectory = $appDir
if (Test-Path $icoPath) { $link1.IconLocation = $icoPath }
$link1.Description = 'Vedant Enterprises Branch Attendance & Payroll'
$link1.Save()

# 2. Central Admin Shortcut
$link2 = $WshShell.CreateShortcut((Join-Path $desktop 'Vedant Central Admin.lnk'))
$link2.TargetPath = Join-Path $appDir 'Start_Admin_App.bat'
$link2.WorkingDirectory = $appDir
if (Test-Path $icoPath) { $link2.IconLocation = $icoPath }
$link2.Description = 'Vedant Enterprises Central Admin Headquarters'
$link2.Save()

Write-Output "SUCCESS: Created 'Vedant Branch App' and 'Vedant Central Admin' shortcuts on Desktop!"
