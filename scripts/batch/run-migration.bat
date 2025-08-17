@echo off
echo ==================================
echo MIGRATING DATA TO SUPABASE
echo ==================================
echo.
echo This will migrate all your political entries and executive orders
echo from JSON files to your Supabase database.
echo.
echo Press Ctrl+C to cancel, or any other key to continue...
pause >nul
echo.

set SUPABASE_URL=https://osjbulmltfpcoldydexg.supabase.co
set SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zamJ1bG1sdGZwY29sZHlkZXhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ3NjQ5NzEsImV4cCI6MjA3MDM0MDk3MX0.COtWEcun0Xkw5hUhaVEJGCrWbumj42L4vwWGgH7RyIE

node database-migration/migrate-to-supabase.js

echo.
echo Press any key to exit...
pause >nul