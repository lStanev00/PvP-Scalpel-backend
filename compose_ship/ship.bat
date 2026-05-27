@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "LOCAL_FILE=%SCRIPT_DIR%docker-compose.yml"
set "SHIP_ENV_FILE=%SCRIPT_DIR%.env"

if not exist "%SHIP_ENV_FILE%" (
    echo Missing %SHIP_ENV_FILE%.
    echo Create it from the expected keys: SSH_ALIAS, SERVER_PATH, SERVER_OWNER.
    pause
    exit /b 1
)

for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%SHIP_ENV_FILE%") do (
    if not "%%~A"=="" set "%%~A=%%~B"
)

if "%SSH_ALIAS%"=="" (
    echo Missing SSH_ALIAS in %SHIP_ENV_FILE%.
    pause
    exit /b 1
)

if "%SERVER_PATH%"=="" (
    echo Missing SERVER_PATH in %SHIP_ENV_FILE%.
    pause
    exit /b 1
)

if "%SERVER_OWNER%"=="" set "SERVER_OWNER=lych:lych"

if not exist "%LOCAL_FILE%" (
    echo Missing %LOCAL_FILE%.
    pause
    exit /b 1
)

echo Pushing %LOCAL_FILE% to %SSH_ALIAS%:%SERVER_PATH% ...

ssh %SSH_ALIAS% "sudo mkdir -p '%SERVER_PATH%' && sudo chown -R '%SERVER_OWNER%' '%SERVER_PATH%'"

if errorlevel 1 (
    echo Failed to prepare server folder.
    pause
    exit /b 1
)

scp "%LOCAL_FILE%" %SSH_ALIAS%:%SERVER_PATH%/docker-compose.yml

if errorlevel 1 (
    echo Failed to upload docker-compose.yml.
    pause
    exit /b 1
)

echo.
echo Upload completed.
echo Validating docker compose on server...
ssh %SSH_ALIAS% "cd '%SERVER_PATH%' && docker compose config --quiet"

if errorlevel 1 (
    echo Docker compose validation failed.
    pause
    exit /b 1
)

echo Docker compose validation passed.

echo.
pause
exit /b 0
