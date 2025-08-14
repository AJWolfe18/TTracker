@echo off
echo ================================================
echo Running Fixed Executive Orders Tracker
echo ================================================
echo.
echo This will:
echo 1. Show current database state
echo 2. Fetch ONLY real Executive Orders
echo 3. Skip any non-EO documents
echo 4. Add any missing EOs to database
echo.
pause

echo.
echo Starting tracker...
echo.
node executive-orders-tracker-supabase.js

echo.
echo ================================================
echo.
echo Tracker complete! Check the output above.
echo.
echo Expected results:
echo - Should show ~190 total EOs in database
echo - Should skip any memorandums/proclamations
echo - All records should have order numbers
echo.
echo You can verify at http://trumpytracker.com
echo.
pause
