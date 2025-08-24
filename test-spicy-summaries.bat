@echo off
echo =====================================
echo SPICY SUMMARIES GPT-5 TEST RUNNER
echo =====================================
echo.

cd C:\Users\Josh\OneDrive\Desktop\GitHub\TTracker

echo Testing GPT-5 Models Comparison...
echo.
node scripts\spicy-summaries-gpt5.js --compare

echo.
echo =====================================
echo.
echo Testing with Real Articles from Database...
echo.
node scripts\spicy-summaries-gpt5.js --test-real

echo.
echo =====================================
echo Test Complete!
echo.
echo Next Steps:
echo 1. Review the outputs above
echo 2. Pick the best model (probably GPT-5-mini)
echo 3. Update daily-tracker-supabase.js to use spicy summaries
echo 4. Deploy to test environment
echo.
pause
