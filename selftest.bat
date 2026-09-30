@echo off
setlocal
cd /d "%~dp0"

rem --- Defensive: some dev environments set this globally, which makes
rem     electron.exe degrade into plain Node and the app fails to boot. ---
set ELECTRON_RUN_AS_NODE=

set "ELECTRON=%~dp0node_modules\electron\dist\electron.exe"
if not exist "%ELECTRON%" (
  echo Electron runtime not found.
  echo Run start.bat once to install dependencies.
  pause
  exit /b 1
)

rem ======================================================================
rem  Step 1 - full self test
rem  Screenshots, a real translation, hotkeys, balance, config, cancel,
rem  truncation warning, close-quits-app, and latency budgets.
rem ======================================================================
echo [1/2] Full self test, this takes about a minute...
echo.
rem --- The app dir must be written as "%~dp0." and NOT as "%~dp0" ---
rem     %~dp0 ends with a backslash, so the \" inside the quoted form escapes
rem     the closing quote and Electron looks for a directory whose name ends
rem     with a quote character. ---
"%ELECTRON%" "%~dp0." --selftest --no-sandbox --in-process-gpu
set "CODE1=%ERRORLEVEL%"

echo.
echo ------------------------------------------------------------
if "%CODE1%"=="0" (
  echo [1/2] Self test: PASS
) else (
  echo [1/2] Self test: FAILURES FOUND - see SELFTEST_FAILURES above
)
echo ------------------------------------------------------------
echo.

rem ======================================================================
rem  Step 2 - selection grab (the text-selection translation feature)
rem
rem  Runs in its own process on purpose. The full self test above cannot
rem  check this reliably: text selection depends on the simulated Ctrl+C
rem  reaching the real OS foreground window, and by the time the full test
rem  has run, Windows will not hand the foreground back. Starting fresh,
rem  the window really is foreground and the check is meaningful.
rem ======================================================================
echo [2/2] Checking text selection grab, 3 rounds...
echo.
"%ELECTRON%" "%~dp0." --probe-selection --rounds=3 --no-sandbox --in-process-gpu
set "CODE2=%ERRORLEVEL%"

echo.
echo ------------------------------------------------------------
if "%CODE2%"=="0" (
  echo [2/2] Selection grab: PASS
) else (
  echo [2/2] Selection grab: FAILED - text selection translation is broken
)
echo ------------------------------------------------------------
echo.
echo Screenshots are in the _selftest subfolder.

if not "%CODE1%"=="0" goto :bad
if not "%CODE2%"=="0" goto :bad

echo Result: ALL PASS
pause
exit /b 0

:bad
echo Result: PROBLEMS FOUND
pause
exit /b 1
