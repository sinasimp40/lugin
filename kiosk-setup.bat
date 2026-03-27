@echo off
echo ============================================
echo   PISONET KIOSK MODE SETUP
echo ============================================
echo.
echo This applies kiosk restrictions for the
echo CURRENT Windows user account.
echo.

echo [1/5] Disabling Task Manager...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableTaskMgr /t REG_DWORD /d 1 /f

echo [2/5] Disabling Windows key...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v NoWinKeys /t REG_DWORD /d 1 /f

echo [3/5] Disabling Lock Workstation (Win+L)...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableLockWorkstation /t REG_DWORD /d 1 /f

echo [4/5] Disabling Change Password from Ctrl+Alt+Del...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableChangePassword /t REG_DWORD /d 1 /f

echo [5/5] Hiding taskbar notification area...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v NoTrayItemsDisplay /t REG_DWORD /d 1 /f

echo.
echo ============================================
echo   KIOSK MODE ENABLED
echo   Log out and log back in for full effect.
echo   Run kiosk-disable.bat to undo.
echo ============================================
echo.
pause
