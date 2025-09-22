@echo off
echo.
echo ============================================
echo     RSS Pipeline Status Check
echo ============================================
echo.

REM Set environment to TEST
set NODE_ENV=test

REM Change to project directory  
cd /d "C:\Users\Josh\OneDrive\Desktop\GitHub\TTracker"

REM Check if node_modules exists
if not exist node_modules (
    echo Installing dependencies...
    call npm install
)

echo.
echo Checking RSS pipeline status...
echo.

REM Run the status check
node scripts\check-rss-pipeline-status.js

echo.
echo ============================================
echo.
echo To run more checks:
echo 1. Open Supabase dashboard
echo 2. Go to SQL Editor
echo 3. Run: SELECT COUNT(*) FROM articles;
echo.
pause
