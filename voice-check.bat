@echo off
setlocal
cd /d "%~dp0"
echo Denfi offline Heart voice check. This does not change member balances or kiosk settings.
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0denfi-auto-shutdown.exe" "%~dp0resources\app\src\voice-smoke-test.cjs" "%TEMP%\denfi-voice-check"
if errorlevel 1 (
  echo Voice check failed. Review the message above.
) else (
  echo Voice check passed. Open the WAV files to check this PC's actual speakers.
  start "" "%TEMP%\denfi-voice-check"
)
pause
endlocal