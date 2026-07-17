[CmdletBinding()]
param(
    [string]$ScreenshotPath
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$projectRoot = Get-DoubaoSkinProjectRoot
$state = Read-DoubaoSkinState
if ($null -eq $state) { throw '没有找到正在运行的豆包皮肤状态。请先启动皮肤。' }
if (-not (Test-DoubaoSkinCdpEndpoint -Port ([int]$state.port))) {
    throw '豆包调试端口不可用，皮肤可能已经退出。'
}
$node = Resolve-DoubaoSkinNode
$injectorPath = Join-Path $projectRoot 'scripts\injector.js'
$themePath = Initialize-DoubaoSkinTheme
if ([string]::IsNullOrWhiteSpace($ScreenshotPath)) {
    $ScreenshotPath = Join-Path $projectRoot 'artifacts\skin-preview.png'
}
$ScreenshotPath = [System.IO.Path]::GetFullPath($ScreenshotPath)
& $node.Path $injectorPath --verify --port ([int]$state.port) --theme $themePath --screenshot $ScreenshotPath
if ($LASTEXITCODE -ne 0) { throw '皮肤验证失败。请查看上面的页面报告。' }
Write-Host "皮肤验证通过，预览图已保存：$ScreenshotPath"
