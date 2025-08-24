@echo off
cls
echo ================================================
echo    🔥 TRUMPYTRACKER SPICY SUMMARIES TESTER 🔥
echo ================================================
echo.

REM Check if we're in the right directory
if not exist "C:\Users\Josh\OneDrive\Desktop\GitHub\TTracker\scripts\test-spicy-simple.js" (
    echo ❌ Error: Not in TTracker directory!
    echo Please run from: C:\Users\Josh\OneDrive\Desktop\GitHub\TTracker
    pause
    exit /b 1
)

REM Check for API key
if defined OPENAI_API_KEY (
    echo ✅ OpenAI API key found in environment
    echo.
    goto :run_test
)

REM Check for .env file
if exist ".env" (
    echo 📄 Found .env file
    echo.
    goto :run_test
)

echo ❌ No OpenAI API key found!
echo.
echo ========================================
echo    HOW TO SET YOUR API KEY:
echo ========================================
echo.
echo OPTION 1: Quick Test (Temporary)
echo ---------------------------------
echo 1. Get your key from: https://platform.openai.com/api-keys
echo 2. Run this command:
echo.
echo    set OPENAI_API_KEY=sk-proj-...your-key-here...
echo.
echo 3. Then run this script again
echo.
echo.
echo OPTION 2: Create .env file (Permanent for local testing)
echo ---------------------------------------------------------
echo 1. Create a file called .env in this folder
echo 2. Add this line:
echo.
echo    OPENAI_API_KEY=sk-proj-...your-key-here...
echo.
echo 3. Save and run this script again
echo.
echo.
echo 🔒 SECURITY: Never commit your API key to GitHub!
echo     (.env is already in .gitignore)
echo.
pause
exit /b 1

:run_test
echo ========================================
echo    TESTING SPICY SUMMARIES
echo ========================================
echo.

cd C:\Users\Josh\OneDrive\Desktop\GitHub\TTracker

REM Install dotenv if needed
if not exist "node_modules\dotenv" (
    echo 📦 Installing dotenv package...
    npm install dotenv
    echo.
)

echo 🚀 Running spicy summary test...
echo.
node scripts\test-spicy-simple.js

echo.
echo ========================================
echo    WHAT'S NEXT?
echo ========================================
echo.
echo If the test worked:
echo 1. Review the summaries above
echo 2. Pick your preferred model (probably gpt-5-mini)
echo 3. Update daily-tracker-supabase.js to use it
echo 4. Commit: "Add spicy summaries with GPT-5"
echo.
echo If GPT-5 isn't available yet:
echo - The models might still be rolling out
echo - Try gpt-4o or gpt-4o-mini instead
echo - Update the model names in the script
echo.
pause
