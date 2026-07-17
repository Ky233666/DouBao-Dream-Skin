[CmdletBinding()]
param(
    [int]$Port = 0,
    [switch]$RestartExisting,
    [switch]$PromptRestart
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$projectRoot = Get-DoubaoSkinProjectRoot
$stateRoot = Get-DoubaoSkinStateRoot
$statePath = Join-Path $stateRoot 'state.json'
$statusPath = Join-Path $stateRoot 'status.json'
$stdoutPath = Join-Path $stateRoot 'injector.log'
$stderrPath = Join-Path $stateRoot 'injector-error.log'
$themePath = Initialize-DoubaoSkinTheme
$injectorPath = Join-Path $projectRoot 'scripts\injector.js'
$install = Resolve-DoubaoInstall
$node = Resolve-DoubaoSkinNode
$config = Read-DoubaoSkinAppConfig
$existingState = Read-DoubaoSkinState
$launchedWithCdp = $false
$injector = $null

try {
    if ($null -ne $existingState) {
        try { Stop-DoubaoSkinInjector -State $existingState } catch { Write-Warning $_.Exception.Message }
        $oldPort = [int]$existingState.port
        if ((Test-DoubaoSkinCdpEndpoint -Port $oldPort) -and (Test-DoubaoCdpProcess -Port $oldPort)) {
            try { & $node.Path $injectorPath --remove --port $oldPort --state-dir $stateRoot | Out-Null } catch {}
        }
    }

    if ($Port -eq 0) { $Port = [int]$config.preferredPort }
    if ($Port -lt 1024 -or $Port -gt 65535) { throw "端口无效：$Port" }

    $debugReady = (Test-DoubaoSkinCdpEndpoint -Port $Port) -and (Test-DoubaoCdpProcess -Port $Port)
    $running = @(Get-DoubaoProcesses)
    if (-not $debugReady -and $running.Count -gt 0) {
        $allowed = [bool]$RestartExisting
        if (-not $allowed -and $PromptRestart) { $allowed = Confirm-DoubaoRestart }
        if (-not $allowed) {
            throw '豆包正在运行但没有启用皮肤调试端口。请先退出豆包，或允许启动器重启它。'
        }
        Stop-DoubaoProcesses -AllowForce
    }

    if (-not $debugReady) {
        if (-not (Test-DoubaoSkinPortAvailable -Port $Port)) {
            if ($PSBoundParameters.ContainsKey('Port')) {
                throw "端口 $Port 已被其他程序占用。"
            }
            $Port = Select-DoubaoSkinPort -PreferredPort ([int]$config.preferredPort)
        }
        $arguments = @(
            '--registry-web-browser',
            '--remote-debugging-address=127.0.0.1',
            "--remote-debugging-port=$Port"
        )
        Start-Process -FilePath $install.AppExe -ArgumentList $arguments -WorkingDirectory (Split-Path -Parent $install.AppExe) | Out-Null
        $launchedWithCdp = $true
        Wait-DoubaoSkinCdp -Port $Port
        if (-not (Test-DoubaoCdpProcess -Port $Port)) {
            throw '调试端口虽然有响应，但无法确认它属于豆包进程。'
        }
    }

    New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
    Remove-Item -LiteralPath $statusPath -Force -ErrorAction SilentlyContinue
    $argumentValues = @(
        $injectorPath,
        '--watch',
        '--port', "$Port",
        '--theme', $themePath,
        '--state-dir', $stateRoot
    )
    $argumentLine = ($argumentValues | ForEach-Object { ConvertTo-DoubaoProcessArgument -Value ([string]$_) }) -join ' '
    $injector = Start-Process -FilePath $node.Path -ArgumentList $argumentLine -WorkingDirectory $projectRoot `
        -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath

    $state = [pscustomobject]@{
        schemaVersion = 1
        active = $true
        port = $Port
        injectorPid = $injector.Id
        injectorPath = $injectorPath
        nodePath = $node.Path
        nodeVersion = $node.Version
        doubaoExe = $install.AppExe
        themePath = $themePath
        createdAt = (Get-Date).ToUniversalTime().ToString('o')
    }
    Write-DoubaoSkinJson -Path $statePath -Value $state

    $deadline = (Get-Date).AddSeconds(30)
    $status = $null
    do {
        Start-Sleep -Milliseconds 400
        if ($injector.HasExited) {
            $details = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue } else { '' }
            throw "皮肤注入器提前退出。$details"
        }
        if (Test-Path -LiteralPath $statusPath -PathType Leaf) {
            try { $status = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $status = $null }
        }
        $injectedCount = if ($null -ne $status -and $null -ne $status.injectedTargetIds) { @($status.injectedTargetIds).Count } else { 0 }
        if ($null -ne $status -and $status.active -and $injectedCount -gt 0) { break }
    } while ((Get-Date) -lt $deadline)

    $injectedCount = if ($null -ne $status -and $null -ne $status.injectedTargetIds) { @($status.injectedTargetIds).Count } else { 0 }
    if ($null -eq $status -or -not $status.active -or $injectedCount -eq 0) {
        $details = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue } else { '' }
        throw "没有找到可注入的豆包主页面。$details"
    }

    Write-Host "豆包梦幻皮肤已启用。主题：$($status.theme.name)；调试端口：$Port"
    Write-Host '保持注入器在后台运行即可；双击“恢复豆包外观.cmd”可完全恢复。'
}
catch {
    $startupError = $_
    if ($null -ne $injector -and -not $injector.HasExited) {
        try { Stop-Process -Id $injector.Id -Force -ErrorAction SilentlyContinue } catch {}
    }
    Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $statusPath -Force -ErrorAction SilentlyContinue
    if ($launchedWithCdp) {
        try {
            Stop-DoubaoProcesses -AllowForce
            Start-DoubaoNormally
        }
        catch {
            Write-Warning '启动失败后未能自动恢复豆包，请手动重新打开豆包。'
        }
    }
    throw $startupError
}
