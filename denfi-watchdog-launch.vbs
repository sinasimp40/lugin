' Launch the watchdog installer or scheduled task without a console window.
' Keep this file beside denfi-watchdog.ps1.
Option Explicit

Dim fso, folder, script, command, argument, shell, result, isWatch
Set fso = CreateObject("Scripting.FileSystemObject")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
script = fso.BuildPath(folder, "denfi-watchdog.ps1")

If Not fso.FileExists(script) Then
  If WScript.Arguments.Count = 0 Then
    MsgBox "Keep denfi-watchdog.ps1 beside denfi-watchdog-launch.vbs and try again.", vbCritical, "Denfi Watchdog"
  End If
  WScript.Quit 2
End If

Set shell = CreateObject("WScript.Shell")
command = Quote(shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe") & _
  " -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Quote(script)
isWatch = False
For Each argument In WScript.Arguments
  If LCase(CStr(argument)) = "-watch" Then isWatch = True
  command = command & " " & Quote(argument)
Next

' Wait for the child: Task Scheduler must continue tracking the watchdog,
' rather than treating the launcher as a completed task.
On Error Resume Next
result = shell.Run(command, 0, True)
If Err.Number <> 0 Then result = 1
On Error GoTo 0
If result <> 0 And Not isWatch Then
  MsgBox "Watchdog setup failed. Check watchdog-install.log in the app's data folder.", vbCritical, "Denfi Watchdog"
End If
WScript.Quit result

Function Quote(value)
  Quote = Chr(34) & Replace(CStr(value), Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function