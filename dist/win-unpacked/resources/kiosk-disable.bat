@echo off
echo ============================================
echo   PISONET KIOSK MODE DISABLE
echo ============================================
echo.
echo This removes kiosk restrictions for the
echo CURRENT Windows user account.
echo.

echo [1/7] Re-enabling Task Manager...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableTaskMgr /f 2>nul
reg delete "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableTaskMgr /f 2>nul

echo [2/7] Re-enabling Windows key...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v NoWinKeys /f 2>nul

echo [3/7] Re-enabling Lock Workstation...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableLockWorkstation /f 2>nul

echo [4/7] Re-enabling Change Password...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableChangePassword /f 2>nul

echo [5/7] Restoring taskbar notification area...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v NoTrayItemsDisplay /f 2>nul

echo [6/7] Restoring Ctrl+Alt+Del security screen...
reg delete "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v DisableCAD /f 2>nul

echo [7/7] Restoring Task Manager Group Policy...
reg delete "HKLM\SOFTWARE\Policies\Microsoft\Windows\System" /v DisableTaskMgr /f 2>nul

echo.
echo ============================================
echo   KIOSK MODE DISABLED
echo   Reboot for full effect.
echo ============================================
echo.
pause
