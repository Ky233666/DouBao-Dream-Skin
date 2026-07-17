Set-StrictMode -Version 2.0

function Get-DoubaoSkinProjectRoot {
    return [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
}

function Read-DoubaoSkinAppConfig {
    $path = Join-Path (Get-DoubaoSkinProjectRoot) 'config\app.json'
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        $examplePath = Join-Path (Get-DoubaoSkinProjectRoot) 'config\app.example.json'
        if (-not (Test-Path -LiteralPath $examplePath -PathType Leaf)) {
            throw "找不到应用配置模板：$examplePath"
        }
        Copy-Item -LiteralPath $examplePath -Destination $path
    }
    return (Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json)
}

function Initialize-DoubaoSkinTheme {
    $root = Get-DoubaoSkinProjectRoot
    $path = Join-Path $root 'config\theme.json'
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        $examplePath = Join-Path $root 'config\theme.example.json'
        if (-not (Test-Path -LiteralPath $examplePath -PathType Leaf)) {
            throw "找不到主题配置模板：$examplePath"
        }
        Copy-Item -LiteralPath $examplePath -Destination $path
    }
    return $path
}

function Get-DoubaoSkinStateRoot {
    $config = Read-DoubaoSkinAppConfig
    $name = [string]$config.stateDirectoryName
    if ([string]::IsNullOrWhiteSpace($name) -or $name -notmatch '^[A-Za-z0-9._-]{1,80}$') {
        throw 'stateDirectoryName 配置无效。'
    }
    return (Join-Path $env:LOCALAPPDATA $name)
}

function Write-DoubaoSkinJson {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value
    )
    $directory = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $directory)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
    $temporary = "$Path.$PID.tmp"
    $json = $Value | ConvertTo-Json -Depth 10
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($temporary, $json + "`r`n", $encoding)
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Read-DoubaoSkinState {
    $path = Join-Path (Get-DoubaoSkinStateRoot) 'state.json'
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
    try {
        return (Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json)
    }
    catch {
        throw "皮肤状态文件损坏：$path"
    }
}

function Resolve-DoubaoInstall {
    $config = Read-DoubaoSkinAppConfig
    $candidates = @()
    $configuredRoot = [string]$config.doubaoInstallRoot
    if (-not [string]::IsNullOrWhiteSpace($configuredRoot)) { $candidates += $configuredRoot }

    foreach ($process in @(Get-Process -Name 'Doubao' -ErrorAction SilentlyContinue)) {
        try {
            $processPath = [string]$process.Path
            if (-not [string]::IsNullOrWhiteSpace($processPath)) {
                $parent = Split-Path -Parent $processPath
                $candidates += $parent
                if ((Split-Path -Leaf $parent) -ieq 'app') { $candidates += (Split-Path -Parent $parent) }
            }
        }
        catch { }
    }

    $uninstallRoots = @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    foreach ($registryRoot in $uninstallRoots) {
        foreach ($entry in @(Get-ItemProperty -Path $registryRoot -ErrorAction SilentlyContinue | Where-Object {
            $null -ne $_.PSObject.Properties['DisplayName'] -and [string]$_.PSObject.Properties['DisplayName'].Value -match '豆包|Doubao'
        })) {
            $installLocation = if ($null -ne $entry.PSObject.Properties['InstallLocation']) { [string]$entry.PSObject.Properties['InstallLocation'].Value } else { '' }
            $displayIcon = if ($null -ne $entry.PSObject.Properties['DisplayIcon']) { [string]$entry.PSObject.Properties['DisplayIcon'].Value } else { '' }
            if (-not [string]::IsNullOrWhiteSpace($installLocation)) {
                $candidates += $installLocation
            }
            if (-not [string]::IsNullOrWhiteSpace($displayIcon)) {
                $iconPath = ($displayIcon -replace ',\s*\d+$', '').Trim('"')
                if (Test-Path -LiteralPath $iconPath -PathType Leaf) {
                    $iconParent = Split-Path -Parent $iconPath
                    $candidates += $iconParent
                    if ((Split-Path -Leaf $iconParent) -ieq 'app') { $candidates += (Split-Path -Parent $iconParent) }
                }
            }
        }
    }

    $commonRoots = @(
        (Join-Path $env:LOCALAPPDATA 'Doubao'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Doubao'),
        (Join-Path $env:ProgramFiles 'Doubao')
    )
    if (-not [string]::IsNullOrWhiteSpace(${env:ProgramFiles(x86)})) {
        $commonRoots += (Join-Path ${env:ProgramFiles(x86)} 'Doubao')
    }
    $candidates += $commonRoots

    foreach ($candidate in @($candidates | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | Select-Object -Unique)) {
        try {
            $root = [System.IO.Path]::GetFullPath([string]$candidate)
            if ((Split-Path -Leaf $root) -ieq 'app' -and (Test-Path -LiteralPath (Join-Path $root 'Doubao.exe') -PathType Leaf)) {
                $root = Split-Path -Parent $root
            }
            $appExe = Join-Path $root 'app\Doubao.exe'
            if (-not (Test-Path -LiteralPath $appExe -PathType Leaf)) { continue }
            $launcherExe = Join-Path $root 'Doubao.exe'
            if (-not (Test-Path -LiteralPath $launcherExe -PathType Leaf)) { $launcherExe = $appExe }
            return [pscustomobject]@{
                Root = $root
                AppExe = [System.IO.Path]::GetFullPath($appExe)
                LauncherExe = [System.IO.Path]::GetFullPath($launcherExe)
            }
        }
        catch { }
    }

    $configPath = Join-Path (Get-DoubaoSkinProjectRoot) 'config\app.json'
    throw "未自动找到豆包安装目录。请在 $configPath 中填写 doubaoInstallRoot，例如 D:\doubao。"
}

function Resolve-DoubaoSkinNode {
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        throw '没有找到 Node.js。请安装 Node.js 14.18 或更高版本后重试。'
    }
    $versionText = (& $command.Source --version 2>$null)
    if ($LASTEXITCODE -ne 0 -or $versionText -notmatch '^v(\d+)\.(\d+)\.(\d+)$') {
        throw '无法识别当前 Node.js 版本。'
    }
    $major = [int]$Matches[1]
    $minor = [int]$Matches[2]
    if ($major -lt 14 -or ($major -eq 14 -and $minor -lt 18)) {
        throw "Node.js 版本过低：$versionText；至少需要 14.18。"
    }
    return [pscustomobject]@{ Path = $command.Source; Version = $versionText }
}

function Get-DoubaoProcesses {
    return @(Get-Process -Name 'Doubao' -ErrorAction SilentlyContinue)
}

function Get-DoubaoProcessCommandLines {
    try {
        return @(Get-CimInstance Win32_Process -Filter "Name = 'Doubao.exe'" -ErrorAction Stop)
    }
    catch {
        return @()
    }
}

function Test-DoubaoCdpProcess {
    param([Parameter(Mandatory = $true)][int]$Port)
    $needle = "--remote-debugging-port=$Port"
    return [bool](Get-DoubaoProcessCommandLines | Where-Object { [string]$_.CommandLine -like "*$needle*" } | Select-Object -First 1)
}

function Test-DoubaoSkinCdpEndpoint {
    param([Parameter(Mandatory = $true)][int]$Port)
    try {
        $version = Invoke-RestMethod -UseBasicParsing -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2
        return [bool]($version.webSocketDebuggerUrl -match "^ws://(?:127\.0\.0\.1|localhost):$Port/devtools/browser/[A-Za-z0-9._-]+$")
    }
    catch {
        return $false
    }
}

function Test-DoubaoSkinPortAvailable {
    param([Parameter(Mandatory = $true)][int]$Port)
    $listener = $null
    try {
        $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
        $listener.Start()
        return $true
    }
    catch {
        return $false
    }
    finally {
        if ($null -ne $listener) { try { $listener.Stop() } catch {} }
    }
}

function Select-DoubaoSkinPort {
    param([Parameter(Mandatory = $true)][int]$PreferredPort)
    if ($PreferredPort -lt 1024 -or $PreferredPort -gt 65525) {
        throw "首选端口无效：$PreferredPort"
    }
    foreach ($candidate in $PreferredPort..($PreferredPort + 10)) {
        if (Test-DoubaoSkinPortAvailable -Port $candidate) { return $candidate }
    }
    throw "端口 $PreferredPort 到 $($PreferredPort + 10) 均被占用。"
}

function Confirm-DoubaoRestart {
    param([string]$Message = '豆包需要重启一次来启用皮肤。未发送的输入可能丢失，是否继续？')
    Add-Type -AssemblyName System.Windows.Forms
    $result = [System.Windows.Forms.MessageBox]::Show(
        $Message,
        '豆包梦幻皮肤',
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Question,
        [System.Windows.Forms.MessageBoxDefaultButton]::Button2
    )
    return $result -eq [System.Windows.Forms.DialogResult]::Yes
}

function Stop-DoubaoProcesses {
    param([switch]$AllowForce)
    $processes = @(Get-DoubaoProcesses)
    if ($processes.Count -eq 0) { return }
    foreach ($process in $processes) {
        try {
            if ($process.MainWindowHandle -ne 0) { $null = $process.CloseMainWindow() }
        }
        catch {}
    }
    $deadline = (Get-Date).AddSeconds(5)
    do {
        Start-Sleep -Milliseconds 250
        $remaining = @(Get-DoubaoProcesses)
    } while ($remaining.Count -gt 0 -and (Get-Date) -lt $deadline)
    if ($remaining.Count -gt 0) {
        if (-not $AllowForce) {
            throw '豆包仍在后台运行。请从系统托盘退出豆包后重试。'
        }
        $remaining | Stop-Process -Force -ErrorAction Stop
        Start-Sleep -Milliseconds 600
    }
}

function Stop-DoubaoSkinInjector {
    param($State)
    if ($null -eq $State -or $null -eq $State.injectorPid) { return }
    $injectorPid = [int]$State.injectorPid
    $process = Get-Process -Id $injectorPid -ErrorAction SilentlyContinue
    if ($null -eq $process) { return }
    $expectedPath = [System.IO.Path]::GetFullPath((Join-Path (Get-DoubaoSkinProjectRoot) 'scripts\injector.js'))
    $safe = $false
    try {
        $record = Get-CimInstance Win32_Process -Filter "ProcessId = $injectorPid" -ErrorAction Stop
        $safe = [bool]([string]$record.CommandLine -like "*$expectedPath*")
    }
    catch {}
    if (-not $safe) {
        throw "状态中的进程 $injectorPid 无法确认是本项目的注入器，因此没有结束它。"
    }
    Stop-Process -Id $injectorPid -Force -ErrorAction Stop
    try { $process.WaitForExit(3000) | Out-Null } catch {}
}

function ConvertTo-DoubaoProcessArgument {
    param([Parameter(Mandatory = $true)][string]$Value)
    if ($Value -notmatch '[\s"]') { return $Value }
    return '"' + ($Value -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}

function Wait-DoubaoSkinCdp {
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [int]$TimeoutSeconds = 35
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        if (Test-DoubaoSkinCdpEndpoint -Port $Port) { return }
        Start-Sleep -Milliseconds 350
    } while ((Get-Date) -lt $deadline)
    throw "豆包没有在 $TimeoutSeconds 秒内开放本机调试端口 $Port。"
}

function Start-DoubaoNormally {
    $install = Resolve-DoubaoInstall
    Start-Process -FilePath $install.LauncherExe -WorkingDirectory $install.Root | Out-Null
}
