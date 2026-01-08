@echo off
echo Running normal daily tracker (3 day window)
echo ===========================================
echo.

cd /d "C:\Users\Josh\OneDrive\Desktop\GitHub\TTracker"
node scripts/daily-tracker-supabase.js

echo.
echo Daily tracking complete!
pause