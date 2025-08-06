@echo off
echo Organizing daily tracking files...
echo.

if not exist "data" mkdir data

echo Moving real-news-tracker files...
for %%f in (real-news-tracker-*.json) do (
    if exist "%%f" (
        move "%%f" "data\%%f"
        echo   Moved: %%f
    )
)

echo Moving tracker-data files...
for %%f in (tracker-data-*.json) do (
    if exist "%%f" (
        move "%%f" "data\%%f" 
        echo   Moved: %%f
    )
)

echo Moving test files...
for %%f in (test-*.json) do (
    if exist "%%f" (
        move "%%f" "data\%%f"
        echo   Moved: %%f  
    )
)

echo.
echo Cleanup complete! Daily files are now in the 'data' folder.
echo.
dir data /b | find /c ".json" > temp.txt
set /p count=<temp.txt
del temp.txt
echo Total files in data folder: %count%
pause
