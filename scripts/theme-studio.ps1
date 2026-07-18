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

function Get-StudioThemeValue {
    param(
        $Theme,
        [string]$Name,
        $Fallback
    )
    $property = $Theme.PSObject.Properties[$Name]
    if ($null -eq $property -or $null -eq $property.Value -or [string]::IsNullOrWhiteSpace([string]$property.Value)) {
        return $Fallback
    }
    return $property.Value
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

function Format-StudioHex {
    param([System.Drawing.Color]$Color)
    return '#{0:X2}{1:X2}{2:X2}' -f $Color.R, $Color.G, $Color.B
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

function Add-SolidColorRow {
    param(
        [System.Windows.Forms.Control]$Parent,
        [string]$Label,
        [int]$Top,
        $Initial,
        [string]$Description
    )
    $caption = New-Object System.Windows.Forms.Label
    $caption.Text = $Label
    $caption.SetBounds(12, $Top + 7, 88, 24)
    $Parent.Controls.Add($caption)

    $colorButton = New-Object System.Windows.Forms.Button
    $colorButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $colorButton.UseVisualStyleBackColor = $false
    $colorButton.SetBounds(100, $Top, 128, 32)
    Update-ColorButton -Button $colorButton -Color $Initial.Color
    $Parent.Controls.Add($colorButton)

    $descriptionLabel = New-Object System.Windows.Forms.Label
    $descriptionLabel.Text = $Description
    $descriptionLabel.ForeColor = [System.Drawing.Color]::FromArgb(118, 105, 99)
    $descriptionLabel.SetBounds(242, $Top + 7, 286, 24)
    $Parent.Controls.Add($descriptionLabel)

    $colorButton.Add_Click(({
        $dialog = New-Object System.Windows.Forms.ColorDialog
        $dialog.AnyColor = $true
        $dialog.FullOpen = $true
        $dialog.Color = [System.Drawing.Color]$colorButton.Tag
        if ($dialog.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) {
            Update-ColorButton -Button $colorButton -Color $dialog.Color
            $statusLabel.Text = '文字颜色已调整，点击保存并应用'
        }
        $dialog.Dispose()
    }).GetNewClosure())
    return $colorButton
}

function Set-StudioColorOpacityRow {
    param(
        $Row,
        [string]$Value,
        [int]$FallbackRed,
        [int]$FallbackGreen,
        [int]$FallbackBlue,
        [int]$FallbackAlpha
    )
    $parsed = Get-ThemeColor -Value $Value -FallbackRed $FallbackRed -FallbackGreen $FallbackGreen -FallbackBlue $FallbackBlue -FallbackAlpha $FallbackAlpha
    Update-ColorButton -Button $Row.ColorButton -Color $parsed.Color
    $Row.AlphaTrack.Value = [Math]::Max($Row.AlphaTrack.Minimum, [Math]::Min($Row.AlphaTrack.Maximum, $parsed.Alpha))
}

function Set-StudioSolidColor {
    param(
        [System.Windows.Forms.Button]$Button,
        [string]$Value,
        [int]$FallbackRed,
        [int]$FallbackGreen,
        [int]$FallbackBlue
    )
    $parsed = Get-ThemeColor -Value $Value -FallbackRed $FallbackRed -FallbackGreen $FallbackGreen -FallbackBlue $FallbackBlue -FallbackAlpha 100
    Update-ColorButton -Button $Button -Color $parsed.Color
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
$cardInitial = Get-ThemeColor -Value ([string](Get-StudioThemeValue -Theme $theme -Name 'cardColor' -Fallback 'rgba(255, 250, 246, 0.62)')) -FallbackRed 255 -FallbackGreen 250 -FallbackBlue 246 -FallbackAlpha 62
$userBubbleInitial = Get-ThemeColor -Value ([string](Get-StudioThemeValue -Theme $theme -Name 'userBubbleColor' -Fallback 'rgba(184, 95, 75, 0.88)')) -FallbackRed 184 -FallbackGreen 95 -FallbackBlue 75 -FallbackAlpha 88
$assistantBubbleInitial = Get-ThemeColor -Value ([string](Get-StudioThemeValue -Theme $theme -Name 'assistantBubbleColor' -Fallback 'rgba(255, 255, 255, 0.62)')) -FallbackRed 255 -FallbackGreen 255 -FallbackBlue 255 -FallbackAlpha 62
$accentInitial = Get-ThemeColor -Value ([string](Get-StudioThemeValue -Theme $theme -Name 'accentColor' -Fallback '#b85f4b')) -FallbackRed 184 -FallbackGreen 95 -FallbackBlue 75 -FallbackAlpha 100
$accentTextInitial = Get-ThemeColor -Value ([string](Get-StudioThemeValue -Theme $theme -Name 'accentTextColor' -Fallback '#fffaf8')) -FallbackRed 255 -FallbackGreen 250 -FallbackBlue 248 -FallbackAlpha 100
$textInitial = Get-ThemeColor -Value ([string](Get-StudioThemeValue -Theme $theme -Name 'textColor' -Fallback '#1f2329')) -FallbackRed 31 -FallbackGreen 35 -FallbackBlue 41 -FallbackAlpha 100
$mutedTextInitial = Get-ThemeColor -Value ([string](Get-StudioThemeValue -Theme $theme -Name 'mutedTextColor' -Fallback '#59636f')) -FallbackRed 89 -FallbackGreen 99 -FallbackBlue 111 -FallbackAlpha 100
$initialTextMode = [string](Get-StudioThemeValue -Theme $theme -Name 'textColorMode' -Fallback 'auto')
if ($initialTextMode -notin @('auto', 'dark', 'light', 'custom')) { $initialTextMode = 'auto' }
$initialComponentStyle = [string](Get-StudioThemeValue -Theme $theme -Name 'componentStyle' -Fallback 'soft')
if ($initialComponentStyle -notin @('soft', 'outline', 'solid')) { $initialComponentStyle = 'soft' }
$initialThemePreset = [string](Get-StudioThemeValue -Theme $theme -Name 'themePreset' -Fallback 'warm-glass')
if ($initialThemePreset -notin @('warm-glass', 'midnight-neon', 'sakura-dream', 'ocean-breeze', 'custom')) { $initialThemePreset = 'warm-glass' }
$form = New-Object System.Windows.Forms.Form
$form.Text = '豆包梦幻皮肤设置'
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.ClientSize = New-Object System.Drawing.Size(610, 880)
$form.BackColor = [System.Drawing.Color]::FromArgb(250, 246, 243)
$form.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)

$title = New-Object System.Windows.Forms.Label
$title.Text = '豆包梦幻皮肤'
$title.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 16, [System.Drawing.FontStyle]::Bold)
$title.SetBounds(22, 16, 260, 34)
$form.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = '选择完整主题、背景和组件效果；运行中的皮肤会自动更新。'
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
$statusLabel.SetBounds(24, 795, 562, 24)
$statusLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
$form.Controls.Add($statusLabel)

$tabs = New-Object System.Windows.Forms.TabControl
$tabs.SetBounds(24, 310, 562, 480)
$form.Controls.Add($tabs)

$commonTab = New-Object System.Windows.Forms.TabPage
$commonTab.Text = '背景与效果'
$commonTab.BackColor = [System.Drawing.Color]::FromArgb(250, 246, 243)
$tabs.TabPages.Add($commonTab)

$colorsTab = New-Object System.Windows.Forms.TabPage
$colorsTab.Text = '颜色与透明度'
$colorsTab.BackColor = [System.Drawing.Color]::FromArgb(250, 246, 243)
$tabs.TabPages.Add($colorsTab)

$textTab = New-Object System.Windows.Forms.TabPage
$textTab.Text = '文字与对比度'
$textTab.BackColor = [System.Drawing.Color]::FromArgb(250, 246, 243)
$tabs.TabPages.Add($textTab)

$themeTab = New-Object System.Windows.Forms.TabPage
$themeTab.Text = '组件主题'
$themeTab.BackColor = [System.Drawing.Color]::FromArgb(250, 246, 243)
$tabs.TabPages.Add($themeTab)

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

$textModeLabel = New-Object System.Windows.Forms.Label
$textModeLabel.Text = '文字模式'
$textModeLabel.SetBounds(12, 22, 88, 24)
$textTab.Controls.Add($textModeLabel)

$textModeBox = New-Object System.Windows.Forms.ComboBox
$textModeBox.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
$null = $textModeBox.Items.Add('智能适配（推荐）')
$null = $textModeBox.Items.Add('固定深色文字')
$null = $textModeBox.Items.Add('固定浅色文字')
$null = $textModeBox.Items.Add('自定义颜色')
$textModeBox.SetBounds(100, 18, 220, 30)
$textModeBox.SelectedIndex = [Array]::IndexOf([string[]]@('auto', 'dark', 'light', 'custom'), $initialTextMode)
$textTab.Controls.Add($textModeBox)

$textColorButton = Add-SolidColorRow -Parent $textTab -Label '主要文字' -Top 72 -Initial $textInitial -Description '标题、正文与常用按钮'
$mutedTextColorButton = Add-SolidColorRow -Parent $textTab -Label '次要文字' -Top 124 -Initial $mutedTextInitial -Description '提示、时间与占位文字'

$textHint = New-Object System.Windows.Forms.Label
$textHint.Text = '智能模式会分别分析侧栏、主区域和输入框的实际亮度，并选择对比度更高的文字。'
$textHint.ForeColor = [System.Drawing.Color]::FromArgb(118, 105, 99)
$textHint.SetBounds(12, 184, 520, 48)
$textTab.Controls.Add($textHint)

$updateTextControls = {
    $custom = $textModeBox.SelectedIndex -eq 3
    $textColorButton.Enabled = $custom
    $mutedTextColorButton.Enabled = $custom
}
$textModeBox.Add_SelectedIndexChanged({ & $updateTextControls })
& $updateTextControls

$presetLabel = New-Object System.Windows.Forms.Label
$presetLabel.Text = '主题预设'
$presetLabel.SetBounds(12, 20, 88, 24)
$themeTab.Controls.Add($presetLabel)

$themePresetBox = New-Object System.Windows.Forms.ComboBox
$themePresetBox.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
$null = $themePresetBox.Items.Add('暖霞玻璃')
$null = $themePresetBox.Items.Add('午夜霓虹')
$null = $themePresetBox.Items.Add('樱花梦境')
$null = $themePresetBox.Items.Add('海盐微风')
$themePresetBox.SetBounds(100, 16, 220, 30)
$presetIds = [string[]]@('warm-glass', 'midnight-neon', 'sakura-dream', 'ocean-breeze')
$presetIndex = [Array]::IndexOf($presetIds, $initialThemePreset)
if ($presetIndex -lt 0) { $presetIndex = 0 }
$themePresetBox.SelectedIndex = $presetIndex
$themeTab.Controls.Add($themePresetBox)

$applyPresetButton = New-Object System.Windows.Forms.Button
$applyPresetButton.Text = '载入整套预设'
$applyPresetButton.SetBounds(336, 15, 150, 32)
$themeTab.Controls.Add($applyPresetButton)

$componentStyleLabel = New-Object System.Windows.Forms.Label
$componentStyleLabel.Text = '组件风格'
$componentStyleLabel.SetBounds(12, 62, 88, 24)
$themeTab.Controls.Add($componentStyleLabel)

$componentStyleBox = New-Object System.Windows.Forms.ComboBox
$componentStyleBox.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
$null = $componentStyleBox.Items.Add('柔和玻璃')
$null = $componentStyleBox.Items.Add('清晰描边')
$null = $componentStyleBox.Items.Add('沉浸实体')
$componentStyleBox.SetBounds(100, 58, 220, 30)
$componentStyleBox.SelectedIndex = [Array]::IndexOf([string[]]@('soft', 'outline', 'solid'), $initialComponentStyle)
$themeTab.Controls.Add($componentStyleBox)

$accentColorButton = Add-SolidColorRow -Parent $themeTab -Label '主题强调色' -Top 100 -Initial $accentInitial -Description '导航、按钮、链接和焦点'
$accentTextColorButton = Add-SolidColorRow -Parent $themeTab -Label '强调文字' -Top 140 -Initial $accentTextInitial -Description '主题按钮和用户气泡文字'
$cardRow = Add-ColorOpacityRow -Parent $themeTab -Label '功能卡片' -Top 182 -Initial $cardInitial -MinimumAlpha 20
$userBubbleRow = Add-ColorOpacityRow -Parent $themeTab -Label '用户气泡' -Top 238 -Initial $userBubbleInitial -MinimumAlpha 25
$assistantBubbleRow = Add-ColorOpacityRow -Parent $themeTab -Label '豆包气泡' -Top 294 -Initial $assistantBubbleInitial -MinimumAlpha 20
$cornerRadiusTrack = Add-TrackRow -Parent $themeTab -Label '组件圆角' -Top 354 -Minimum 6 -Maximum 32 -Value ([int](Get-StudioThemeValue -Theme $theme -Name 'cornerRadius' -Fallback 18)) -Suffix ' px'
$shadowStrengthTrack = Add-TrackRow -Parent $themeTab -Label '立体阴影' -Top 398 -Minimum 0 -Maximum 50 -Value ([int](Get-StudioThemeValue -Theme $theme -Name 'shadowStrength' -Fallback 18)) -Suffix '%'

$applyThemePreset = {
    $presetId = $presetIds[$themePresetBox.SelectedIndex]
    $preset = switch ($presetId) {
        'midnight-neon' { [pscustomobject]@{ Style = 'solid'; Sidebar = 'rgba(17, 24, 39, 0.74)'; Surface = 'rgba(15, 23, 42, 0.52)'; Composer = 'rgba(17, 24, 39, 0.90)'; Accent = '#22d3ee'; AccentText = '#06242b'; Card = 'rgba(23, 32, 51, 0.82)'; User = 'rgba(21, 94, 117, 0.94)'; Assistant = 'rgba(30, 41, 59, 0.86)'; Radius = 20; Shadow = 34 } }
        'sakura-dream' { [pscustomobject]@{ Style = 'soft'; Sidebar = 'rgba(255, 240, 246, 0.58)'; Surface = 'rgba(255, 247, 251, 0.42)'; Composer = 'rgba(255, 249, 252, 0.88)'; Accent = '#e85d8e'; AccentText = '#ffffff'; Card = 'rgba(255, 240, 247, 0.72)'; User = 'rgba(232, 93, 142, 0.88)'; Assistant = 'rgba(255, 247, 251, 0.78)'; Radius = 22; Shadow = 20 } }
        'ocean-breeze' { [pscustomobject]@{ Style = 'outline'; Sidebar = 'rgba(232, 247, 247, 0.60)'; Surface = 'rgba(243, 251, 251, 0.38)'; Composer = 'rgba(247, 253, 253, 0.88)'; Accent = '#147d92'; AccentText = '#ffffff'; Card = 'rgba(238, 250, 250, 0.72)'; User = 'rgba(20, 125, 146, 0.86)'; Assistant = 'rgba(247, 253, 253, 0.78)'; Radius = 16; Shadow = 10 } }
        default { [pscustomobject]@{ Style = 'soft'; Sidebar = 'rgba(255, 241, 232, 0.48)'; Surface = 'rgba(255, 250, 246, 0.35)'; Composer = 'rgba(255, 252, 249, 0.82)'; Accent = '#b85f4b'; AccentText = '#fffaf8'; Card = 'rgba(255, 250, 246, 0.62)'; User = 'rgba(184, 95, 75, 0.88)'; Assistant = 'rgba(255, 255, 255, 0.62)'; Radius = 18; Shadow = 18 } }
    }
    $componentStyleBox.SelectedIndex = [Array]::IndexOf([string[]]@('soft', 'outline', 'solid'), $preset.Style)
    Set-StudioColorOpacityRow -Row $sidebarRow -Value $preset.Sidebar -FallbackRed 255 -FallbackGreen 241 -FallbackBlue 232 -FallbackAlpha 48
    Set-StudioColorOpacityRow -Row $surfaceRow -Value $preset.Surface -FallbackRed 255 -FallbackGreen 250 -FallbackBlue 246 -FallbackAlpha 35
    Set-StudioColorOpacityRow -Row $composerRow -Value $preset.Composer -FallbackRed 255 -FallbackGreen 252 -FallbackBlue 249 -FallbackAlpha 82
    Set-StudioSolidColor -Button $accentColorButton -Value $preset.Accent -FallbackRed 184 -FallbackGreen 95 -FallbackBlue 75
    Set-StudioSolidColor -Button $accentTextColorButton -Value $preset.AccentText -FallbackRed 255 -FallbackGreen 250 -FallbackBlue 248
    Set-StudioColorOpacityRow -Row $cardRow -Value $preset.Card -FallbackRed 255 -FallbackGreen 250 -FallbackBlue 246 -FallbackAlpha 62
    Set-StudioColorOpacityRow -Row $userBubbleRow -Value $preset.User -FallbackRed 184 -FallbackGreen 95 -FallbackBlue 75 -FallbackAlpha 88
    Set-StudioColorOpacityRow -Row $assistantBubbleRow -Value $preset.Assistant -FallbackRed 255 -FallbackGreen 255 -FallbackBlue 255 -FallbackAlpha 62
    $cornerRadiusTrack.Value = $preset.Radius
    $shadowStrengthTrack.Value = $preset.Shadow
    $textModeBox.SelectedIndex = 0
    $statusLabel.Text = "已载入整套主题预设，点击保存并应用"
}
$applyPresetButton.Add_Click({ & $applyThemePreset })

$saveButton = New-Object System.Windows.Forms.Button
$saveButton.Text = '保存并应用'
$saveButton.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9, [System.Drawing.FontStyle]::Bold)
$saveButton.BackColor = [System.Drawing.Color]::FromArgb(184, 95, 75)
$saveButton.ForeColor = [System.Drawing.Color]::White
$saveButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$saveButton.SetBounds(24, 825, 160, 42)
$form.Controls.Add($saveButton)

$startButton = New-Object System.Windows.Forms.Button
$startButton.Text = '启动皮肤'
$startButton.SetBounds(198, 825, 126, 42)
$form.Controls.Add($startButton)

$restoreButton = New-Object System.Windows.Forms.Button
$restoreButton.Text = '恢复官方外观'
$restoreButton.SetBounds(338, 825, 126, 42)
$form.Controls.Add($restoreButton)

$closeButton = New-Object System.Windows.Forms.Button
$closeButton.Text = '关闭'
$closeButton.SetBounds(478, 825, 108, 42)
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
        $current | Add-Member -NotePropertyName themePreset -NotePropertyValue $presetIds[$themePresetBox.SelectedIndex] -Force
        $componentStyles = [string[]]@('soft', 'outline', 'solid')
        $current | Add-Member -NotePropertyName componentStyle -NotePropertyValue $componentStyles[$componentStyleBox.SelectedIndex] -Force
        $current | Add-Member -NotePropertyName accentColor -NotePropertyValue (Format-StudioHex -Color ([System.Drawing.Color]$accentColorButton.Tag)) -Force
        $current | Add-Member -NotePropertyName accentTextColor -NotePropertyValue (Format-StudioHex -Color ([System.Drawing.Color]$accentTextColorButton.Tag)) -Force
        $current | Add-Member -NotePropertyName cardColor -NotePropertyValue (Format-StudioRgba -Color ([System.Drawing.Color]$cardRow.ColorButton.Tag) -AlphaPercent $cardRow.AlphaTrack.Value) -Force
        $current | Add-Member -NotePropertyName userBubbleColor -NotePropertyValue (Format-StudioRgba -Color ([System.Drawing.Color]$userBubbleRow.ColorButton.Tag) -AlphaPercent $userBubbleRow.AlphaTrack.Value) -Force
        $current | Add-Member -NotePropertyName assistantBubbleColor -NotePropertyValue (Format-StudioRgba -Color ([System.Drawing.Color]$assistantBubbleRow.ColorButton.Tag) -AlphaPercent $assistantBubbleRow.AlphaTrack.Value) -Force
        $current | Add-Member -NotePropertyName cornerRadius -NotePropertyValue $cornerRadiusTrack.Value -Force
        $current | Add-Member -NotePropertyName shadowStrength -NotePropertyValue $shadowStrengthTrack.Value -Force
        $textModes = [string[]]@('auto', 'dark', 'light', 'custom')
        $current | Add-Member -NotePropertyName textColorMode -NotePropertyValue $textModes[$textModeBox.SelectedIndex] -Force
        $current | Add-Member -NotePropertyName textColor -NotePropertyValue (Format-StudioHex -Color ([System.Drawing.Color]$textColorButton.Tag)) -Force
        $current | Add-Member -NotePropertyName mutedTextColor -NotePropertyValue (Format-StudioHex -Color ([System.Drawing.Color]$mutedTextColorButton.Tag)) -Force
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
    if ((Format-StudioHex -Color $parsedTestColor.Color) -ne '#0C2238') {
        throw 'Theme Studio hexadecimal color formatting self-test failed.'
    }
    if ($null -eq $saturationTrack -or $null -eq $sidebarRow -or $null -eq $surfaceRow -or $null -eq $composerRow -or $null -eq $textModeBox -or $null -eq $textColorButton -or $null -eq $mutedTextColorButton -or $null -eq $themePresetBox -or $null -eq $componentStyleBox -or $null -eq $accentColorButton -or $null -eq $cardRow -or $null -eq $userBubbleRow -or $null -eq $assistantBubbleRow -or $null -eq $cornerRadiusTrack -or $null -eq $shadowStrengthTrack) {
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
