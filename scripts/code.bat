@echo off
setlocal

title VSCode Dev

pushd %~dp0\..

:: Get electron, compile, built-in extensions
if "%VSCODE_SKIP_PRELAUNCH%"=="" (
	node build/lib/preLaunch.ts
)

set "NAMESHORT="
for /f "tokens=2 delims=:," %%a in ('findstr /R /C:"\"nameShort\":.*" product.json') do if not defined NAMESHORT set "NAMESHORT=%%~a"
set NAMESHORT=%NAMESHORT: "=%
set NAMESHORT=%NAMESHORT:"=%.exe
set CODE=".build\electron\%NAMESHORT%"

:: Manage built-in extensions
if "%~1"=="--builtin" goto builtin

:: Configuration
set NODE_ENV=development
set VSCODE_DEV=1
set VSCODE_CLI=1
set ELECTRON_ENABLE_LOGGING=1
set ELECTRON_ENABLE_STACK_DUMPING=1

set DISABLE_TEST_EXTENSION="--disable-extension=vscode.vscode-api-tests"
for %%A in (%*) do (
	if "%%~A"=="--extensionTestsPath" (
		set DISABLE_TEST_EXTENSION=""
	)
)

:: Transient: use random user data and extensions dir
set TRANSIENT_ARGS=
set REMAINING_ARGS=
setlocal enabledelayedexpansion
for %%A in (%*) do (
	if "%%~A"=="--transient" (
		for /f "usebackq delims=" %%B in (`node -e "const p=require('path'),os=require('os'),c=require('crypto');console.log(p.join(os.tmpdir(),'vscode-'+c.randomBytes(4).toString('hex')))"`) do set "TRANSIENT_DIR=%%B"
		set "TRANSIENT_ARGS=--user-data-dir ^"!TRANSIENT_DIR!\data^" --extensions-dir ^"!TRANSIENT_DIR!\extensions^""
		echo State is temporarily stored. Relaunch this state with: scripts\code.bat --user-data-dir "!TRANSIENT_DIR!\data" --extensions-dir "!TRANSIENT_DIR!\extensions"
	) else (
		if defined REMAINING_ARGS (
			set "REMAINING_ARGS=!REMAINING_ARGS! %%A"
		) else (
			set "REMAINING_ARGS=%%A"
		)
	)
)

:: Launch Code
%CODE% . %DISABLE_TEST_EXTENSION% %TRANSIENT_ARGS% %REMAINING_ARGS%
endlocal
goto end

:builtin
%CODE% build/builtin

:end

popd

endlocal
