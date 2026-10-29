@echo off
setlocal EnableExtensions DisableDelayedExpansion
title PvP Scalpel Launcher Setup

set "API=https://api.pvpscalpel.com/CDN/download/launcher"
set "MSI=%TEMP%\PvPScalpel-Launcher.msi"
set "LOG=%TEMP%\PvPScalpel-install.log"
set "DOWNLOAD_URL="
set "RESULT=1"

call :init_colors
cls
call :banner

:: Preview the design without downloading or installing anything.
if /i "%~1"=="--preview" goto preview

:: ==========================================
:: STEP 1 - FETCH PRESIGNED URL
:: ==========================================

echo    %C_CYAN%[1/3]%C_RESET% %C_WHITE%CONNECT%C_RESET%   Requesting a secure download link...

for /f "delims=" %%U in ('powershell.exe -NoProfile -Command "$ErrorActionPreference='Stop'; $r=Invoke-RestMethod -Uri '%API%' -Headers @{'600'='BasicPass'}; if ($r -is [string]) { $r } elseif ($r.url) { $r.url } else { throw 'Invalid API response' }"') do (
    set "DOWNLOAD_URL=%%U"
)

if not defined DOWNLOAD_URL goto url_failed

echo          %C_GREEN%[OK]%C_RESET% Secure download link received.
echo.

:: ==========================================
:: STEP 2 - DOWNLOAD INSTALLER
:: ==========================================

echo    %C_CYAN%[2/3]%C_RESET% %C_WHITE%DOWNLOAD%C_RESET%  Downloading PvP Scalpel Launcher...
echo.

if exist "%MSI%" del /q "%MSI%"

curl.exe -fL --retry 2 --progress-bar ^
    "%DOWNLOAD_URL%" ^
    -o "%MSI%"

set "RESULT=%ERRORLEVEL%"

if not "%RESULT%"=="0" goto download_failed
if not exist "%MSI%" goto download_failed

echo.
echo          %C_GREEN%[OK]%C_RESET% Download completed.
echo.

:: ==========================================
:: STEP 3 - INSTALL MSI
:: ==========================================

echo    %C_CYAN%[3/3]%C_RESET% %C_WHITE%INSTALL%C_RESET%   Starting Windows Installer...
echo.
echo    %C_DIM%Installation log: %LOG%%C_RESET%
echo.

:: Interactive mode allows normal UAC prompts.
:: /norestart prevents automatic reboot.
:: /L*v enables verbose installation logging.

msiexec.exe /i "%MSI%" /norestart /L*v "%LOG%"

set "RESULT=%ERRORLEVEL%"

if "%RESULT%"=="0" goto success

goto install_failed

:: ==========================================
:: SUCCESS
:: ==========================================

:success
cls
call :banner

echo.
echo    %C_GREEN%+------------------------------------------------------------------+%C_RESET%
echo    %C_GREEN%^|                      INSTALLATION COMPLETE                       ^|%C_RESET%
echo    %C_GREEN%+------------------------------------------------------------------+%C_RESET%
echo.
echo    %C_WHITE%PvP Scalpel Launcher is installed.%C_RESET%

call :beta_info

set "RESULT=0"
goto finish

:: ==========================================
:: ERROR - PRESIGNED URL
:: ==========================================

:url_failed
set "RESULT=1"
echo.
echo    %C_RED%[ERROR] Could not retrieve the download link.%C_RESET%
echo    %C_GOLD%[INFO]%C_RESET% Check your internet connection and try again.
echo    %C_DIM%API: %API%%C_RESET%
goto finish

:: ==========================================
:: ERROR - DOWNLOAD
:: ==========================================

:download_failed
echo.
echo    %C_RED%[ERROR] Failed to download the installer.%C_RESET%
echo    %C_RED%[ERROR] Curl exit code: %RESULT%%C_RESET%
echo.
echo    %C_GOLD%[INFO]%C_RESET% The download link may have expired. Run setup again.
goto finish

:: ==========================================
:: ERROR - INSTALLATION
:: ==========================================

:install_failed
echo.
echo    %C_RED%+------------------------------------------------------------------+%C_RESET%
echo    %C_RED%^|                     INSTALLATION FAILED                          ^|%C_RESET%
echo    %C_RED%+------------------------------------------------------------------+%C_RESET%
echo.
echo    %C_RED%[ERROR] Windows Installer code: %RESULT%%C_RESET%
echo.

if "%RESULT%"=="1625" (
    echo    %C_RED%[ERROR] Installation forbidden by system policy.%C_RESET%
    echo    %C_GOLD%[INFO]%C_RESET% Windows may require administrator approval.
    echo    %C_GOLD%[INFO]%C_RESET% Check for an existing launcher installation.
)

if "%RESULT%"=="1602" (
    echo    %C_GOLD%[INFO]%C_RESET% Installation cancelled by user.
)

if "%RESULT%"=="1618" (
    echo    %C_GOLD%[INFO]%C_RESET% Another installation is running.
)

echo.
echo    %C_DIM%Installation log: %LOG%%C_RESET%
echo.

if exist "%LOG%" (
    echo    %C_DIM%Last 30 installation log lines:%C_RESET%
    powershell.exe -NoProfile -Command "Get-Content -Path '%LOG%' -Tail 30"
)

goto finish

:: ==========================================
:: TERMINAL COLORS
:: ==========================================

:init_colors
set "C_RESET="
set "C_CYAN="
set "C_GOLD="
set "C_WHITE="
set "C_DIM="
set "C_GREEN="
set "C_RED="
set "ANSI_ENABLED="
if defined NO_COLOR exit /b

:: Enable ANSI on the shared console buffer without changing the registry.
:: Use stderr's handle because FOR /F captures stdout. Fall back to plain text.
for /f "delims=" %%V in ('powershell.exe -NoProfile -Command "try { Add-Type -Namespace PvPScalpel -Name ConsoleMode -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern IntPtr GetStdHandle(int n); [DllImport(\"kernel32.dll\")] public static extern bool GetConsoleMode(IntPtr h, out uint m); [DllImport(\"kernel32.dll\")] public static extern bool SetConsoleMode(IntPtr h, uint m);'; $h=[PvPScalpel.ConsoleMode]::GetStdHandle(-12); $m=[uint32]0; if ([PvPScalpel.ConsoleMode]::GetConsoleMode($h,[ref]$m)) { if ([PvPScalpel.ConsoleMode]::SetConsoleMode($h,($m -bor 4))) { 'ANSI_ENABLED=1'; 'ESC='+[char]27 } } } catch {}"') do set "%%V"
if not defined ANSI_ENABLED exit /b

set "C_RESET=%ESC%[0m"
set "C_CYAN=%ESC%[96m"
set "C_GOLD=%ESC%[93m"
set "C_WHITE=%ESC%[97m"
set "C_DIM=%ESC%[90m"
set "C_GREEN=%ESC%[92m"
set "C_RED=%ESC%[91m"
exit /b

:: ==========================================
:: BRAND / SCALPEL DRAWING
:: Keep artwork ASCII-only for Windows console code-page compatibility.
:: ==========================================

:banner
echo.
echo    %C_DIM%+------------------------------------------------------------------+%C_RESET%
echo.
echo                           %C_CYAN%____        ____%C_RESET%
echo                          %C_CYAN%^|  _ \__   _^|  _ \%C_RESET%
echo                          %C_CYAN%^| ^|_) \ \ / /^| ^|_) ^|%C_RESET%
echo                          %C_CYAN%^|  __/ \ V / ^|  __/%C_RESET%
echo                          %C_CYAN%^|_^|     \_/  ^|_^|%C_RESET%
echo.
echo         %C_WHITE% ____    ____      _      _       ____    _____   _%C_RESET%
echo         %C_WHITE%/ ___^|  / ___^|    / \    ^| ^|     ^|  _ \  ^| ____^| ^| ^|%C_RESET%
echo         %C_WHITE%\___ \ ^| ^|       / _ \   ^| ^|     ^| ^|_) ^| ^|  _^|   ^| ^|%C_RESET%
echo         %C_WHITE% ___) ^|^| ^|___   / ___ \  ^| ^|___  ^|  __/  ^| ^|___  ^| ^|___%C_RESET%
echo         %C_WHITE%^|____/  \____^| /_/   \_\ ^|_____^| ^|_^|     ^|_____^| ^|_____^|%C_RESET%
echo.
echo                                   %C_GOLD%________________________%C_RESET%
echo          %C_DIM%[:::::^|:::::^|:::::]%C_GOLD%======/_______________________/%C_RESET%
echo.
echo                       %C_CYAN%P v P   S C A L P E L%C_RESET%
echo                  %C_DIM%LAUNCHER SETUP  /  CLOSED BETA%C_RESET%
echo.
echo    %C_DIM%+------------------------------------------------------------------+%C_RESET%
echo.
exit /b

:beta_info
echo.
echo    %C_GOLD%+------------------------------------------------------------------+%C_RESET%
echo    %C_GOLD%^|                       BETA ACCESS REQUIRED                       ^|%C_RESET%
echo    %C_GOLD%+------------------------------------------------------------------+%C_RESET%
echo.
echo    PvP Scalpel is currently in %C_GOLD%CLOSED BETA%C_RESET%.
echo    A %C_WHITE%BETA TESTER account%C_RESET% is required to use the application.
echo.
echo    %C_CYAN%01%C_RESET%  Visit %C_WHITE%https://www.pvpscalpel.com%C_RESET%
echo    %C_CYAN%02%C_RESET%  Click %C_WHITE%"Join Discord"%C_RESET% to join the community.
echo    %C_CYAN%03%C_RESET%  Contact the %C_WHITE%Guild Master / GM%C_RESET% for a beta tester account.
echo.
echo    %C_DIM%--------------------------------------------------------------------%C_RESET%
echo    %C_CYAN%Thank you for supporting PvP Scalpel. See you in the arena!%C_RESET%
echo.
exit /b

:preview
echo    %C_GOLD%DESIGN PREVIEW%C_RESET% - no installation was started.
echo.
echo    %C_CYAN%[1/3]%C_RESET% %C_WHITE%CONNECT%C_RESET%   Requesting a secure download link...
echo    %C_CYAN%[2/3]%C_RESET% %C_WHITE%DOWNLOAD%C_RESET%  Downloading PvP Scalpel Launcher...
echo    %C_CYAN%[3/3]%C_RESET% %C_WHITE%INSTALL%C_RESET%   Starting Windows Installer...
call :beta_info
exit /b 0

:: ==========================================
:: END
:: ==========================================

:finish
echo.
echo    %C_DIM%Press any key to close setup.%C_RESET%
pause >nul
exit /b %RESULT%
