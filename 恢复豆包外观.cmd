@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\restore-skin.ps1" -PromptRestart
if errorlevel 1 (
  echo.
  echo 恢复失败，请把此窗口中的错误信息发给开发者。
  pause
)
