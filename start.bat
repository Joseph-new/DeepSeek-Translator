@echo off
setlocal
cd /d "%~dp0"

rem --- Defensive: some dev environments set this globally, which makes
rem     electron.exe degrade into plain Node and the app fails to boot. ---
set ELECTRON_RUN_AS_NODE=

set "ELECTRON_EXE=%~dp0node_modules\electron\dist\electron.exe"

if not exist "%ELECTRON_EXE%" (
  echo.
  echo   Electron runtime not found. Installing dependencies now...
  echo   This is a one-time download of about 100 MB.
  echo.
  call npm install
  if not exist "%ELECTRON_EXE%" (
    echo.
    echo   Install failed. Please make sure Node.js is installed.
    pause
    exit /b 1
  )
)

rem --- IMPORTANT: the app dir must be written as "%~dp0." and NOT as "%~dp0".
rem     %~dp0 ends with a backslash, so the \" inside the quoted form escapes the
rem     closing quote; Electron then looks for a directory whose name ends with a
rem     quote character and reports "Error launching app". ---
start "" "%ELECTRON_EXE%" "%~dp0."
exit /b 0
