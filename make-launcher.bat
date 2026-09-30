@echo off
setlocal
cd /d "%~dp0"

rem ======================================================================
rem  Build the launcher and the copy helper.
rem
rem  Produces, in this folder:
rem    DeepSeek·­ÒëÆ÷.exe         real executable: own icon, no console window
rem    launcher\copy-helper.exe   injects Ctrl+C for the »®´Ê feature
rem
rem  Why a compiled launcher instead of the .vbs:
rem    - A .vbs file always shows the generic Windows Script Host icon.
rem      Its icon cannot be customised - that is a Windows limitation.
rem    - An exe can carry our own icon and name.
rem
rem  Why a compiled copy helper instead of PowerShell:
rem    - PowerShell cold start 300-500ms + Add-Type compiling C# at runtime
rem      600-900ms = 1300-1600ms total, which is longer than the window the
rem      app can reasonably wait for the clipboard. The compiled helper runs
rem      in tens of milliseconds.
rem    - SendKeys does not work from a hidden console-less process at all
rem      (measured 0/6); keybd_event injection does.
rem
rem  Double-click this file once. Re-run it if you change assets\icon.ico,
rem  launcher\Launcher.cs or launcher\CopyHelper.cs.
rem ======================================================================

set "CSC="
for %%p in (
  "%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
  "%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
  "%WINDIR%\Microsoft.NET\Framework64\v3.5\csc.exe"
  "%WINDIR%\Microsoft.NET\Framework\v3.5\csc.exe"
) do if not defined CSC if exist %%p set "CSC=%%~fp"

if not defined CSC (
  echo.
  echo   C# compiler not found.
  echo   It normally ships with Windows under Microsoft.NET\Framework64.
  echo   If .NET Framework 4.x has been removed on this machine, this method
  echo   will not work - keep using Æô¶¯·­ÒëÆ÷.vbs. Note that without the copy
  echo   helper the »®´Ê feature falls back to a slower PowerShell path.
  echo.
  pause
  exit /b 1
)

for %%d in ("%CSC%") do set "FW=%%~dpd"

rem --- A running app holds the exe open, so the compiler cannot overwrite it ---
if exist "DeepSeek·­ÒëÆ÷.exe" (
  del "DeepSeek·­ÒëÆ÷.exe" >nul 2>&1
  if exist "DeepSeek·­ÒëÆ÷.exe" (
    echo.
    echo   Cannot overwrite DeepSeek·­ÒëÆ÷.exe - the file is in use.
    echo   The app is probably still running. Exit it first, then run this again.
    echo.
    pause
    exit /b 1
  )
)

if exist "launcher\copy-helper.exe" del "launcher\copy-helper.exe" >nul 2>&1

echo.
echo   Compiler : %CSC%
echo.

echo   [1/2] DeepSeek·­ÒëÆ÷.exe
"%CSC%" /nologo /target:winexe /codepage:65001 /optimize+ ^
  /win32icon:"assets\icon.ico" ^
  /reference:"%FW%System.Windows.Forms.dll" ^
  /out:"DeepSeek·­ÒëÆ÷.exe" ^
  "launcher\Launcher.cs"
if errorlevel 1 goto :failed

echo   [2/2] launcher\copy-helper.exe
"%CSC%" /nologo /target:winexe /codepage:65001 /optimize+ ^
  /out:"launcher\copy-helper.exe" ^
  "launcher\CopyHelper.cs"
if errorlevel 1 goto :failed

if not exist "DeepSeek·­ÒëÆ÷.exe" goto :failed
if not exist "launcher\copy-helper.exe" goto :failed

echo.
echo   BUILD OK
echo.
echo   Start the app by double-clicking DeepSeek·­ÒëÆ÷.exe
echo   (Æô¶¯·­ÒëÆ÷.vbs still works as a fallback).
echo.
pause
exit /b 0

:failed
echo.
echo   BUILD FAILED - see the compiler output above.
echo.
pause
exit /b 1
