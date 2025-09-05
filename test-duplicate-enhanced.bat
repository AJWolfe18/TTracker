@echo off
echo =============================================
echo TESTING ENHANCED DUPLICATE DETECTION
echo =============================================
echo.

REM Enable debug logging for this test
set DUPLICATE_DEBUG_LOG=true
set DUPLICATE_COMPARISON_LENGTH=200
set DUPLICATE_SIMILARITY_THRESHOLD=0.85
set DUPLICATE_SCORE_THRESHOLD=80

echo Configuration:
echo - Comparison Length: 200 characters
echo - Similarity Threshold: 85%%
echo - Score Threshold: 80/100
echo - Debug Logging: ENABLED
echo.

echo Running daily tracker with enhanced duplicate detection...
echo Look for similarity scores in the output!
echo.

cd C:\Users\Josh\OneDrive\Desktop\GitHub\TTracker
node scripts\daily-tracker-supabase.js

echo.
echo =============================================
echo TEST COMPLETE
echo =============================================
echo.
echo Check the output above for:
echo 1. Similarity scores for each comparison
echo 2. Reasons for duplicate detection
echo 3. Whether false positives were reduced
echo.
pause
