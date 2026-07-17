@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-shortcuts.ps1"
if errorlevel 1 (
  echo.
  echo 快捷方式安装失败，请把此窗口中的错误信息发给开发者。
)
pause
