@echo off
REM test-executive-orders-local.bat
REM Run this to test the executive orders tracker locally

echo ========================================
echo Testing Executive Orders Tracker Locally
echo ========================================
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo Node.js version:
node --version
echo.

REM Check if npm packages are installed
if not exist "node_modules" (
    echo Installing required packages...
    npm install
    echo.
)

REM Set up environment variables for testing
echo Setting up test environment...
set OPENAI_API_KEY=your_openai_key_here

REM Ask user if they want to use production database or test mode
echo.
echo Choose an option:
echo 1. Test with DRY RUN (no database writes, just show what would happen)
echo 2. Run FULL TEST (will write to your Supabase database)
echo.
set /p choice="Enter 1 or 2: "

if "%choice%"=="1" (
    echo.
    echo Running in DRY RUN mode...
    echo.
    set DRY_RUN=true
    node test-eo-tracker-dry-run.js
) else if "%choice%"=="2" (
    echo.
    echo Running FULL TEST (will write to database)...
    echo.
    node executive-orders-tracker-supabase.js
) else (
    echo Invalid choice. Exiting.
)

echo.
echo ========================================
echo Test complete. Check the output above for any errors.
echo ========================================
pause