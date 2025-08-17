@echo off
echo ==================================
echo TESTING DAILY TRACKER WITH SUPABASE
echo ==================================
echo.
echo This will add TEST entries to your Supabase database
echo Press Ctrl+C to cancel, or any key to continue...
pause >nul
echo.

set OPENAI_API_KEY=%OPENAI_API_KEY%

node daily-tracker-supabase.js

echo.
echo Check your Supabase dashboard to see the new entries!
echo.
echo Press any key to exit...
pause >nul