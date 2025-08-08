@echo off
echo Testing Enhanced Manual Article Processor
echo =========================================
echo.
echo Setting OpenAI API Key...
set OPENAI_API_KEY=%1
if "%OPENAI_API_KEY%"=="" (
    echo ERROR: Please provide OpenAI API key as first argument
    echo Usage: test-manual-processor.bat YOUR_OPENAI_API_KEY
    pause
    exit /b 1
)

echo.
echo Running manual article processor...
node manual-article-processor.js

echo.
echo Process complete! Check the results above.
pause