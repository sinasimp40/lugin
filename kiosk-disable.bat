@echo off
echo ============================================
echo   PISONET KIOSK MODE DISABLE
echo ============================================
echo.
echo This removes kiosk restrictions for the
echo CURRENT Windows user account.
echo.

echo [1/5] Re-enabling Task Manager...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableTaskMgr /f 2>nul

echo [2/5] Re-enabling Windows key...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v NoWinKeys /f 2>nul

echo [3/5] Re-enabling Lock Workstation...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableLockWorkstation /f 2>nul

echo [4/5] Re-enabling Change Password...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableChangePassword /f 2>nul

echo [5/5] Restoring taskbar notification area...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v NoTrayItemsDisplay /f 2>nul

echo.
echo ============================================
echo   KIOSK MODE DISABLED
echo   Log out and log back in for full effect.
echo ============================================
echo.
pause
