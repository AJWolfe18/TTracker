@echo off
echo ========================================
echo TESTING EO SPICY TRANSLATIONS
echo ========================================
echo.

cd /d C:\Users\Josh\OneDrive\Desktop\GitHub\TTracker

echo Step 1: Testing database connection and environment
echo ---------------------------------------------------
node scripts\test-eo-backfill.js
if %errorlevel% neq 0 (
    echo ERROR: Database connection test failed!
    pause
    exit /b 1
)
echo.

echo Step 2: Test with 1 executive order
echo ---------------------------------------------------
node scripts\backfill-executive-spicy-simple.js --limit 1
if %errorlevel% neq 0 (
    echo ERROR: Backfill test failed!
    pause
    exit /b 1
)
echo.

echo ========================================
echo TEST COMPLETE - Check output above
echo If successful, run full backfill with:
echo node scripts\backfill-executive-spicy-simple.js --limit 500 --yes
echo ========================================
pause
