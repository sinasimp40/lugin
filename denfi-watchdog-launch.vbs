' Launch the watchdog installer or scheduled task without a console window.
' Keep this file beside denfi-watchdog.ps1.
Option Explicit

Dim fso, folder, script, command, argument, shell
Set fso = CreateObject("Scripting.FileSystemObject")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
script = fso.BuildPath(folder, "denfi-watchdog.ps1")

If Not fso.FileExists(script) Then
  WScript.Quit 2
End If

command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Quote(script)
For Each argument In WScript.Arguments
  command = command & " " & Quote(argument)
Next

Set shell = CreateObject("WScript.Shell")
' Wait for the child: Task Scheduler must continue tracking the watchdog,
' rather than treating the launcher as a completed task.
WScript.Quit shell.Run(command, 0, True)

Function Quote(value)
  Quote = Chr(34) & Replace(CStr(value), Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function