[CmdletBinding()]
param(
    [switch]$RestartDoubao,
    [switch]$PromptRestart
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$stateRoot = Get-DoubaoSkinStateRoot
$statePath = Join-Path $stateRoot 'state.json'
$statusPath = Join-Path $stateRoot 'status.json'
$state = Read-DoubaoSkinState
$node = Resolve-DoubaoSkinNode
$projectRoot = Get-DoubaoSkinProjectRoot
$injectorPath = Join-Path $projectRoot 'scripts\injector.js'

if ($null -ne $state) {
    Stop-DoubaoSkinInjector -State $state
    $port = [int]$state.port
    if ((Test-DoubaoSkinCdpEndpoint -Port $port) -and (Test-DoubaoCdpProcess -Port $port)) {
        try {
            & $node.Path $injectorPath --remove --port $port --state-dir $stateRoot
            if ($LASTEXITCODE -ne 0) { Write-Warning '当前页面的皮肤清理未完全成功；重启豆包后仍会恢复。' }
        }
        catch {
            Write-Warning '无法从当前页面即时移除皮肤；重启豆包后仍会恢复。'
        }
    }
}

$shouldRestart = [bool]$RestartDoubao
if (-not $shouldRestart -and $PromptRestart -and @(Get-DoubaoProcesses).Count -gt 0) {
    $shouldRestart = Confirm-DoubaoRestart -Message '为了关闭调试端口并完全恢复官方外观，需要重启豆包。是否现在重启？'
}

if ($shouldRestart) {
    Stop-DoubaoProcesses -AllowForce
    Start-DoubaoNormally
}

Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $statusPath -Force -ErrorAction SilentlyContinue
Write-Host '豆包梦幻皮肤已停止。'
if (-not $shouldRestart -and @(Get-DoubaoProcesses).Count -gt 0) {
    Write-Host '当前页面已尽量恢复；下次正常启动豆包时会完全恢复官方外观。'
}
