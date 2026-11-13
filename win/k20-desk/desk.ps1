# k20 desk heartbeat. Reports "Windows is awake" plus CPU / memory / GPU
# to the Mac gateway. No admin, no hub. CPU temperature only if WMI allows it.
# GPU numbers come from nvidia-smi when it is on PATH.

param(
  [switch]$Install,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$AppDir = Join-Path $env:LOCALAPPDATA 'k20-desk'
$ConfigPath = Join-Path $env:APPDATA 'k20-desk\desk.json'
$ScriptCopy = Join-Path $AppDir 'desk.ps1'
$LogPath = Join-Path $AppDir 'desk.log'
$Startup = [Environment]::GetFolderPath('Startup')
$VbsPath = Join-Path $Startup 'k20-desk.vbs'
$LauncherVbs = Join-Path $AppDir 'k20-desk.vbs'
$TaskName = 'k20-desk'

function Write-Log([string]$Line) {
  New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
  $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Add-Content -Path $LogPath -Value "$stamp $Line" -Encoding utf8
  if ((Get-Item $LogPath).Length -gt 256KB) {
    $tail = Get-Content -Path $LogPath -Tail 400
    Set-Content -Path $LogPath -Value $tail -Encoding utf8
  }
}

function Read-Config {
  if (-not (Test-Path $ConfigPath)) {
    New-Item -ItemType Directory -Force -Path (Split-Path $ConfigPath) | Out-Null
    @{ url = ''; token = ''; interval_sec = 5 } | ConvertTo-Json | Set-Content -Path $ConfigPath -Encoding utf8
    Write-Log "config missing, wrote template $ConfigPath"
    return $null
  }
  $raw = Get-Content -Raw -Path $ConfigPath | ConvertFrom-Json
  $url = [string]$raw.url
  $token = [string]$raw.token
  if ([string]::IsNullOrWhiteSpace($url) -or [string]::IsNullOrWhiteSpace($token)) {
    Write-Log 'config missing url or token'
    return $null
  }
  $interval = 5
  if ($raw.interval_sec) { $interval = [int]$raw.interval_sec }
  if ($interval -lt 1) { $interval = 1 }
  return @{ url = $url.Trim(); token = $token; interval = $interval }
}

function Get-Round([double]$Value) {
  return [math]::Round($Value, 1)
}

function Get-DeskSample {
  $sample = @{}
  try {
    $loads = @(Get-CimInstance -ClassName Win32_Processor | ForEach-Object { $_.LoadPercentage } | Where-Object { $_ -ne $null })
    if ($loads.Count -gt 0) {
      $cpu = @{ percent = (Get-Round (($loads | Measure-Object -Average).Average)) }
      try {
        $zones = @(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop)
        $temps = @($zones | ForEach-Object { ($_.CurrentTemperature / 10) - 273.15 } | Where-Object { $_ -ge 20 -and $_ -le 110 })
        if ($temps.Count -gt 0) {
          $cpu.temp_celsius = Get-Round (($temps | Measure-Object -Maximum).Maximum)
        }
      } catch {}
      $sample.cpu = $cpu
    }
  } catch {}
  try {
    $os = Get-CimInstance -ClassName Win32_OperatingSystem
    $totalKb = [double]$os.TotalVisibleMemorySize
    $freeKb = [double]$os.FreePhysicalMemory
    if ($totalKb -gt 0) {
      $usedKb = $totalKb - $freeKb
      $sample.memory = @{
        percent = Get-Round (100 * $usedKb / $totalKb)
        used_gb = Get-Round ($usedKb / 1MB)
        total_gb = Get-Round ($totalKb / 1MB)
      }
    }
  } catch {}
  $nvsmi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
  if ($nvsmi) {
    try {
      $line = (& nvidia-smi --query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total --format=csv,noheader,nounits | Select-Object -First 1)
      if ($line) {
        $parts = @($line -split ',' | ForEach-Object { $_.Trim() })
        $gpu = @{}
        if ($parts.Count -ge 1 -and $parts[0]) { $gpu.name = $parts[0] }
        $util = 0.0
        if ($parts.Count -ge 2 -and [double]::TryParse($parts[1], [ref]$util)) { $gpu.percent = Get-Round $util }
        $temp = 0.0
        if ($parts.Count -ge 3 -and [double]::TryParse($parts[2], [ref]$temp)) { $gpu.temp_celsius = Get-Round $temp }
        $used = 0.0
        $total = 0.0
        if ($parts.Count -ge 5 -and [double]::TryParse($parts[3], [ref]$used) -and [double]::TryParse($parts[4], [ref]$total) -and $total -gt 0) {
          $gpu.vram_percent = Get-Round (100 * $used / $total)
        }
        if ($gpu.Count -gt 0) { $sample.gpu = $gpu }
      }
    } catch {}
  }
  return $sample
}

function Send-Beat([hashtable]$Config, [bool]$Online) {
  $body = @{ online = $Online }
  if ($Online) {
    $sample = Get-DeskSample
    foreach ($key in @('cpu', 'memory', 'gpu')) {
      if ($sample.ContainsKey($key)) { $body[$key] = $sample[$key] }
    }
  }
  $json = $body | ConvertTo-Json -Compress -Depth 4
  $headers = @{ Authorization = "Bearer $($Config.token)" }
  Invoke-RestMethod -Method Post -Uri $Config.url -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $json -TimeoutSec 5 | Out-Null
}

function Write-LauncherVbs([string]$Path) {
  $vbs = @"
Set sh = CreateObject("Wscript.Shell")
sh.Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""$ScriptCopy""", 0, False
"@
  Set-Content -Path $Path -Value $vbs -Encoding ascii
}

function Install-DeskTask {
  $action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "//nologo `"$LauncherVbs`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
}

if ($Uninstall) {
  try { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop } catch {}
  if (Test-Path $VbsPath) { Remove-Item $VbsPath -Force }
  if (Test-Path $LauncherVbs) { Remove-Item $LauncherVbs -Force }
  if (Test-Path $ScriptCopy) { Remove-Item $ScriptCopy -Force }
  Write-Log 'uninstalled'
  return
}

if ($Install) {
  $cfg = Read-Config
  if ($null -eq $cfg) {
    Write-Host "Fill in $ConfigPath then run -Install again."
    return
  }
  New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
  Copy-Item -Path $PSCommandPath -Destination $ScriptCopy -Force
  Write-LauncherVbs $LauncherVbs
  # 启动文件夹副本留给手工双击；真正自启走计划任务，SSH 部署也能立刻拉起且不被 sshd 杀掉。
  Write-LauncherVbs $VbsPath
  Install-DeskTask
  Start-ScheduledTask -TaskName $TaskName
  Write-Log 'installed'
  Write-Host "Installed. Task: $TaskName  Log: $LogPath"
  return
}

$cfg = Read-Config
if ($null -eq $cfg) { exit 1 }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$icon = New-Object System.Windows.Forms.NotifyIcon
$icon.Icon = [System.Drawing.SystemIcons]::Application
$icon.Visible = $true
$icon.Text = 'k20 desk'
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$exit = $menu.Items.Add('退出')
$exit.Add_Click({
  try { Send-Beat $cfg $false } catch {}
  $icon.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})
$icon.ContextMenuStrip = $menu

$lastOk = $false
function Set-Tray([bool]$Ok) {
  if ($Ok -eq $script:lastOk -and $icon.Text -ne 'k20 desk') { return }
  $script:lastOk = $Ok
  $icon.Text = $(if ($Ok) { 'k20 屏：在线' } else { 'k20 屏：上报失败' })
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = $cfg.interval * 1000
$timer.Add_Tick({
  try {
    Send-Beat $cfg $true
    Set-Tray $true
  } catch {
    Set-Tray $false
    Write-Log "beat failed: $($_.Exception.Message)"
  }
})
$timer.Start()
try { Send-Beat $cfg $true; Set-Tray $true } catch { Set-Tray $false; Write-Log "beat failed: $($_.Exception.Message)" }

# Sleep = 4, wake = 7. A failed subscription still relies on the 20s timeout.
try {
  $watcher = New-Object System.Management.ManagementEventWatcher
  $watcher.Query = "SELECT * FROM Win32_PowerManagementEvent"
  $watcher.Add_EventArrived({
    $kind = $_.NewEvent.Properties['EventType'].Value
    if ($kind -eq 4) {
      try { Send-Beat $cfg $false } catch { Write-Log "sleep beat failed: $($_.Exception.Message)" }
    } elseif ($kind -eq 7) {
      try { Send-Beat $cfg $true; Set-Tray $true } catch { Set-Tray $false }
    }
  })
  $watcher.Start()
} catch {
  Write-Log "power watch failed: $($_.Exception.Message)"
}

[System.Windows.Forms.Application]::Add_ApplicationExit({
  try { Send-Beat $cfg $false } catch {}
})
[System.Windows.Forms.Application]::Run()
