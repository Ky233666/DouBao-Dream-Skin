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

function Get-ThemeColor {
    param(
        [string]$Value,
        [int]$FallbackRed,
        [int]$FallbackGreen,
        [int]$FallbackBlue,
        [int]$FallbackAlpha
    )
    $red = $FallbackRed
    $green = $FallbackGreen
    $blue = $FallbackBlue
    $alpha = $FallbackAlpha
    if ($Value -match '^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([0-9.]+))?\s*\)$') {
        $red = [Math]::Max(0, [Math]::Min(255, [int]$Matches[1]))
        $green = [Math]::Max(0, [Math]::Min(255, [int]$Matches[2]))
        $blue = [Math]::Max(0, [Math]::Min(255, [int]$Matches[3]))
        if (-not [string]::IsNullOrWhiteSpace($Matches[4])) {
            $alpha = [Math]::Max(0, [Math]::Min(100, [int]([double]$Matches[4] * 100)))
        }
    }
    elseif ($Value -match '^#([0-9a-fA-F]{6})$') {
        $red = [Convert]::ToInt32($Matches[1].Substring(0, 2), 16)
        $green = [Convert]::ToInt32($Matches[1].Substring(2, 2), 16)
        $blue = [Convert]::ToInt32($Matches[1].Substring(4, 2), 16)
    }
    return [pscustomobject]@{
        Color = [System.Drawing.Color]::FromArgb(255, $red, $green, $blue)
        Alpha = $alpha
    }
}

function Update-ColorButton {
    param(
        [System.Windows.Forms.Button]$Button,
        [System.Drawing.Color]$Color
    )
    $Button.Tag = $Color
    $Button.BackColor = $Color
    $Button.Text = '#{0:X2}{1:X2}{2:X2}' -f $Color.R, $Color.G, $Color.B
    $luminance = (0.299 * $Color.R) + (0.587 * $Color.G) + (0.114 * $Color.B)
    $Button.ForeColor = if ($luminance -lt 145) { [System.Drawing.Color]::White } else { [System.Drawing.Color]::Black }
}

function Format-StudioRgba {
    param(
        [System.Drawing.Color]$Color,
        [int]$AlphaPercent
    )
    $alpha = ($AlphaPercent / 100.0).ToString('0.##', [System.Globalization.CultureInfo]::InvariantCulture)
    return "rgba($($Color.R), $($Color.G), $($Color.B), $alpha)"
}

function Add-ColorOpacityRow {
    param(
        [System.Windows.Forms.Control]$Parent,
        [string]$Label,
        [int]$Top,
        $Initial,
        [int]$MinimumAlpha = 0
    )
    $caption = New-Object System.Windows.Forms.Label
    $caption.Text = $Label
    $caption.SetBounds(12, $Top + 7, 72, 24)
    $Parent.Controls.Add($caption)

    $colorButton = New-Object System.Windows.Forms.Button
    $colorButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $colorButton.UseVisualStyleBackColor = $false
    $colorButton.SetBounds(82, $Top, 112, 32)
    Update-ColorButton -Button $colorButton -Color $Initial.Color
    $Parent.Controls.Add($colorButton)

    $alphaCaption = New-Object System.Windows.Forms.Label
    $alphaCaption.Text = '透明度'
    $alphaCaption.SetBounds(206, $Top + 7, 54, 24)
    $Parent.Controls.Add($alphaCaption)

    $alphaTrack = New-Object System.Windows.Forms.TrackBar
    $alphaTrack.Minimum = $MinimumAlpha
    $alphaTrack.Maximum = 100
    $alphaTrack.Value = [Math]::Max($MinimumAlpha, [Math]::Min(100, [int]$Initial.Alpha))
    $alphaTrack.TickFrequency = 10
    $alphaTrack.SetBounds(258, $Top - 1, 210, 38)
    $Parent.Controls.Add($alphaTrack)

    $alphaValue = New-Object System.Windows.Forms.Label
    $alphaValue.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
    $alphaValue.SetBounds(466, $Top + 6, 62, 24)
    $alphaValue.Text = "$($alphaTrack.Value)%"
    $Parent.Controls.Add($alphaValue)
    $alphaTrack.Add_ValueChanged(({ $alphaValue.Text = "$($alphaTrack.Value)%" }).GetNewClosure())

    $colorButton.Add_Click(({
        $dialog = New-Object System.Windows.Forms.ColorDialog
        $dialog.AnyColor = $true
        $dialog.FullOpen = $true
        $dialog.Color = [System.Drawing.Color]$colorButton.Tag
        if ($dialog.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) {
            Update-ColorButton -Button $colorButton -Color $dialog.Color
            $statusLabel.Text = '颜色已调整，点击保存并应用'
        }
        $dialog.Dispose()
    }).GetNewClosure())

    return [pscustomobject]@{
        ColorButton = $colorButton
        AlphaTrack = $alphaTrack
    }
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
    $caption.SetBounds(12, $Top + 6, 90, 24)
    $Parent.Controls.Add($caption)

    $track = New-Object System.Windows.Forms.TrackBar
    $track.Minimum = $Minimum
    $track.Maximum = $Maximum
    $track.Value = [Math]::Max($Minimum, [Math]::Min($Maximum, $Value))
    $track.TickFrequency = [Math]::Max(1, [int](($Maximum - $Minimum) / 8))
    $track.SetBounds(100, $Top, 365, 38)
    $Parent.Controls.Add($track)

    $valueLabel = New-Object System.Windows.Forms.Label
    $valueLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
    $valueLabel.SetBounds(464, $Top + 5, 66, 24)
    $valueLabel.Text = "$($track.Value)$Suffix"
    $Parent.Controls.Add($valueLabel)
    $track.Add_ValueChanged(({ $valueLabel.Text = "$($track.Value)$Suffix" }).GetNewClosure())
    return $track
}

$theme = Read-StudioTheme
$sidebarInitial = Get-ThemeColor -Value ([string]$theme.sidebarColor) -FallbackRed 255 -FallbackGreen 241 -FallbackBlue 232 -FallbackAlpha 48
$surfaceInitial = Get-ThemeColor -Value ([string]$theme.surfaceColor) -FallbackRed 255 -FallbackGreen 250 -FallbackBlue 246 -FallbackAlpha 35
$composerInitial = Get-ThemeColor -Value ([string]$theme.composerColor) -FallbackRed 255 -FallbackGreen 252 -FallbackBlue 249 -FallbackAlpha 82
$form = New-Object System.Windows.Forms.Form
$form.Text = '豆包梦幻皮肤设置'
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.ClientSize = New-Object System.Drawing.Size(610, 690)
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
$preview.SetBounds(24, 82, 562, 185)
$form.Controls.Add($preview)

$imageLabel = New-Object System.Windows.Forms.Label
$imageLabel.AutoEllipsis = $true
$imageLabel.SetBounds(24, 275, 420, 24)
$form.Controls.Add($imageLabel)

$browseButton = New-Object System.Windows.Forms.Button
$browseButton.Text = '选择背景图片…'
$browseButton.SetBounds(452, 271, 134, 30)
$form.Controls.Add($browseButton)

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(116, 77, 65)
$statusLabel.SetBounds(24, 605, 562, 24)
$statusLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
$form.Controls.Add($statusLabel)

$tabs = New-Object System.Windows.Forms.TabControl
$tabs.SetBounds(24, 310, 562, 288)
$form.Controls.Add($tabs)

$commonTab = New-Object System.Windows.Forms.TabPage
$commonTab.Text = '背景与效果'
$commonTab.BackColor = [System.Drawing.Color]::FromArgb(250, 246, 243)
$tabs.TabPages.Add($commonTab)

$colorsTab = New-Object System.Windows.Forms.TabPage
$colorsTab.Text = '颜色与透明度'
$colorsTab.BackColor = [System.Drawing.Color]::FromArgb(250, 246, 243)
$tabs.TabPages.Add($colorsTab)

$brightnessTrack = Add-TrackRow -Parent $commonTab -Label '背景亮度' -Top 10 -Minimum 50 -Maximum 130 -Value ([int]([double]$theme.backgroundBrightness * 100)) -Suffix '%'
$saturationTrack = Add-TrackRow -Parent $commonTab -Label '背景饱和度' -Top 54 -Minimum 0 -Maximum 200 -Value ([int]([double]$theme.backgroundSaturation * 100)) -Suffix '%'
$blurTrack = Add-TrackRow -Parent $commonTab -Label '玻璃模糊' -Top 98 -Minimum 0 -Maximum 60 -Value ([int]$theme.blurPixels) -Suffix ' px'

$positionLabel = New-Object System.Windows.Forms.Label
$positionLabel.Text = '背景焦点'
$positionLabel.SetBounds(12, 153, 90, 24)
$commonTab.Controls.Add($positionLabel)

$positionBox = New-Object System.Windows.Forms.ComboBox
$positionBox.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
$null = $positionBox.Items.Add('center center')
$null = $positionBox.Items.Add('center top')
$null = $positionBox.Items.Add('40% center')
$null = $positionBox.Items.Add('60% center')
$null = $positionBox.Items.Add('center bottom')
$positionBox.SetBounds(100, 149, 210, 30)
$selectedPosition = [string]$theme.backgroundPosition
$positionIndex = $positionBox.Items.IndexOf($selectedPosition)
if ($positionIndex -lt 0) { $positionIndex = 0 }
$positionBox.SelectedIndex = $positionIndex
$commonTab.Controls.Add($positionBox)

$commonHint = New-Object System.Windows.Forms.Label
$commonHint.Text = '亮度和饱和度控制背景观感；模糊值越高，玻璃效果越柔和。'
$commonHint.ForeColor = [System.Drawing.Color]::FromArgb(118, 105, 99)
$commonHint.SetBounds(12, 200, 520, 42)
$commonTab.Controls.Add($commonHint)

$sidebarRow = Add-ColorOpacityRow -Parent $colorsTab -Label '左侧栏' -Top 14 -Initial $sidebarInitial -MinimumAlpha 15
$surfaceRow = Add-ColorOpacityRow -Parent $colorsTab -Label '主区域' -Top 78 -Initial $surfaceInitial -MinimumAlpha 0
$composerRow = Add-ColorOpacityRow -Parent $colorsTab -Label '输入框' -Top 142 -Initial $composerInitial -MinimumAlpha 20

$colorsHint = New-Object System.Windows.Forms.Label
$colorsHint.Text = '点击色块选择颜色；透明度越低，背景图片越清晰。'
$colorsHint.ForeColor = [System.Drawing.Color]::FromArgb(118, 105, 99)
$colorsHint.SetBounds(12, 204, 520, 30)
$colorsTab.Controls.Add($colorsHint)

$saveButton = New-Object System.Windows.Forms.Button
$saveButton.Text = '保存并应用'
$saveButton.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9, [System.Drawing.FontStyle]::Bold)
$saveButton.BackColor = [System.Drawing.Color]::FromArgb(184, 95, 75)
$saveButton.ForeColor = [System.Drawing.Color]::White
$saveButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$saveButton.SetBounds(24, 635, 160, 42)
$form.Controls.Add($saveButton)

$startButton = New-Object System.Windows.Forms.Button
$startButton.Text = '启动皮肤'
$startButton.SetBounds(198, 635, 126, 42)
$form.Controls.Add($startButton)

$restoreButton = New-Object System.Windows.Forms.Button
$restoreButton.Text = '恢复官方外观'
$restoreButton.SetBounds(338, 635, 126, 42)
$form.Controls.Add($restoreButton)

$closeButton = New-Object System.Windows.Forms.Button
$closeButton.Text = '关闭'
$closeButton.SetBounds(478, 635, 108, 42)
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
        $current.backgroundSaturation = [Math]::Round($saturationTrack.Value / 100.0, 2)
        $current.sidebarColor = Format-StudioRgba -Color ([System.Drawing.Color]$sidebarRow.ColorButton.Tag) -AlphaPercent $sidebarRow.AlphaTrack.Value
        $current.surfaceColor = Format-StudioRgba -Color ([System.Drawing.Color]$surfaceRow.ColorButton.Tag) -AlphaPercent $surfaceRow.AlphaTrack.Value
        $current.composerColor = Format-StudioRgba -Color ([System.Drawing.Color]$composerRow.ColorButton.Tag) -AlphaPercent $composerRow.AlphaTrack.Value
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
    $parsedTestColor = Get-ThemeColor -Value 'rgba(12, 34, 56, 0.42)' -FallbackRed 1 -FallbackGreen 2 -FallbackBlue 3 -FallbackAlpha 4
    if ($parsedTestColor.Color.R -ne 12 -or $parsedTestColor.Color.G -ne 34 -or $parsedTestColor.Color.B -ne 56 -or $parsedTestColor.Alpha -ne 42) {
        throw 'Theme Studio color parsing self-test failed.'
    }
    if ((Format-StudioRgba -Color $parsedTestColor.Color -AlphaPercent $parsedTestColor.Alpha) -ne 'rgba(12, 34, 56, 0.42)') {
        throw 'Theme Studio color formatting self-test failed.'
    }
    if ($null -eq $saturationTrack -or $null -eq $sidebarRow -or $null -eq $surfaceRow -or $null -eq $composerRow) {
        throw 'Theme Studio advanced controls did not initialize.'
    }
    Write-Output "Theme Studio self-test passed: $($theme.name)"
    $preview.Image.Dispose()
    $form.Dispose()
}
else {
    Write-StudioLog '设置窗口已显示。'
    [void]$form.ShowDialog()
    Write-StudioLog '设置窗口已关闭。'
}
