@echo off
echo ========================================
echo TESTING EO SPICY TRANSLATIONS
echo ========================================
echo.

cd /d C:\Users\Josh\OneDrive\Desktop\GitHub\TTracker

echo Step 1: Testing with 1 executive order
echo ---------------------------------------
node scripts\backfill-executive-spicy-fixed.js --limit 1

if %errorlevel% neq 0 (
    echo.
    echo ERROR: Test failed! Check error messages above.
    pause
    exit /b 1
)

echo.
echo ========================================
echo TEST SUCCESSFUL!
echo ========================================
echo.
echo To run full backfill (approx 200 orders, ~$0.15):
echo node scripts\backfill-executive-spicy-fixed.js --limit 500 --yes
echo.
pause
