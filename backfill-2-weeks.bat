@echo off
echo Backfilling articles for the last 14 days
echo ==========================================
echo.

cd /d "C:\Users\Josh\OneDrive\Desktop\GitHub\TTracker"
node scripts/daily-tracker-supabase.js --days=14

echo.
echo Backfill complete!
pause