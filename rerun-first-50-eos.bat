@echo off
echo =============================================
echo RE-RUN FIRST 50 EXECUTIVE ORDERS
echo =============================================
echo.
echo This will re-generate spicy summaries for EOs 1-50
echo.
echo Options:
echo   --dry-run        : Test without making changes
echo   --skip-existing  : Only process orders without summaries
echo   --yes           : Skip confirmation prompt
echo.
echo Running script...
echo.

cd /d "C:\Users\Josh\OneDrive\Desktop\GitHub\TTracker"
node scripts/rerun-first-50-eos.js %*

echo.
echo Script completed!
pause
