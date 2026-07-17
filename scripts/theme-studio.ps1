[CmdletBinding()]
param(
    [switch]$SelfTest,
    [string]$ConfigPath = ''
)

$ErrorActionPreference = 'Stop'

$studioStateRoot = Join-Path $env:LOCALAPPDATA 'DoubaoDreamSkin'
$studioLogPath = Join-Path $studioStateRoot 'theme-studio.log'
$studioErrorLogPath = Join-Path $studioStateRoot 'theme-studio-error.log'

function Write-StudioLog {
    param([string]$Message)
    try {
        New-Item -ItemType Directory -Path $studioStateRoot -Force | Out-Null
        $line = "[{0}] {1}`r`n" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
        [System.IO.File]::AppendAllText($studioLogPath, $line, (New-Object System.Text.UTF8Encoding($false)))
    }
    catch { }
}

trap {
    $failure = $_
    try {
        New-Item -ItemType Directory -Path $studioStateRoot -Force | Out-Null
        $details = "[{0}]`r`n{1}`r`n{2}`r`n" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $failure.Exception.Message, $failure.ScriptStackTrace
        [System.IO.File]::WriteAllText($studioErrorLogPath, $details, (New-Object System.Text.UTF8Encoding($false)))
    }
    catch { }
    try {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
        $message = "皮肤设置启动失败：`r`n`r`n$($failure.Exception.Message)`r`n`r`n错误记录：$studioErrorLogPath"
        [System.Windows.Forms.MessageBox]::Show($message, '豆包梦幻皮肤', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
    }
    catch { }
    exit 1
}

Write-StudioLog '开始启动皮肤设置。'
. (Join-Path $PSScriptRoot 'common.ps1')

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$projectRoot = Get-DoubaoSkinProjectRoot
$themePath = if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
    Initialize-DoubaoSkinTheme
}
else {
    [System.IO.Path]::GetFullPath($ConfigPath)
}
$themesRoot = Join-Path $projectRoot 'themes'
$startScript = Join-Path $projectRoot 'scripts\start-skin.ps1'
$restoreScript = Join-Path $projectRoot 'scripts\restore-skin.ps1'
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$script:selectedImagePath = $null

function Read-StudioTheme {
    return (Get-Content -LiteralPath $themePath -Raw -Encoding UTF8 | ConvertFrom-Json)
}

function Get-AlphaPercent {
    param([string]$Color, [int]$Fallback)
    if ($Color -match 'rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\s*\)') {
        return [Math]::Max(0, [Math]::Min(100, [int]([double]$Matches[1] * 100)))
    }
    return $Fallback
}

function Resolve-ThemeImagePath {
    param($Theme)
    $candidate = Join-Path (Split-Path -Parent $themePath) ([string]$Theme.backgroundImage)
    return [System.IO.Path]::GetFullPath($candidate)
}

function Set-PreviewImage {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
    if ([System.IO.Path]::GetExtension($Path) -ieq '.svg') {
        $copy = [System.Drawing.Bitmap]::new(1124, 440)
        $graphics = [System.Drawing.Graphics]::FromImage($copy)
        $peach = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(150, 255, 223, 201))
        $aqua = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(150, 157, 220, 218))
        $cream = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(95, 255, 250, 238))
        try {
            $graphics.Clear([System.Drawing.Color]::FromArgb(218, 213, 235))
            $graphics.FillEllipse($peach, -150, -130, 760, 620)
            $graphics.FillEllipse($aqua, 650, 80, 650, 520)
            $graphics.FillEllipse($cream, 170, 250, 940, 300)
        }
        finally {
            $peach.Dispose()
            $aqua.Dispose()
            $cream.Dispose()
            $graphics.Dispose()
        }
    }
    else {
        $source = [System.Drawing.Image]::FromFile($Path)
        try {
            $copy = New-Object System.Drawing.Bitmap($source)
        }
        finally {
            $source.Dispose()
        }
    }
    if ($null -ne $preview.Image) { $preview.Image.Dispose() }
    $preview.Image = $copy
    $imageLabel.Text = "背景：$([System.IO.Path]::GetFileName($Path))"
}

function Add-TrackRow {
    param(
        [System.Windows.Forms.Control]$Parent,
        [string]$Label,
        [int]$Top,
        [int]$Minimum,
        [int]$Maximum,
        [int]$Value,
        [string]$Suffix
    )
    $caption = New-Object System.Windows.Forms.Label
    $caption.Text = $Label
    $caption.SetBounds(24, $Top + 6, 110, 24)
    $Parent.Controls.Add($caption)

    $track = New-Object System.Windows.Forms.TrackBar
    $track.Minimum = $Minimum
    $track.Maximum = $Maximum
    $track.Value = [Math]::Max($Minimum, [Math]::Min($Maximum, $Value))
    $track.TickFrequency = [Math]::Max(1, [int](($Maximum - $Minimum) / 8))
    $track.SetBounds(135, $Top, 360, 38)
    $Parent.Controls.Add($track)

    $valueLabel = New-Object System.Windows.Forms.Label
    $valueLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
    $valueLabel.SetBounds(495, $Top + 5, 82, 24)
    $valueLabel.Text = "$($track.Value)$Suffix"
    $Parent.Controls.Add($valueLabel)
    $track.Add_ValueChanged(({ $valueLabel.Text = "$($track.Value)$Suffix" }).GetNewClosure())
    return $track
}

$theme = Read-StudioTheme
$form = New-Object System.Windows.Forms.Form
$form.Text = '豆包梦幻皮肤设置'
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.ClientSize = New-Object System.Drawing.Size(610, 635)
$form.BackColor = [System.Drawing.Color]::FromArgb(250, 246, 243)
$form.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)

$title = New-Object System.Windows.Forms.Label
$title.Text = '豆包梦幻皮肤'
$title.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 16, [System.Drawing.FontStyle]::Bold)
$title.SetBounds(22, 16, 260, 34)
$form.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = '选择背景并调整玻璃效果；运行中的皮肤会自动更新。'
$subtitle.ForeColor = [System.Drawing.Color]::FromArgb(110, 96, 90)
$subtitle.SetBounds(24, 52, 480, 22)
$form.Controls.Add($subtitle)

$preview = New-Object System.Windows.Forms.PictureBox
$preview.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$preview.BackColor = [System.Drawing.Color]::FromArgb(232, 225, 220)
$preview.SizeMode = [System.Windows.Forms.PictureBoxSizeMode]::Zoom
$preview.SetBounds(24, 82, 562, 220)
$form.Controls.Add($preview)

$imageLabel = New-Object System.Windows.Forms.Label
$imageLabel.AutoEllipsis = $true
$imageLabel.SetBounds(24, 310, 420, 24)
$form.Controls.Add($imageLabel)

$browseButton = New-Object System.Windows.Forms.Button
$browseButton.Text = '选择背景图片…'
$browseButton.SetBounds(452, 306, 134, 30)
$form.Controls.Add($browseButton)

$brightnessTrack = Add-TrackRow -Parent $form -Label '背景亮度' -Top 348 -Minimum 50 -Maximum 130 -Value ([int]([double]$theme.backgroundBrightness * 100)) -Suffix '%'
$surfaceTrack = Add-TrackRow -Parent $form -Label '主区遮罩' -Top 390 -Minimum 0 -Maximum 80 -Value (Get-AlphaPercent -Color ([string]$theme.surfaceColor) -Fallback 34) -Suffix '%'
$sidebarTrack = Add-TrackRow -Parent $form -Label '侧栏遮罩' -Top 432 -Minimum 15 -Maximum 90 -Value (Get-AlphaPercent -Color ([string]$theme.sidebarColor) -Fallback 64) -Suffix '%'
$blurTrack = Add-TrackRow -Parent $form -Label '玻璃模糊' -Top 474 -Minimum 0 -Maximum 40 -Value ([int]$theme.blurPixels) -Suffix ' px'

$positionLabel = New-Object System.Windows.Forms.Label
$positionLabel.Text = '背景焦点'
$positionLabel.SetBounds(24, 525, 110, 24)
$form.Controls.Add($positionLabel)

$positionBox = New-Object System.Windows.Forms.ComboBox
$positionBox.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
$null = $positionBox.Items.Add('center center')
$null = $positionBox.Items.Add('center top')
$null = $positionBox.Items.Add('40% center')
$null = $positionBox.Items.Add('60% center')
$null = $positionBox.Items.Add('center bottom')
$positionBox.SetBounds(135, 521, 190, 30)
$selectedPosition = [string]$theme.backgroundPosition
$positionIndex = $positionBox.Items.IndexOf($selectedPosition)
if ($positionIndex -lt 0) { $positionIndex = 0 }
$positionBox.SelectedIndex = $positionIndex
$form.Controls.Add($positionBox)

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(116, 77, 65)
$statusLabel.SetBounds(338, 524, 248, 24)
$statusLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
$form.Controls.Add($statusLabel)

$saveButton = New-Object System.Windows.Forms.Button
$saveButton.Text = '保存并应用'
$saveButton.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9, [System.Drawing.FontStyle]::Bold)
$saveButton.BackColor = [System.Drawing.Color]::FromArgb(184, 95, 75)
$saveButton.ForeColor = [System.Drawing.Color]::White
$saveButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$saveButton.SetBounds(24, 570, 160, 42)
$form.Controls.Add($saveButton)

$startButton = New-Object System.Windows.Forms.Button
$startButton.Text = '启动皮肤'
$startButton.SetBounds(198, 570, 126, 42)
$form.Controls.Add($startButton)

$restoreButton = New-Object System.Windows.Forms.Button
$restoreButton.Text = '恢复官方外观'
$restoreButton.SetBounds(338, 570, 126, 42)
$form.Controls.Add($restoreButton)

$closeButton = New-Object System.Windows.Forms.Button
$closeButton.Text = '关闭'
$closeButton.SetBounds(478, 570, 108, 42)
$form.Controls.Add($closeButton)

$browseButton.Add_Click({
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = '选择豆包背景图片'
    $dialog.Filter = '图片文件|*.jpg;*.jpeg;*.png;*.webp|所有文件|*.*'
    if ($dialog.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) {
        $file = Get-Item -LiteralPath $dialog.FileName
        if ($file.Length -gt 16MB) {
            [System.Windows.Forms.MessageBox]::Show('图片不能超过 16 MB。', '豆包梦幻皮肤') | Out-Null
            return
        }
        $script:selectedImagePath = $file.FullName
        Set-PreviewImage -Path $file.FullName
        $statusLabel.Text = '图片已选择，点击保存并应用'
    }
})

$saveButton.Add_Click({
    try {
        $current = Read-StudioTheme
        if ($script:selectedImagePath) {
            $extension = [System.IO.Path]::GetExtension($script:selectedImagePath).ToLowerInvariant()
            if ($extension -notin @('.jpg', '.jpeg', '.png', '.webp')) { throw '只支持 JPG、PNG 或 WebP 图片。' }
            New-Item -ItemType Directory -Path $themesRoot -Force | Out-Null
            $destination = Join-Path $themesRoot ("custom-background" + $extension)
            if (-not [System.IO.Path]::GetFullPath($script:selectedImagePath).Equals([System.IO.Path]::GetFullPath($destination), [System.StringComparison]::OrdinalIgnoreCase)) {
                Copy-Item -LiteralPath $script:selectedImagePath -Destination $destination -Force
            }
            $current.backgroundImage = "../themes/$([System.IO.Path]::GetFileName($destination))"
        }
        $current.backgroundBrightness = [Math]::Round($brightnessTrack.Value / 100.0, 2)
        $current.surfaceColor = "rgba(255, 250, 246, $([Math]::Round($surfaceTrack.Value / 100.0, 2)))"
        $current.sidebarColor = "rgba(255, 241, 232, $([Math]::Round($sidebarTrack.Value / 100.0, 2)))"
        $current.blurPixels = $blurTrack.Value
        $current.backgroundPosition = [string]$positionBox.SelectedItem
        $json = $current | ConvertTo-Json -Depth 10
        $encoding = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($themePath, $json + "`r`n", $encoding)
        $script:selectedImagePath = $null
        $statusLabel.Text = '已保存，运行中的皮肤正在更新'

        $state = Read-DoubaoSkinState
        $active = $false
        if ($null -ne $state -and $null -ne $state.injectorPid) {
            $active = $null -ne (Get-Process -Id ([int]$state.injectorPid) -ErrorAction SilentlyContinue)
        }
        if (-not $active) {
            Start-Process -FilePath $powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`" -PromptRestart" -WorkingDirectory $projectRoot | Out-Null
            $statusLabel.Text = '配置已保存，正在启动皮肤…'
        }
    }
    catch {
        [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, '保存失败', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
    }
})

$startButton.Add_Click({
    Start-Process -FilePath $powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`" -PromptRestart" -WorkingDirectory $projectRoot | Out-Null
    $statusLabel.Text = '正在启动皮肤…'
})

$restoreButton.Add_Click({
    Start-Process -FilePath $powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$restoreScript`" -PromptRestart" -WorkingDirectory $projectRoot | Out-Null
    $statusLabel.Text = '正在恢复官方外观…'
})

$closeButton.Add_Click({ $form.Close() })
$form.Add_FormClosed({ if ($null -ne $preview.Image) { $preview.Image.Dispose() } })

Set-PreviewImage -Path (Resolve-ThemeImagePath -Theme $theme)
if ($SelfTest) {
    if ($null -eq $preview.Image) { throw 'Theme Studio preview did not load.' }
    Write-Output "Theme Studio self-test passed: $($theme.name)"
    $preview.Image.Dispose()
    $form.Dispose()
}
else {
    Write-StudioLog '设置窗口已显示。'
    [void]$form.ShowDialog()
    Write-StudioLog '设置窗口已关闭。'
}
