@echo off
echo Cleaning up temporary and duplicate files...

:: Remove duplicate commit scripts
if exist commit-changes.sh del commit-changes.sh
if exist commit-changes.bat del commit-changes.bat
if exist start-server.bat del start-server.bat
if exist organize-files.bat del organize-files.bat

:: Remove one-off utility scripts (keep daily-tracker.js and manual-article-processor.js)
if exist cleanup-duplicates.js del cleanup-duplicates.js
if exist finalize-code-update.js del finalize-code-update.js
if exist move-daily-files.js del move-daily-files.js
if exist move_files.py del move_files.py
if exist smart-audit-dates.js del smart-audit-dates.js
if exist update-tracker.js del update-tracker.js

:: Remove backup files (keep master-tracker-log.json)
if exist master-tracker-log.backup.json del master-tracker-log.backup.json

echo ✅ Cleanup complete!
echo.
echo Core files kept:
echo - daily-tracker.js
echo - manual-article-processor.js  
echo - executive-orders-tracker.js
echo - master-tracker-log.json
echo - pending-submissions.json
echo.
pause