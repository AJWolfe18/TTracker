@echo off
REM safe-eo-cleanup.bat
REM SAFE version of executive orders cleanup with all critical issues fixed

echo ========================================
echo SAFE Executive Orders Cleanup Tool v2.0
echo ========================================
echo.
echo This SAFE version includes:
echo - Automatic backup before any changes
echo - SQL injection protection
echo - Rate limiting to avoid API limits
echo - Verification after each deletion
echo - Complete audit log
echo - Rollback capability via backup
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

REM Check for SERVICE_ROLE_KEY
if "%SUPABASE_SERVICE_ROLE_KEY%"=="" (
    echo WARNING: SUPABASE_SERVICE_ROLE_KEY not set
    echo.
    echo For best results, set your service role key:
    echo SET SUPABASE_SERVICE_ROLE_KEY=your_key_here
    echo.
    echo The script will use ANON key which may fail due to RLS policies.
    echo.
    set /p continue="Continue anyway? (y/n): "
    if /i not "%continue%"=="y" (
        echo.
        echo To set the key:
        echo 1. Get it from Supabase Dashboard - Settings - API
        echo 2. Run: SET SUPABASE_SERVICE_ROLE_KEY=your_key_here
        echo 3. Run this script again
        pause
        exit /b 1
    )
)

echo.
echo STEP 1: Analysis and Backup
echo ============================
echo Running analysis and creating backup...
echo.

node safe-eo-cleanup.js

echo.
echo ========================================
echo.
echo Choose an action:
echo 1. DRY RUN - See what would be deleted (no changes)
echo 2. EXECUTE - Perform the cleanup (with backup)
echo 3. EXIT - Cancel and review the analysis
echo.
set /p choice="Enter 1, 2, or 3: "

if "%choice%"=="1" (
    echo.
    echo Running DRY RUN mode...
    echo.
    set DRY_RUN=true
    node safe-eo-cleanup.js
    
    echo.
    echo ========================================
    echo DRY RUN complete - no changes were made.
    echo Review the output above to see what would be deleted.
    
) else if "%choice%"=="2" (
    echo.
    echo ⚠️  FINAL CONFIRMATION
    echo =====================
    echo This will DELETE records from your production database!
    echo A backup has been created in the backups folder.
    echo.
    set /p confirm="Type YES to proceed with deletion: "
    
    if /i "%confirm%"=="YES" (
        echo.
        echo Executing cleanup...
        echo.
        set AUTO_CLEANUP=true
        node safe-eo-cleanup.js
        
        echo.
        echo ========================================
        echo CLEANUP COMPLETE!
        echo.
        echo Check:
        echo 1. Audit log for details
        echo 2. Dashboard at http://trumpytracker.com
        echo 3. Backups folder if you need to restore
    ) else (
        echo.
        echo Cleanup cancelled. No changes made.
    )
    
) else (
    echo.
    echo Exiting without changes.
)

echo.
echo ========================================
echo.
echo Next steps:
echo 1. Review the audit log for all operations
echo 2. Check dashboard counts at http://trumpytracker.com
echo 3. If issues, restore from backups folder
echo.
pause
