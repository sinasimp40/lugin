@echo off
echo ============================================
echo   PISONET KIOSK MODE SETUP
echo   RUN AS ADMINISTRATOR!
echo ============================================
echo.
echo This applies kiosk restrictions for the
echo CURRENT Windows user account.
echo.
echo NOTE: Must be run as Administrator for full
echo effect (right-click - Run as administrator)
echo.

echo [1/7] Disabling Task Manager...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableTaskMgr /t REG_DWORD /d 1 /f
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableTaskMgr /t REG_DWORD /d 1 /f

echo [2/7] Disabling Windows key...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v NoWinKeys /t REG_DWORD /d 1 /f

echo [3/7] Disabling Lock Workstation (Win+L)...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableLockWorkstation /t REG_DWORD /d 1 /f

echo [4/7] Disabling Change Password from Ctrl+Alt+Del...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableChangePassword /t REG_DWORD /d 1 /f

echo [5/7] Hiding taskbar notification area...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v NoTrayItemsDisplay /t REG_DWORD /d 1 /f

echo [6/7] Suppressing Ctrl+Alt+Del security screen (DisableCAD)...
reg add "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v DisableCAD /t REG_DWORD /d 1 /f

echo [7/7] Blocking Task Manager via Group Policy path...
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\System" /v DisableTaskMgr /t REG_DWORD /d 1 /f

echo.
echo ============================================
echo   KIOSK MODE ENABLED
echo   Reboot for Ctrl+Alt+Del block to take effect.
echo   Run kiosk-disable.bat to undo.
echo ============================================
echo.
pause
