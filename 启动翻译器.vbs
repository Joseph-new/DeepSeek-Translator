' DeepSeek Translator - silent launcher (no console window)
Option Explicit
Dim fso, sh, base, exe
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")
base = fso.GetParentFolderName(WScript.ScriptFullName)
exe  = base & "\node_modules\electron\dist\electron.exe"

If Not fso.FileExists(exe) Then
  MsgBox "Electron runtime not found." & vbCrLf & vbCrLf & _
         "Please run start.bat once to install dependencies.", _
         48, "DeepSeek Translator"
  WScript.Quit 1
End If

' Remove an inherited ELECTRON_RUN_AS_NODE before launching.
'
' If that variable is present - even as an empty string - electron.exe
' degrades into plain Node: require('electron') returns a path string, app is
' undefined, and the app dies with a misleading "Cannot read properties of
' undefined (reading 'on')" error.
'
' It MUST be actually removed. Assigning an empty string does NOT work,
' because Electron tests whether the variable EXISTS, not what it holds.
' Measured on this machine:
'   ELECTRON_RUN_AS_NODE=1    -> app=undefined   (broken)
'   ELECTRON_RUN_AS_NODE=""   -> app=undefined   (still broken)
'   variable removed          -> app=object      (works)
On Error Resume Next
sh.Environment("PROCESS").Remove("ELECTRON_RUN_AS_NODE")
On Error GoTo 0

sh.CurrentDirectory = base
sh.Run """" & exe & """ """ & base & """", 0, False
