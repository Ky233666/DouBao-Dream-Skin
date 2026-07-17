[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$projectRoot = Get-DoubaoSkinProjectRoot
$desktop = [Environment]::GetFolderPath('Desktop')
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$shell = New-Object -ComObject WScript.Shell

$items = @(
    [pscustomobject]@{
        Name = '豆包皮肤设置.lnk'
        Script = (Join-Path $projectRoot 'scripts\theme-studio.ps1')
        Arguments = ''
        Hidden = $true
        Description = '选择背景并调整豆包皮肤效果'
    },
    [pscustomobject]@{
        Name = '豆包梦幻皮肤.lnk'
        Script = (Join-Path $projectRoot 'scripts\start-skin.ps1')
        Arguments = '-PromptRestart'
        Hidden = $false
        Description = '使用自定义背景启动豆包'
    },
    [pscustomobject]@{
        Name = '恢复豆包官方外观.lnk'
        Script = (Join-Path $projectRoot 'scripts\restore-skin.ps1')
        Arguments = '-PromptRestart'
        Hidden = $false
        Description = '停止皮肤并恢复豆包官方外观'
    }
)

foreach ($item in $items) {
    $shortcutPath = Join-Path $desktop $item.Name
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $powershell
    $windowStyle = if ($item.Hidden) { '-WindowStyle Hidden ' } else { '' }
    $shortcut.Arguments = "-NoProfile -STA $windowStyle-ExecutionPolicy Bypass -File `"$($item.Script)`" $($item.Arguments)"
    $shortcut.WorkingDirectory = $projectRoot
    $shortcut.Description = $item.Description
    $shortcut.IconLocation = (Resolve-DoubaoInstall).LauncherExe
    $shortcut.Save()
    Write-Host "已创建：$shortcutPath"
}
