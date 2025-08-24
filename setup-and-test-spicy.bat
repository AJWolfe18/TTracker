@echo off
echo =====================================
echo SPICY SUMMARIES GPT-5 TEST SETUP
echo =====================================
echo.

REM Check if API key is already set
if defined OPENAI_API_KEY (
    echo ✅ OpenAI API key is already set
    echo.
    goto :run_tests
)

echo ❌ OpenAI API key not found in environment
echo.
echo To test the spicy summaries, you need to set your OpenAI API key.
echo.
echo OPTION 1: Set temporarily for this session only
echo --------------------------------------------------
echo Run this command with your API key:
echo.
echo   set OPENAI_API_KEY=sk-...your-key-here...
echo.
echo Then run this script again.
echo.
echo.
echo OPTION 2: Get from GitHub Secrets (if you have GitHub CLI)
echo --------------------------------------------------
echo   gh secret list
echo.
echo.
echo OPTION 3: Create a .env file (for local testing)
echo --------------------------------------------------
echo Create a file called .env in the TTracker folder with:
echo   OPENAI_API_KEY=sk-...your-key-here...
echo.
echo.
echo SECURITY NOTE: Never commit your API key to GitHub!
echo The .env file should be in .gitignore
echo.
pause
exit /b

:run_tests
cd C:\Users\Josh\OneDrive\Desktop\GitHub\TTracker

echo Running GPT-5 Model Comparison...
echo =================================
node scripts\spicy-summaries-gpt5.js --compare

echo.
echo.
echo Testing with Real Articles...
echo =============================
node scripts\spicy-summaries-gpt5.js --test-real

echo.
echo =====================================
echo ✅ Test Complete!
echo =====================================
echo.
pause
